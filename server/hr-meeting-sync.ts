import { buildEventTitle, cancelOrganizerEvent, createOrganizerEvent, graphIsLive, updateOrganizerEvent } from "./microsoft-graph.ts";
import { formatMeetingSlot, normalizeMicrosoft365 } from "../src/domain/hr-meeting.ts";
import { nowIso, uid } from "../src/domain/dates.ts";
import { fullName } from "../src/lib/format.ts";
import type { AppNotification, AppState, Ticket } from "../src/types.ts";
import { writeWorkspace } from "./db.ts";

let running = false;

function withMeeting(ticket: Ticket, patch: Partial<NonNullable<Ticket["meeting"]>>): Ticket {
  if (!ticket.meeting) return ticket;
  return {
    ...ticket,
    meeting: { ...ticket.meeting, ...patch },
    updatedAt: nowIso(),
  };
}

function notifyEmployee(state: AppState, ticket: Ticket, title: string, body: string): AppState {
  const note: AppNotification = {
    id: uid("ntf"),
    userId: ticket.employeeId,
    title,
    body,
    href: `/tickets/${ticket.id}`,
    kind: "ticket",
    read: false,
    createdAt: nowIso(),
  };
  return { ...state, notifications: [note, ...state.notifications] };
}

export async function processHrMeetingSync(state: AppState, ticketId: string): Promise<AppState> {
  const ticket = state.tickets.find((item) => item.id === ticketId);
  if (!ticket?.meeting || !ticket.meeting.pendingSyncAction) return state;

  const config = normalizeMicrosoft365(state.microsoft365);
  const meeting = ticket.meeting;
  const requester = state.employees.find((item) => item.id === ticket.employeeId);
  if (!requester?.email) {
    return {
      ...state,
      tickets: state.tickets.map((item) =>
        item.id === ticketId
          ? withMeeting(item, {
              calendarSyncStatus: "failed",
              meetingStatus: "sync_failed",
              lastSyncError: "Requester email is required to invite the employee.",
              syncAttemptCount: meeting.syncAttemptCount + 1,
              pendingSyncAction: meeting.pendingSyncAction,
            })
          : item,
      ),
    };
  }

  if (!graphIsLive(config)) {
    return {
      ...state,
      tickets: state.tickets.map((item) =>
        item.id === ticketId
          ? withMeeting(item, {
              calendarSyncStatus: "not_connected",
              meetingStatus: "sync_failed",
              lastSyncError: "Microsoft 365 is not connected (demo mode or missing credentials). The HR decision is saved; retry after connecting Graph.",
              syncAttemptCount: meeting.syncAttemptCount + 1,
            })
          : item,
      ),
    };
  }

  const organizerEmail = meeting.organizerEmail || config.defaultOrganizerEmail;
  if (!organizerEmail) {
    return {
      ...state,
      tickets: state.tickets.map((item) =>
        item.id === ticketId
          ? withMeeting(item, {
              calendarSyncStatus: "failed",
              meetingStatus: "sync_failed",
              lastSyncError: "No HR organizer mailbox is configured.",
              syncAttemptCount: meeting.syncAttemptCount + 1,
            })
          : item,
      ),
    };
  }

  const slot = meeting.confirmed;
  if (meeting.pendingSyncAction !== "cancel" && !slot) {
    return {
      ...state,
      tickets: state.tickets.map((item) =>
        item.id === ticketId
          ? withMeeting(item, {
              calendarSyncStatus: "failed",
              meetingStatus: "sync_failed",
              lastSyncError: "Confirmed meeting time is missing.",
              syncAttemptCount: meeting.syncAttemptCount + 1,
            })
          : item,
      ),
    };
  }

  const title = buildEventTitle(fullName(requester));
  const teams = meeting.requestType === "teams";

  if (meeting.pendingSyncAction === "cancel") {
    if (!meeting.graphEventId) {
      return {
        ...state,
        tickets: state.tickets.map((item) =>
          item.id === ticketId
            ? withMeeting(item, {
                calendarSyncStatus: "cancelled",
                pendingSyncAction: null,
                joinUrl: null,
                lastSyncedAt: nowIso(),
                lastSyncError: null,
              })
            : item,
        ),
      };
    }
    const cancelled = await cancelOrganizerEvent(config, organizerEmail, meeting.graphEventId);
    if (!cancelled.ok) {
      return {
        ...state,
        tickets: state.tickets.map((item) =>
          item.id === ticketId
            ? withMeeting(item, {
                calendarSyncStatus: "failed",
                meetingStatus: "sync_failed",
                lastSyncError: cancelled.message,
                syncAttemptCount: meeting.syncAttemptCount + 1,
              })
            : item,
        ),
      };
    }
    const next = {
      ...state,
      tickets: state.tickets.map((item) =>
        item.id === ticketId
          ? withMeeting(item, {
              calendarSyncStatus: "cancelled" as const,
              pendingSyncAction: null,
              joinUrl: null,
              lastSyncedAt: nowIso(),
              lastSyncError: null,
              syncAttemptCount: meeting.syncAttemptCount + 1,
            })
          : item,
      ),
    };
    return notifyEmployee(next, ticket, "HR meeting cancelled on calendar", "The calendar event was cancelled. Check the ticket for the reason.");
  }

  if (meeting.pendingSyncAction === "update" && meeting.graphEventId && slot) {
    const updated = await updateOrganizerEvent(config, {
      organizerEmail,
      eventId: meeting.graphEventId,
      title,
      slot,
      attendeeEmail: requester.email,
      attendeeName: fullName(requester),
      teams,
      idempotencyKey: `${meeting.idempotencyKey}-u${meeting.syncAttemptCount + 1}`,
    });
    if (!updated.ok) {
      return {
        ...state,
        tickets: state.tickets.map((item) =>
          item.id === ticketId
            ? withMeeting(item, {
                calendarSyncStatus: "failed",
                meetingStatus: "sync_failed",
                lastSyncError: updated.message,
                syncAttemptCount: meeting.syncAttemptCount + 1,
              })
            : item,
        ),
      };
    }
    const next = {
      ...state,
      tickets: state.tickets.map((item) =>
        item.id === ticketId
          ? withMeeting(item, {
              calendarSyncStatus: "synced" as const,
              meetingStatus: "scheduled" as const,
              graphEventId: updated.event.eventId,
              joinUrl: teams ? updated.event.joinUrl : null,
              webLink: updated.event.webLink,
              pendingSyncAction: null,
              lastSyncedAt: nowIso(),
              lastSyncError: null,
              syncAttemptCount: meeting.syncAttemptCount + 1,
            })
          : item,
      ),
    };
    return notifyEmployee(
      next,
      ticket,
      "HR meeting scheduled",
      `Confirmed for ${formatMeetingSlot(slot)}${teams && updated.event.joinUrl ? ". Teams join link is on your ticket." : "."}`,
    );
  }

  if (slot) {
    const created = await createOrganizerEvent(config, {
      organizerEmail,
      title,
      slot,
      attendeeEmail: requester.email,
      attendeeName: fullName(requester),
      teams,
      idempotencyKey: meeting.idempotencyKey,
    });
    if (!created.ok) {
      return {
        ...state,
        tickets: state.tickets.map((item) =>
          item.id === ticketId
            ? withMeeting(item, {
                calendarSyncStatus: "failed",
                meetingStatus: "sync_failed",
                lastSyncError: created.message,
                syncAttemptCount: meeting.syncAttemptCount + 1,
              })
            : item,
        ),
      };
    }
    const next = {
      ...state,
      tickets: state.tickets.map((item) =>
        item.id === ticketId
          ? withMeeting(item, {
              calendarSyncStatus: "synced" as const,
              meetingStatus: "scheduled" as const,
              graphEventId: created.event.eventId,
              joinUrl: teams ? created.event.joinUrl : null,
              webLink: created.event.webLink,
              pendingSyncAction: null,
              lastSyncedAt: nowIso(),
              lastSyncError: null,
              syncAttemptCount: meeting.syncAttemptCount + 1,
            })
          : item,
      ),
    };
    return notifyEmployee(
      next,
      ticket,
      "HR meeting scheduled",
      `Confirmed for ${formatMeetingSlot(slot)}${teams && created.event.joinUrl ? ". Teams join link is on your ticket." : "."}`,
    );
  }

  return state;
}

export function queueHrMeetingSync(ticketId: string): void {
  void (async () => {
    if (running) {
      setTimeout(() => queueHrMeetingSync(ticketId), 1500);
      return;
    }
    running = true;
    try {
      const { readWorkspace } = await import("./db.ts");
      const latest = readWorkspace();
      const next = await processHrMeetingSync(latest, ticketId);
      writeWorkspace({ ...next, currentUserId: null });
    } catch {
      // Sync errors are persisted on the ticket when possible.
    } finally {
      running = false;
    }
  })();
}

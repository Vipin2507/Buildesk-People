import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, CalendarClock, CalendarDays, CheckCircle2, Clock3 } from "lucide-react";
import {
  Banner,
  Button,
  DataTable,
  DatePicker,
  EmptyState,
  Field,
  Modal,
  NoAccess,
  PageHeader,
  Stat,
  StatusBadge,
  Tabs,
  TimePicker,
} from "../components/ui";
import { canManageHrMeeting } from "../lib/access";
import {
  HR_MEETING_STATUS_LABELS,
  emptyMeetingSlot,
  formatMeetingSlot,
  isHrMeetingTicket,
  normalizeMicrosoft365,
} from "../domain/hr-meeting";
import { todayIso } from "../domain/dates";
import { formatDateTime, fullName, labelFor } from "../lib/format";
import { useTab } from "../lib/useTab";
import { useApp } from "../store/store";
import type { HrMeetingSlot, Ticket } from "../types";

type ViewTab = "needs_review" | "upcoming" | "past" | "sync_issues";

function meetingTickets(tickets: Ticket[]): Ticket[] {
  return tickets.filter(isHrMeetingTicket);
}

export function HrMeetings() {
  const { state, user } = useApp();
  const [params, setParams] = useSearchParams();
  const focus = params.get("focus");
  if (!user || !canManageHrMeeting(state, user)) {
    return <NoAccess body="HR meeting requests are limited to authorized HR and administrators." />;
  }

  const rows = meetingTickets(state.tickets);
  const today = todayIso();
  const awaiting = rows.filter((item) => item.meeting && (["awaiting_hr", "submitted"].includes(item.meeting.meetingStatus) || item.status === "waiting")).length;
  const scheduled = rows.filter((item) => item.meeting?.meetingStatus === "scheduled").length;
  const changeRequested = rows.filter((item) => item.status === "waiting" && item.meeting).length;
  const syncIssues = rows.filter((item) => item.meeting && (item.meeting.meetingStatus === "sync_failed" || item.meeting.calendarSyncStatus === "failed" || item.meeting.calendarSyncStatus === "not_connected")).length;

  const tabs: { id: ViewTab; label: string; count?: number }[] = [
    { id: "needs_review", label: "Needs review", count: awaiting },
    { id: "upcoming", label: "Upcoming", count: scheduled },
    { id: "past", label: "Past" },
    { id: "sync_issues", label: "Sync issues", count: syncIssues },
  ];
  const [tab, setTab] = useTab(tabs.map((item) => item.id), "needs_review");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [topicFilter, setTopicFilter] = useState("all");
  const [organizerFilter, setOrganizerFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [selectedId, setSelectedId] = useState(focus || "");

  const filtered = useMemo(() => {
    return rows.filter((item) => {
      const meeting = item.meeting!;
      const slot = meeting.confirmed || meeting.preferred;
      if (tab === "needs_review") {
        if (!(["awaiting_hr", "submitted"].includes(meeting.meetingStatus) || item.status === "waiting")) return false;
      } else if (tab === "upcoming") {
        if (meeting.meetingStatus !== "scheduled" && meeting.meetingStatus !== "approved_sync_pending" && meeting.meetingStatus !== "rescheduled_sync_pending") return false;
        if (slot.date < today && meeting.meetingStatus === "scheduled") return false;
      } else if (tab === "past") {
        const closed = ["rejected", "cancelled"].includes(meeting.meetingStatus) || (meeting.meetingStatus === "scheduled" && slot.date < today);
        if (!closed) return false;
      } else if (tab === "sync_issues") {
        if (!(meeting.meetingStatus === "sync_failed" || meeting.calendarSyncStatus === "failed" || meeting.calendarSyncStatus === "not_connected")) return false;
      }
      if (statusFilter !== "all" && meeting.meetingStatus !== statusFilter) return false;
      if (typeFilter !== "all" && meeting.requestType !== typeFilter) return false;
      if (topicFilter !== "all" && meeting.topic !== topicFilter) return false;
      if (organizerFilter !== "all" && (meeting.organizerEmail || "") !== organizerFilter) return false;
      if (dateFrom && slot.date < dateFrom) return false;
      return true;
    });
  }, [rows, tab, statusFilter, typeFilter, topicFilter, organizerFilter, dateFrom, today]);

  const selected = rows.find((item) => item.id === selectedId) || filtered[0] || null;
  const ms = normalizeMicrosoft365(state.microsoft365);
  const connected = Boolean(ms.enabled && !ms.demoMode && ms.tenantId && ms.clientId && ms.defaultOrganizerEmail);
  const topics = Array.from(new Set(rows.map((item) => item.meeting!.topic))).sort();
  const organizers = Array.from(new Set(rows.map((item) => item.meeting!.organizerEmail).filter(Boolean) as string[])).sort();

  return (
    <div className="hr-meetings-module">
      <PageHeader
        title="HR Meetings"
        subtitle="Review employee requests for HR Teams meetings or calls. Calendar events are created only after Microsoft Graph confirms them."
        crumbs={[{ label: "Tickets", to: "/tickets" }, { label: "HR Meetings" }]}
        actions={<Link className="btn btn-secondary" to="/tickets">All tickets</Link>}
      />
      {!connected && (
        <Banner tone="warning">
          Microsoft 365 is {ms.demoMode || !ms.enabled ? "in Demo mode / Not connected" : "missing a client secret on the server"}. Approvals are saved, but no real Teams invitation is created until Graph is configured in Settings → Integrations.
        </Banner>
      )}
      <div className="stats">
        <Stat label="Awaiting review" value={String(awaiting)} hint="Includes change requests" icon={<Clock3 size={18} />} tone="blue" />
        <Stat label="Scheduled" value={String(scheduled)} hint="Graph-confirmed only" icon={<CheckCircle2 size={18} />} tone="green" />
        <Stat label="Reschedule / change" value={String(changeRequested)} hint="Employee asked to change" icon={<CalendarClock size={18} />} tone="amber" />
        <Stat label="Sync issues" value={String(syncIssues)} hint="Retry from detail panel" icon={<AlertTriangle size={18} />} tone="red" />
      </div>
      <Tabs tabs={tabs} value={tab} onChange={(id) => setTab(id as ViewTab)} />
      <section className="panel filters-bar">
        <div className="form-grid">
          <Field label="Status">
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">All statuses</option>
              {Object.entries(HR_MEETING_STATUS_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </Field>
          <Field label="Request type">
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
              <option value="all">All types</option>
              <option value="teams">Teams meeting</option>
              <option value="phone">Phone / Teams audio</option>
            </select>
          </Field>
          <Field label="Topic">
            <select value={topicFilter} onChange={(event) => setTopicFilter(event.target.value)}>
              <option value="all">All topics</option>
              {topics.map((topic) => <option key={topic}>{topic}</option>)}
            </select>
          </Field>
          <Field label="Organizer">
            <select value={organizerFilter} onChange={(event) => setOrganizerFilter(event.target.value)}>
              <option value="all">All organizers</option>
              {organizers.map((email) => <option key={email} value={email}>{email}</option>)}
            </select>
          </Field>
          <Field label="Requested date from">
            <DatePicker value={dateFrom} onChange={setDateFrom} placeholder="Any date" />
          </Field>
        </div>
      </section>
      <div className="grid-2">
        <section className="panel">
          <DataTable
            caption="HR meeting requests"
            rows={filtered}
            rowKey={(row) => row.id}
            emptyTitle="No matching requests"
            emptyBody="Try another filter, or wait for employees to submit HR meeting requests from Tickets."
            columns={[
              {
                key: "who",
                header: "Requester",
                render: (row) => (
                  <button type="button" className="linkish" onClick={() => { setSelectedId(row.id); setParams({ focus: row.id }, { replace: true }); }}>
                    {fullName(state.employees.find((item) => item.id === row.employeeId)!)}
                  </button>
                ),
              },
              { key: "topic", header: "Topic", render: (row) => row.meeting!.topic },
              {
                key: "when",
                header: "Requested time",
                render: (row) => formatMeetingSlot(row.meeting!.preferred),
              },
              { key: "org", header: "Organizer", render: (row) => row.meeting!.organizerEmail || "—" },
              { key: "type", header: "Type", render: (row) => <StatusBadge value={row.meeting!.requestType} /> },
              { key: "status", header: "Status", render: (row) => <StatusBadge value={row.meeting!.meetingStatus} /> },
              {
                key: "actions",
                header: "Open",
                render: (row) => <Link to={`/tickets/${row.id}`}>Ticket</Link>,
              },
            ]}
          />
        </section>
        <MeetingDetailPanel
          ticket={selected}
          onClose={() => setSelectedId("")}
          onChanged={() => undefined}
        />
      </div>
      <AgendaPanel rows={rows.filter((item) => item.meeting?.meetingStatus === "scheduled")} />
    </div>
  );
}

function AgendaPanel({ rows }: { rows: Ticket[] }) {
  const { state } = useApp();
  const upcoming = [...rows]
    .filter((item) => item.meeting?.confirmed)
    .sort((a, b) => `${a.meeting!.confirmed!.date}${a.meeting!.confirmed!.startTime}`.localeCompare(`${b.meeting!.confirmed!.date}${b.meeting!.confirmed!.startTime}`));
  return (
    <section className="panel">
      <h2><CalendarDays size={16} aria-hidden /> Confirmed agenda</h2>
      <p className="muted">Only Graph-confirmed scheduled meetings appear here. Availability is confirmed manually by HR unless calendar free/busy is enabled later.</p>
      {upcoming.length === 0 ? (
        <EmptyState title="No confirmed meetings" body="Approve a request and wait for calendar sync to succeed." />
      ) : (
        <ul className="agenda-list">
          {upcoming.map((item) => {
            const person = state.employees.find((emp) => emp.id === item.employeeId);
            const slot = item.meeting!.confirmed!;
            return (
              <li key={item.id}>
                <strong>{formatMeetingSlot(slot)}</strong>
                <span>{person ? fullName(person) : "Employee"} · {item.meeting!.topic} · {labelFor(item.meeting!.requestType)}</span>
                {item.meeting!.joinUrl ? (
                  <a href={item.meeting!.joinUrl} target="_blank" rel="noreferrer">Join Teams</a>
                ) : (
                  <span className="muted">{item.meeting!.requestType === "teams" ? "Join link pending sync" : "Call / contact instructions on ticket"}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function MeetingDetailPanel({ ticket, onClose }: { ticket: Ticket | null; onClose: () => void; onChanged: () => void }) {
  const { state, actions } = useApp();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"none" | "reschedule" | "reject" | "cancel">("none");
  const [response, setResponse] = useState("");
  const [slot, setSlot] = useState<HrMeetingSlot>(emptyMeetingSlot(state.settings.timezone || "Asia/Kolkata"));
  const ms = normalizeMicrosoft365(state.microsoft365);
  const organizers = ms.allowedOrganizerEmails.length ? ms.allowedOrganizerEmails : (ms.defaultOrganizerEmail ? [ms.defaultOrganizerEmail] : []);
  const [organizerEmail, setOrganizerEmail] = useState(ticket?.meeting?.organizerEmail || ms.defaultOrganizerEmail || "");

  if (!ticket?.meeting) {
    return (
      <section className="panel">
        <EmptyState title="Select a request" body="Choose a row to review history, decide, or retry calendar sync." />
      </section>
    );
  }

  const meeting = ticket.meeting;
  const requester = state.employees.find((item) => item.id === ticket.employeeId);

  const run = async (fn: () => Promise<{ ok: boolean; message?: string }>) => {
    setBusy(true);
    setError("");
    const result = await fn();
    setBusy(false);
    if (!result.ok) setError(result.message || "That action failed.");
    else {
      setMode("none");
      setResponse("");
    }
  };

  return (
    <section className="panel">
      <div className="split">
        <h2>{ticket.subject}</h2>
        <Button variant="ghost" size="sm" onClick={onClose}>Clear</Button>
      </div>
      <p className="muted">{ticket.number} · submitted {formatDateTime(ticket.createdAt)}</p>
      {error && <Banner tone="error">{error}</Banner>}
      <dl className="dl">
        <dt>Requester</dt><dd>{requester ? fullName(requester) : "—"}</dd>
        <dt>Topic</dt><dd>{meeting.topic}</dd>
        <dt>Type</dt><dd><StatusBadge value={meeting.requestType} /></dd>
        <dt>Status</dt><dd><StatusBadge value={meeting.meetingStatus} /></dd>
        <dt>Preferred</dt><dd>{formatMeetingSlot(meeting.preferred)}</dd>
        {meeting.alternative && <><dt>Alternative</dt><dd>{formatMeetingSlot(meeting.alternative)}</dd></>}
        <dt>Original preferred</dt><dd>{formatMeetingSlot(meeting.originalPreferred || meeting.preferred)}</dd>
        <dt>Confirmed</dt><dd>{meeting.confirmed ? formatMeetingSlot(meeting.confirmed) : "Not confirmed"}</dd>
        <dt>Organizer</dt><dd>{meeting.organizerEmail || "—"}</dd>
        <dt>Calendar sync</dt><dd><StatusBadge value={meeting.calendarSyncStatus} /></dd>
        {meeting.lastSyncError && <><dt>Last sync error</dt><dd>{meeting.lastSyncError}</dd></>}
        {meeting.joinUrl && meeting.meetingStatus === "scheduled" && (
          <><dt>Teams join</dt><dd><a href={meeting.joinUrl} target="_blank" rel="noreferrer">Open join link</a></dd></>
        )}
        {meeting.hrResponse && <><dt>HR response</dt><dd>{meeting.hrResponse}</dd></>}
        {meeting.contactNote && <><dt>Contact note</dt><dd>{meeting.contactNote}</dd></>}
      </dl>
      <p>{ticket.description}</p>
      {ticket.attachmentName && <p className="muted">Attachment: {ticket.attachmentName}</p>}
      <h3>History</h3>
      <ul className="timeline compact">
        {ticket.history.map((item) => (
          <li key={item.id}>
            <strong>{item.action}</strong>
            <span className="muted"> · {formatDateTime(item.at)}</span>
            <div>{item.comment}</div>
          </li>
        ))}
      </ul>
      <Field label="HR organizer mailbox">
        <select value={organizerEmail} onChange={(event) => setOrganizerEmail(event.target.value)}>
          {!organizers.length && <option value="">Configure organizers in Settings</option>}
          {organizers.map((email) => <option key={email} value={email}>{email}</option>)}
        </select>
      </Field>
      <div className="actions">
        {["awaiting_hr", "submitted", "sync_failed"].includes(meeting.meetingStatus) && (
          <Button disabled={busy} onClick={() => run(() => actions.approveHrMeeting(ticket.id, { organizerEmail, response }))}>
            Approve preferred time
          </Button>
        )}
        <Button variant="secondary" disabled={busy} onClick={() => { setSlot(meeting.confirmed || meeting.preferred); setMode("reschedule"); }}>Reschedule</Button>
        {meeting.meetingStatus !== "rejected" && meeting.meetingStatus !== "cancelled" && meeting.meetingStatus !== "scheduled" && (
          <Button variant="danger" disabled={busy} onClick={() => setMode("reject")}>Reject</Button>
        )}
        {(meeting.meetingStatus === "scheduled" || meeting.meetingStatus === "approved_sync_pending" || meeting.meetingStatus === "rescheduled_sync_pending" || meeting.graphEventId) && (
          <Button variant="danger" disabled={busy} onClick={() => setMode("cancel")}>Cancel meeting</Button>
        )}
        {(meeting.meetingStatus === "sync_failed" || meeting.calendarSyncStatus === "failed" || meeting.calendarSyncStatus === "not_connected" || meeting.calendarSyncStatus === "pending") && (
          <Button variant="secondary" disabled={busy} onClick={() => run(() => actions.retryHrMeetingSync(ticket.id))}>Retry calendar sync</Button>
        )}
        <Link className="btn btn-ghost" to={`/tickets/${ticket.id}`}>Full ticket</Link>
      </div>

      <Modal open={mode === "reschedule"} title="Reschedule HR meeting" onClose={() => setMode("none")}>
        <p className="muted">Original preferred time stays on record: {formatMeetingSlot(meeting.originalPreferred || meeting.preferred)}.</p>
        <MeetingSlotFields slot={slot} onChange={setSlot} />
        <Field label="Note to employee (required)"><textarea value={response} onChange={(event) => setResponse(event.target.value)} /></Field>
        <div className="actions">
          <Button disabled={busy} onClick={() => run(() => actions.rescheduleHrMeeting(ticket.id, { slot, response, organizerEmail }))}>Confirm reschedule</Button>
          <Button variant="secondary" onClick={() => setMode("none")}>Back</Button>
        </div>
      </Modal>
      <Modal open={mode === "reject"} title="Reject request" onClose={() => setMode("none")}>
        <p className="muted">No calendar event will be created.</p>
        <Field label="Response to employee"><textarea value={response} onChange={(event) => setResponse(event.target.value)} /></Field>
        <div className="actions">
          <Button variant="danger" disabled={busy} onClick={() => run(() => actions.rejectHrMeeting(ticket.id, response))}>Reject request</Button>
          <Button variant="secondary" onClick={() => setMode("none")}>Back</Button>
        </div>
      </Modal>
      <Modal open={mode === "cancel"} title="Cancel meeting" onClose={() => setMode("none")}>
        <p className="muted">If a calendar event exists, it will be cancelled through Microsoft Graph.</p>
        <Field label="Cancellation reason"><textarea value={response} onChange={(event) => setResponse(event.target.value)} /></Field>
        <div className="actions">
          <Button variant="danger" disabled={busy} onClick={() => run(() => actions.cancelHrMeeting(ticket.id, response))}>Cancel meeting</Button>
          <Button variant="secondary" onClick={() => setMode("none")}>Back</Button>
        </div>
      </Modal>
    </section>
  );
}

export function MeetingSlotFields({ slot, onChange }: { slot: HrMeetingSlot; onChange: (next: HrMeetingSlot) => void }) {
  return (
    <div className="form-grid">
      <Field label="Date"><DatePicker value={slot.date} onChange={(date) => onChange({ ...slot, date })} /></Field>
      <Field label="Start time"><TimePicker value={slot.startTime} onChange={(startTime) => onChange({ ...slot, startTime })} /></Field>
      <Field label="Duration (minutes)">
        <select value={slot.durationMinutes} onChange={(event) => onChange({ ...slot, durationMinutes: Number(event.target.value) })}>
          {[15, 30, 45, 60, 90].map((mins) => <option key={mins} value={mins}>{mins}</option>)}
        </select>
      </Field>
      <Field label="Timezone">
        <select value={slot.timezone} onChange={(event) => onChange({ ...slot, timezone: event.target.value })}>
          {["Asia/Kolkata", "Asia/Dubai", "UTC", "Europe/London", "America/New_York"].map((tz) => <option key={tz}>{tz}</option>)}
        </select>
      </Field>
    </div>
  );
}

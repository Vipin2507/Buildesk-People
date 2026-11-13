import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Banner, Button, EmptyState, Field, PageHeader, StatusBadge, Timeline } from "../components/ui";
import { canManageHrMeeting, canManageTicket } from "../lib/access";
import { formatMeetingSlot, isHrMeetingTicket, normalizeMicrosoft365 } from "../domain/hr-meeting";
import { formatDateTime, fullName, labelFor } from "../lib/format";
import { useApp } from "../store/store";
import type { TicketPriority, TicketStatus } from "../types";

export function TicketDetail() {
  const { id } = useParams();
  const { state, user, actions } = useApp();
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [changeNote, setChangeNote] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const ticket = state.tickets.find((item) => item.id === id);
  if (!user) return null;
  if (!ticket) return <EmptyState title="Ticket not found" body="That request is not in this workspace." action={<Link className="btn btn-secondary" to="/tickets">Back to tickets</Link>} />;
  const owner = ticket.employeeId === user.id;
  const manage = canManageTicket(state, user, ticket);
  if (!owner && !manage) return <EmptyState title="You can't view this ticket" body="Tickets are visible to the requester and the team that handles that category." action={<Link className="btn btn-secondary" to="/tickets">Back to tickets</Link>} />;
  const requester = state.employees.find((item) => item.id === ticket.employeeId);
  const meeting = ticket.meeting;
  const hrMeeting = isHrMeetingTicket(ticket) && meeting;
  const ms = normalizeMicrosoft365(state.microsoft365);
  const deliveryNote = !state.automation?.settings.automationsEnabled
    ? "In-app notification is recorded. Email/WhatsApp delivery is not configured (Automation off)."
    : "In-app notification is recorded. Channel delivery depends on Automation rules.";

  return (
    <div>
      <PageHeader
        title={ticket.subject}
        subtitle={`${ticket.number} · ${hrMeeting ? "HR meeting" : ticket.category}`}
        crumbs={[
          { label: "Tickets", to: "/tickets" },
          ...(hrMeeting && canManageHrMeeting(state, user) ? [{ label: "HR Meetings", to: "/tickets/meetings" }] : []),
          { label: ticket.number },
        ]}
        actions={
          <>
            {hrMeeting ? <StatusBadge value={meeting.meetingStatus} /> : <StatusBadge value={ticket.status} />}
            <StatusBadge value={ticket.priority} />
          </>
        }
      />
      <div className="grid-2">
        <section className="panel">
          <p>{ticket.description}</p>
          {ticket.attachmentName && <p className="muted">Attachment name: {ticket.attachmentName}</p>}
          {ticket.status === "waiting" && owner && <Banner tone="warning">Support is waiting for your reply.</Banner>}
          {hrMeeting && (
            <section className="notice">
              <h2>HR meeting</h2>
              <dl className="dl">
                <dt>Status</dt><dd><StatusBadge value={meeting.meetingStatus} /></dd>
                <dt>Meeting type</dt><dd><StatusBadge value={meeting.requestType} /></dd>
                <dt>Topic</dt><dd>{meeting.topic}</dd>
                <dt>Preferred time</dt><dd>{formatMeetingSlot(meeting.preferred)}</dd>
                {meeting.alternative && <><dt>Alternative</dt><dd>{formatMeetingSlot(meeting.alternative)}</dd></>}
                <dt>Confirmed time</dt><dd>{meeting.confirmed ? formatMeetingSlot(meeting.confirmed) : "Not confirmed yet"}</dd>
                <dt>Original preferred</dt><dd>{formatMeetingSlot(meeting.originalPreferred || meeting.preferred)}</dd>
                <dt>Calendar sync</dt><dd><StatusBadge value={meeting.calendarSyncStatus} /></dd>
                {meeting.lastSyncError && <><dt>Sync error</dt><dd>{meeting.lastSyncError}</dd></>}
                {meeting.hrResponse && <><dt>HR response</dt><dd>{meeting.hrResponse}</dd></>}
                {meeting.joinUrl && meeting.meetingStatus === "scheduled" ? (
                  <><dt>Teams join link</dt><dd><a href={meeting.joinUrl} target="_blank" rel="noreferrer">Join Microsoft Teams</a></dd></>
                ) : meeting.requestType === "teams" && meeting.meetingStatus !== "rejected" && meeting.meetingStatus !== "cancelled" ? (
                  <><dt>Teams join link</dt><dd className="muted">Shown only after Microsoft Graph confirms the event.</dd></>
                ) : null}
              </dl>
              {(ms.demoMode || !ms.enabled) && meeting.calendarSyncStatus !== "synced" && (
                <Banner tone="warning">Microsoft 365 is not connected (demo mode). No real Teams invitation exists yet.</Banner>
              )}
              <p className="faint">{deliveryNote}</p>
              {owner && meeting.meetingStatus !== "rejected" && meeting.meetingStatus !== "cancelled" && (
                <div className="stack">
                  <Field label="Request a change">
                    <textarea value={changeNote} onChange={(event) => setChangeNote(event.target.value)} placeholder="Describe the change you need" />
                  </Field>
                  <Button variant="secondary" onClick={async () => {
                    const result = await actions.requestHrMeetingChange(ticket.id, changeNote);
                    if (!result.ok) setError(result.message);
                    else { setChangeNote(""); setError(""); }
                  }}>Send change request</Button>
                  <Field label="Request cancellation">
                    <textarea value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="Reason for cancellation" />
                  </Field>
                  <Button variant="danger" onClick={async () => {
                    if (!window.confirm("Cancel this HR meeting request?")) return;
                    const result = await actions.cancelHrMeeting(ticket.id, cancelReason);
                    if (!result.ok) setError(result.message);
                    else { setCancelReason(""); setError(""); }
                  }}>Cancel request</Button>
                </div>
              )}
              {manage && canManageHrMeeting(state, user) && (
                <p className="muted"><Link to={`/tickets/meetings?focus=${ticket.id}`}>Open in HR Meetings workspace</Link> to approve, reschedule, or retry sync.</p>
              )}
            </section>
          )}
          <Timeline items={ticket.history.map((item) => ({
            id: item.id,
            title: item.action,
            meta: `${fullName(state.employees.find((person) => person.id === item.actorId) ?? { firstName: "System", lastName: "" })} · ${formatDateTime(item.at)}`,
            body: item.comment,
          }))} />
          <form noValidate onSubmit={async (event) => {
            event.preventDefault();
            const result = await actions.addTicketComment(ticket.id, comment);
            if (!result.ok) setError(result.message);
            else { setComment(""); setError(""); }
          }}>
            {error && <Banner tone="error">{error}</Banner>}
            <Field label="Add an update"><textarea value={comment} onChange={(event) => setComment(event.target.value)} /></Field>
            <Button type="submit">Send update</Button>
          </form>
          {owner && ticket.status === "resolved" && !hrMeeting && <Button variant="secondary" onClick={() => actions.reopenTicket(ticket.id)}>Reopen ticket</Button>}
        </section>
        <section className="panel">
          <h2>Details</h2>
          <dl className="dl">
            <dt>Requester</dt><dd>{requester ? fullName(requester) : "—"}</dd>
            <dt>Assignee</dt><dd>{ticket.assigneeId ? fullName(state.employees.find((item) => item.id === ticket.assigneeId)!) : "Unassigned"}</dd>
            <dt>Opened</dt><dd>{formatDateTime(ticket.createdAt)}</dd>
            {hrMeeting && <><dt>Organizer mailbox</dt><dd>{meeting.organizerEmail || "—"}</dd></>}
          </dl>
          {manage && !hrMeeting && (
            <form className="stack" onSubmit={(event) => event.preventDefault()}>
              <Field label="Status">
                <select value={ticket.status} onChange={(event) => actions.updateTicket(ticket.id, { status: event.target.value as TicketStatus })}>
                  {["open", "in_progress", "waiting", "resolved"].map((item) => <option key={item} value={item}>{labelFor(item)}</option>)}
                </select>
              </Field>
              <Field label="Priority">
                <select value={ticket.priority} onChange={(event) => actions.updateTicket(ticket.id, { priority: event.target.value as TicketPriority })}>
                  {["low", "medium", "high", "urgent"].map((item) => <option key={item} value={item}>{labelFor(item)}</option>)}
                </select>
              </Field>
              <Field label="Assignee">
                <select value={ticket.assigneeId ?? ""} onChange={(event) => actions.updateTicket(ticket.id, { assigneeId: event.target.value || null })}>
                  <option value="">Unassigned</option>
                  {state.employees.filter((item) => item.status === "active" && (item.role === "manager" || item.role === "hr" || item.role === "payroll" || item.role === "admin")).map((item) => (
                    <option key={item.id} value={item.id}>{fullName(item)}</option>
                  ))}
                </select>
              </Field>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}

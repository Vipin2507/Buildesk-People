import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Banner, Button, EmptyState, Field, PageHeader, StatusBadge, Timeline } from "../components/ui";
import { canManageTicket } from "../lib/access";
import { formatDateTime, fullName, labelFor } from "../lib/format";
import { useApp } from "../store/store";
import type { TicketPriority, TicketStatus } from "../types";

export function TicketDetail() {
  const { id } = useParams();
  const { state, user, actions } = useApp();
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const ticket = state.tickets.find((item) => item.id === id);
  if (!user) return null;
  if (!ticket) return <EmptyState title="Ticket not found" body="That request is not in this workspace." action={<Link className="btn btn-secondary" to="/tickets">Back to tickets</Link>} />;
  const owner = ticket.employeeId === user.id;
  const manage = canManageTicket(state, user, ticket);
  if (!owner && !manage) return <EmptyState title="You can't view this ticket" body="Tickets are visible to the requester and the team that handles that category." action={<Link className="btn btn-secondary" to="/tickets">Back to tickets</Link>} />;
  const requester = state.employees.find((item) => item.id === ticket.employeeId);
  return (
    <div>
      <PageHeader
        title={ticket.subject}
        subtitle={`${ticket.number} · ${ticket.category}`}
        crumbs={[{ label: "Tickets", to: "/tickets" }, { label: ticket.number }]}
        actions={<><StatusBadge value={ticket.status} /><StatusBadge value={ticket.priority} /></>}
      />
      <div className="grid-2">
        <section className="panel">
          <p>{ticket.description}</p>
          {ticket.attachmentName && <p className="muted">Attachment name: {ticket.attachmentName}</p>}
          {ticket.status === "waiting" && owner && <Banner tone="warning">Support is waiting for your reply.</Banner>}
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
          {owner && ticket.status === "resolved" && <Button variant="secondary" onClick={() => actions.reopenTicket(ticket.id)}>Reopen ticket</Button>}
        </section>
        <section className="panel">
          <h2>Details</h2>
          <dl className="dl">
            <dt>Requester</dt><dd>{requester ? fullName(requester) : "—"}</dd>
            <dt>Assignee</dt><dd>{ticket.assigneeId ? fullName(state.employees.find((item) => item.id === ticket.assigneeId)!) : "Unassigned"}</dd>
            <dt>Opened</dt><dd>{formatDateTime(ticket.createdAt)}</dd>
          </dl>
          {manage && (
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

import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Banner, Button, DataTable, Field, PageHeader, Pager, StatusBadge, usePage } from "../components/ui";
import { formatDate, fullName } from "../lib/format";
import { useApp } from "../store/store";
import type { TicketPriority } from "../types";

export function Tickets() {
  const { state, user, actions } = useApp();
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState(state.settings.ticketCategories[0] ?? "HR");
  const [priority, setPriority] = useState<TicketPriority>("medium");
  const [attachmentName, setAttachment] = useState("");
  const [error, setError] = useState("");
  const [params, setParams] = useSearchParams();
  const [openForm, setOpenForm] = useState(params.get("new") === "1");
  const setForm = (open: boolean) => {
    setOpenForm(open);
    if (!open && params.get("new")) {
      const next = new URLSearchParams(params);
      next.delete("new");
      setParams(next, { replace: true });
    }
  };
  if (!user) return null;
  const rows = state.tickets.filter((item) => item.employeeId === user.id || user.role === "hr" || user.role === "admin" || (user.role === "payroll" && item.category === "Payroll") || item.assigneeId === user.id);
  const page = usePage(rows, 8, String(rows.length));
  return (
    <div>
      <PageHeader title="Tickets" subtitle="Ask HR, payroll, IT, or facilities for help and follow the status." actions={<Button onClick={() => setForm(!openForm)}>{openForm ? "Close form" : "New ticket"}</Button>} />
      {openForm && (
        <section className="panel narrow">
          <h2>New ticket</h2>
          <form noValidate onSubmit={async (event) => {
            event.preventDefault();
            const result = await actions.createTicket({ subject, description, category, priority, attachmentName });
            if (!result.ok) setError(result.message);
            else { setError(""); setSubject(""); setDescription(""); setAttachment(""); setForm(false); }
          }}>
            {error && <Banner tone="error">{error}</Banner>}
            <Field label="Subject"><input value={subject} onChange={(event) => setSubject(event.target.value)} /></Field>
            <div className="form-grid">
              <Field label="Category">
                <select value={category} onChange={(event) => setCategory(event.target.value)}>
                  {state.settings.ticketCategories.map((item) => <option key={item}>{item}</option>)}
                </select>
              </Field>
              <Field label="Priority">
                <select value={priority} onChange={(event) => setPriority(event.target.value as TicketPriority)}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </Field>
            </div>
            <Field label="Description"><textarea value={description} onChange={(event) => setDescription(event.target.value)} /></Field>
            <Field label="Attachment (optional)" hint="The demo stores the file name only.">
              <input type="file" onChange={(event) => setAttachment(event.target.files?.[0]?.name ?? "")} />
            </Field>
            <p className="muted">This goes to the {category} queue. Facilities requests are handled with HR.</p>
            <Button type="submit">Create ticket</Button>
          </form>
        </section>
      )}
      <DataTable
        caption="Tickets"
        rows={page.slice}
        rowKey={(row) => row.id}
        emptyTitle="No tickets"
        emptyBody="Create a ticket when you need help from HR, payroll, IT, or facilities."
        columns={[
          { key: "no", header: "Ticket", render: (row) => <Link to={`/tickets/${row.id}`}>{row.number}</Link> },
          { key: "subject", header: "Subject", render: (row) => row.subject },
          { key: "who", header: "Requester", render: (row) => fullName(state.employees.find((item) => item.id === row.employeeId)!) },
          { key: "cat", header: "Category", render: (row) => row.category },
          { key: "priority", header: "Priority", render: (row) => <StatusBadge value={row.priority} /> },
          { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
          { key: "updated", header: "Updated", render: (row) => formatDate(row.updatedAt) },
        ]}
      />
      <Pager page={page.page} count={page.count} total={page.total} onPage={page.setPage} />
    </div>
  );
}

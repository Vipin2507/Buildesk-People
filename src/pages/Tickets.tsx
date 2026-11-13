import { useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { Banner, Button, DataTable, Field, PageHeader, Pager, StatusBadge, usePage } from "../components/ui";
import { canManageHrMeeting, canManageTicket } from "../lib/access";
import { emptyMeetingSlot, hrMeetingTopics, isHrMeetingTicket } from "../domain/hr-meeting";
import { formatDate, fullName } from "../lib/format";
import { useApp } from "../store/store";
import type { HrMeetingSlot, TicketPriority } from "../types";
import { MeetingSlotFields } from "./HrMeetings";

export function Tickets() {
  const { state, user, actions } = useApp();
  const [params, setParams] = useSearchParams();
  if (params.get("tab") === "meetings") return <Navigate to="/tickets/meetings" replace />;

  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState(state.settings.ticketCategories[0] ?? "HR");
  const [priority, setPriority] = useState<TicketPriority>("medium");
  const [attachmentName, setAttachment] = useState("");
  const [kind, setKind] = useState<"support" | "hr_meeting">("support");
  const [requestType, setRequestType] = useState<"teams" | "phone">("teams");
  const [topic, setTopic] = useState(hrMeetingTopics(state)[0] ?? "Other");
  const [preferred, setPreferred] = useState<HrMeetingSlot>(emptyMeetingSlot(state.settings.timezone || "Asia/Kolkata"));
  const [useAlt, setUseAlt] = useState(false);
  const [alternative, setAlternative] = useState<HrMeetingSlot>(emptyMeetingSlot(state.settings.timezone || "Asia/Kolkata"));
  const [contactNote, setContactNote] = useState("");
  const [error, setError] = useState("");
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
  const hrAccess = canManageHrMeeting(state, user);
  const rows = state.tickets.filter((item) => item.employeeId === user.id || canManageTicket(state, user, item) || item.assigneeId === user.id);
  const page = usePage(rows, 8, String(rows.length));
  return (
    <div>
      <PageHeader
        title="Tickets"
        subtitle="Ask HR, payroll, IT, or facilities for help — or request an HR Teams meeting / call."
        actions={
          <div className="actions">
            {hrAccess && <Link className="btn btn-secondary" to="/tickets/meetings">HR Meetings</Link>}
            <Button onClick={() => setForm(!openForm)}>{openForm ? "Close form" : "New ticket"}</Button>
          </div>
        }
      />
      {openForm && (
        <section className="panel narrow">
          <h2>New ticket</h2>
          <form noValidate onSubmit={async (event) => {
            event.preventDefault();
            const result = await actions.createTicket({
              subject: kind === "hr_meeting" ? (subject.trim() || `HR ${requestType === "teams" ? "Teams meeting" : "call"} – ${topic}`) : subject,
              description,
              category,
              priority,
              attachmentName,
              kind,
              meeting: kind === "hr_meeting"
                ? {
                    requestType,
                    topic,
                    preferred,
                    alternative: useAlt ? alternative : null,
                    contactNote,
                  }
                : undefined,
            });
            if (!result.ok) setError(result.message);
            else {
              setError("");
              setSubject("");
              setDescription("");
              setAttachment("");
              setContactNote("");
              setForm(false);
            }
          }}>
            {error && <Banner tone="error">{error}</Banner>}
            <Field label="Request kind">
              <select value={kind} onChange={(event) => setKind(event.target.value as "support" | "hr_meeting")}>
                <option value="support">General support ticket</option>
                <option value="hr_meeting">HR call / Teams meeting</option>
              </select>
            </Field>
            {kind === "hr_meeting" ? (
              <>
                <Banner tone="info">
                  Your preferred slot is not confirmed until HR approves it. Sensitive details stay visible only to you and authorized HR.
                </Banner>
                <Field label="Meeting type" hint="Phone requests create a calendar hold with contact instructions. A PSTN dial-in is not created unless separately configured.">
                  <select value={requestType} onChange={(event) => setRequestType(event.target.value as "teams" | "phone")}>
                    <option value="teams">Teams meeting (video + audio)</option>
                    <option value="phone">Call via Teams audio / phone contact</option>
                  </select>
                </Field>
                <Field label="Topic">
                  <select value={topic} onChange={(event) => setTopic(event.target.value)}>
                    {hrMeetingTopics(state).map((item) => <option key={item}>{item}</option>)}
                  </select>
                </Field>
                <Field label="Subject (optional)" hint="Defaults to a neutral HR meeting title if left blank.">
                  <input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder={`HR ${requestType === "teams" ? "Teams meeting" : "call"} – ${topic}`} />
                </Field>
                <Field label="Short description"><textarea value={description} onChange={(event) => setDescription(event.target.value)} /></Field>
                <h3>Preferred time</h3>
                <MeetingSlotFields slot={preferred} onChange={setPreferred} />
                <label className="check">
                  <input type="checkbox" checked={useAlt} onChange={(event) => setUseAlt(event.target.checked)} />
                  Suggest an alternative time
                </label>
                {useAlt && <MeetingSlotFields slot={alternative} onChange={setAlternative} />}
                <Field label="Contact preference / note (optional)">
                  <input value={contactNote} onChange={(event) => setContactNote(event.target.value)} placeholder="e.g. Prefer afternoon; mobile OK" />
                </Field>
                <Field label="Attachment (optional)" hint="File name is stored with existing secure handling conventions.">
                  <input type="file" onChange={(event) => setAttachment(event.target.files?.[0]?.name ?? "")} />
                </Field>
                <Field label="Priority">
                  <select value={priority} onChange={(event) => setPriority(event.target.value as TicketPriority)}>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </Field>
              </>
            ) : (
              <>
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
                <Field label="Attachment (optional)" hint="The file name is stored. The file itself is not uploaded.">
                  <input type="file" onChange={(event) => setAttachment(event.target.files?.[0]?.name ?? "")} />
                </Field>
                <p className="muted">This goes to the {category} queue. Facilities requests are handled with HR.</p>
              </>
            )}
            <Button type="submit">{kind === "hr_meeting" ? "Submit HR meeting request" : "Create ticket"}</Button>
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
          { key: "kind", header: "Kind", render: (row) => <StatusBadge value={row.kind === "hr_meeting" ? "hr_meeting" : "support"} /> },
          { key: "who", header: "Requester", render: (row) => fullName(state.employees.find((item) => item.id === row.employeeId)!) },
          { key: "cat", header: "Category", render: (row) => isHrMeetingTicket(row) ? row.meeting?.topic || "HR" : row.category },
          { key: "priority", header: "Priority", render: (row) => <StatusBadge value={row.priority} /> },
          {
            key: "status",
            header: "Status",
            render: (row) => isHrMeetingTicket(row) && row.meeting
              ? <StatusBadge value={row.meeting.meetingStatus} />
              : <StatusBadge value={row.status} />,
          },
          { key: "updated", header: "Updated", render: (row) => formatDate(row.updatedAt) },
        ]}
      />
      <Pager page={page.page} count={page.count} total={page.total} onPage={page.setPage} />
    </div>
  );
}

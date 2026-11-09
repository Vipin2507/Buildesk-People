import { useState } from "react";
import { MonthCalendar } from "../components/calendar";
import { Banner, Button, DecisionDialog, EmptyState, Field, PageHeader, StatusBadge, Tabs } from "../components/ui";
import { canReview } from "../lib/access";
import { todayIso } from "../domain/dates";
import { defaultCompOffExpiry, leaveSummaries } from "../domain/leave";
import { formatDate, fullName, rangeLabel } from "../lib/format";
import { useTab } from "../lib/useTab";
import { useApp } from "../store/store";
import type { Holiday, LeaveRequest, PartialDay } from "../types";

export function Leave() {
  const { user, can, state } = useApp();
  if (!user) return null;
  const approvals = state.leaveRequests.filter((item) => item.status === "pending" && canReview(state, user, item.employeeId, "leave")).length;
  const tabs = [
    { id: "mine", label: "My leave" },
    ...(can("leave.approve") ? [{ id: "approvals", label: "Approvals", count: approvals }] : []),
    { id: "calendar", label: "Calendar" },
    { id: "holidays", label: "Holidays and events" },
    { id: "compoff", label: "Comp-off" },
  ];
  const [tab, setTab] = useTab(tabs.map((item) => item.id), "mine");
  return (
    <div>
      <PageHeader title="Leave" subtitle="Balances, requests, holidays, and comp-off. Weekends and location holidays are not counted." />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === "mine" && <MyLeave />}
      {tab === "approvals" && <Approvals />}
      {tab === "calendar" && <LeaveCalendar />}
      {tab === "holidays" && <Holidays />}
      {tab === "compoff" && <CompOff />}
    </div>
  );
}

function MyLeave() {
  const { state, user, actions } = useApp();
  const [typeId, setType] = useState("casual");
  const [startDate, setStart] = useState("");
  const [endDate, setEnd] = useState("");
  const [partial, setPartial] = useState<PartialDay>("none");
  const [reason, setReason] = useState("");
  const [attachmentName, setAttachment] = useState("");
  const [error, setError] = useState("");
  if (!user) return null;
  const summaries = leaveSummaries(state, user.id);
  const mine = state.leaveRequests.filter((item) => item.employeeId === user.id);
  return (
    <div className="grid-2">
      <section className="panel">
        <h2>Balances this year</h2>
        {summaries.map((item) => (
          <div key={item.typeId} className="notice">
            <div>
              <strong>{item.name}</strong>
              <div className="muted">
                {item.available === null ? "No annual cap" : `${item.available} available`} · {item.used} used · {item.pending} pending
                {item.entitled !== null ? ` · ${item.entitled} entitled` : ""}
                {item.nextExpiry ? ` · soonest expiry ${formatDate(item.nextExpiry)}` : ""}
              </div>
            </div>
            <StatusBadge value={item.paid ? "approved" : "pending"} />
          </div>
        ))}
        <h2>My requests</h2>
        {mine.length === 0 && <EmptyState title="No leave requests" body="Submit a request when you need time away." />}
        {mine.map((item) => <RequestRow key={item.id} item={item} />)}
      </section>
      <section className="panel">
        <h2>Request leave</h2>
        <form noValidate onSubmit={async (event) => {
          event.preventDefault();
          const result = await actions.submitLeave({ typeId, startDate, endDate, partial, reason, attachmentName });
          if (!result.ok) setError(result.message);
          else { setError(""); setReason(""); setAttachment(""); }
        }}>
          {error && <Banner tone="error">{error}</Banner>}
          <Field label="Type">
            <select value={typeId} onChange={(event) => setType(event.target.value)}>
              {state.settings.leaveTypes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </Field>
          <div className="form-grid">
            <Field label="Start"><input type="date" value={startDate} onChange={(event) => setStart(event.target.value)} /></Field>
            <Field label="End"><input type="date" value={endDate} onChange={(event) => setEnd(event.target.value)} /></Field>
          </div>
          <Field label="Day portion">
            <select value={partial} onChange={(event) => setPartial(event.target.value as PartialDay)}>
              <option value="none">Full day</option>
              <option value="first_half">First half</option>
              <option value="second_half">Second half</option>
            </select>
          </Field>
          <Field label="Reason"><textarea value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
          <Field label="Attachment (optional)" hint="The file name is stored. The file itself is not uploaded.">
            <input type="file" onChange={(event) => setAttachment(event.target.files?.[0]?.name ?? "")} />
          </Field>
          <Button type="submit">Submit request</Button>
        </form>
      </section>
    </div>
  );
}

function RequestRow({ item }: { item: LeaveRequest }) {
  const { state } = useApp();
  const type = state.settings.leaveTypes.find((entry) => entry.id === item.typeId);
  return (
    <div className="notice">
      <div>
        <strong>{type?.name ?? "Leave"} · {rangeLabel(item.startDate, item.endDate)}</strong>
        <div className="muted">{item.days} day{item.days === 1 ? "" : "s"} · {item.reason}</div>
        {item.reviewComment && <div className="muted">Reviewer: {item.reviewComment}</div>}
      </div>
      <StatusBadge value={item.status} />
    </div>
  );
}

function Approvals() {
  const { state, user, actions } = useApp();
  const [active, setActive] = useState<LeaveRequest | null>(null);
  const [decision, setDecision] = useState<"approved" | "rejected">("approved");
  if (!user) return null;
  const rows = state.leaveRequests.filter((item) => item.status === "pending" && canReview(state, user, item.employeeId, "leave"));
  return (
    <section className="panel">
      <h2>Waiting for your review</h2>
      {rows.length === 0 && <EmptyState title="Nothing to review" body="New requests from your team, or from employees whose manager can't review, will show up here." />}
      {rows.map((item) => {
        const person = state.employees.find((entry) => entry.id === item.employeeId);
        const type = state.settings.leaveTypes.find((entry) => entry.id === item.typeId);
        return (
          <div key={item.id} className="notice">
            <div>
              <strong>{person ? fullName(person) : "Employee"} · {type?.name}</strong>
              <div className="muted">{rangeLabel(item.startDate, item.endDate)} · {item.days} day{item.days === 1 ? "" : "s"} · {item.reason}</div>
            </div>
            <div className="actions">
              <Button size="sm" onClick={async () => { setActive(item); setDecision("approved"); }}>Approve</Button>
              <Button size="sm" variant="danger" onClick={async () => { setActive(item); setDecision("rejected"); }}>Reject</Button>
            </div>
          </div>
        );
      })}
      <DecisionDialog
        open={Boolean(active)}
        title={decision === "approved" ? "Approve leave" : "Reject leave"}
        body={active ? `${fullName(state.employees.find((item) => item.id === active.employeeId)!)} · ${rangeLabel(active.startDate, active.endDate)}` : ""}
        confirmLabel={decision === "approved" ? "Approve leave" : "Reject leave"}
        tone={decision === "approved" ? "primary" : "danger"}
        requireComment={decision === "rejected"}
        onClose={() => setActive(null)}
        onConfirm={async (comment) => {
          if (!active) return;
          const result = await actions.decideLeave(active.id, decision, comment);
          if (result.ok) setActive(null);
        }}
      />
    </section>
  );
}

function LeaveCalendar() {
  const { state, user, can } = useApp();
  if (!user) return null;
  const markers = [
    ...state.holidays.filter((item) => item.locationId === "all" || item.locationId === user.locationId || can("leave.manage")).map((item) => ({ date: item.date, label: item.name })),
    ...state.leaveRequests.filter((item) => item.status === "approved" && (item.employeeId === user.id || can("leave.team") || can("leave.manage"))).flatMap((item) => {
      const person = state.employees.find((entry) => entry.id === item.employeeId);
      return [{ date: item.startDate, label: `${person ? fullName(person) : "Leave"} on leave` }];
    }),
  ];
  return (
    <section className="panel">
      <h2>{can("leave.team") || can("leave.manage") ? "Team and company calendar" : "My calendar"}</h2>
      <MonthCalendar markers={markers} />
    </section>
  );
}

function Holidays() {
  const { state, user, can, actions } = useApp();
  const [holiday, setHoliday] = useState<Holiday>({ id: "", name: "", date: "", locationId: "all" });
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [locationId, setLocation] = useState("all");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  if (!user) return null;
  const visible = state.holidays.filter((item) => can("leave.manage") || item.locationId === "all" || item.locationId === user.locationId);
  return (
    <div className="grid-2">
      <section className="panel">
        <h2>Holidays for your location</h2>
        {visible.sort((a, b) => a.date.localeCompare(b.date)).map((item) => (
          <div key={item.id} className="notice">
            <div><strong>{item.name}</strong><div className="muted">{formatDate(item.date)} · {item.locationId === "all" ? "All offices" : state.locations.find((loc) => loc.id === item.locationId)?.name}</div></div>
            {can("leave.manage") && <Button size="sm" variant="ghost" onClick={() => actions.deleteHoliday(item.id)}>Remove</Button>}
          </div>
        ))}
        <h2>Events</h2>
        {state.events.filter((item) => can("leave.manage") || item.locationId === "all" || item.locationId === user.locationId).map((item) => (
          <div key={item.id} className="notice">
            <div><strong>{item.title}</strong><div className="muted">{formatDate(item.date)} · {item.description}</div></div>
            {can("leave.manage") && <Button size="sm" variant="ghost" onClick={() => actions.deleteEvent(item.id)}>Remove</Button>}
          </div>
        ))}
      </section>
      {can("leave.manage") ? (
        <section className="panel">
          <h2>Add a holiday</h2>
          {error && <Banner tone="error">{error}</Banner>}
          <Field label="Name"><input value={holiday.name} onChange={(event) => setHoliday({ ...holiday, name: event.target.value })} /></Field>
          <Field label="Date"><input type="date" value={holiday.date} onChange={(event) => setHoliday({ ...holiday, date: event.target.value })} /></Field>
          <Field label="Applies to">
            <select value={holiday.locationId} onChange={(event) => setHoliday({ ...holiday, locationId: event.target.value })}>
              <option value="all">All offices</option>
              {state.locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </Field>
          <Button onClick={async () => {
            const result = await actions.saveHoliday(holiday);
            if (!result.ok) setError(result.message);
            else setHoliday({ id: "", name: "", date: "", locationId: "all" });
          }}>Save holiday</Button>
          <h2>Add an event</h2>
          <Field label="Title"><input value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
          <Field label="Date"><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field>
          <Field label="Location">
            <select value={locationId} onChange={(event) => setLocation(event.target.value)}>
              <option value="all">All offices</option>
              {state.locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </Field>
          <Field label="Description"><textarea value={description} onChange={(event) => setDescription(event.target.value)} /></Field>
          <Button variant="secondary" onClick={async () => {
            const result = await actions.saveEvent({ id: "", title, date, locationId, description, kind: "event" });
            if (!result.ok) setError(result.message);
            else { setTitle(""); setDate(""); setDescription(""); }
          }}>Save event</Button>
        </section>
      ) : <Banner tone="info">Holiday dates follow your work location. Company-wide holidays apply to every office.</Banner>}
    </div>
  );
}

function CompOff() {
  const { state, user, can, actions } = useApp();
  const [employeeId, setEmployee] = useState(user?.id ?? "");
  const [days, setDays] = useState(1);
  const [earnedOn, setEarned] = useState(todayIso());
  const [expiresOn, setExpiry] = useState(defaultCompOffExpiry(todayIso()));
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  if (!user) return null;
  const grants = state.compOff.filter((item) => item.employeeId === user.id || can("leave.manage"));
  return (
    <div className="grid-2">
      <section className="panel">
        <h2>Comp-off records</h2>
        <p className="muted">Available days can be requested as comp-off leave. Expired days are not usable. A new grant expires after 90 days unless a different date is chosen.</p>
        {grants.length === 0 && <EmptyState title="No comp-off" body="When you work on a weekly off, HR can grant a day here." />}
        {grants.map((item) => {
          const expired = item.status === "available" && item.expiresOn < todayIso();
          const person = state.employees.find((entry) => entry.id === item.employeeId);
          return (
            <div key={item.id} className="notice">
              <div>
                <strong>{person ? fullName(person) : "Employee"} · {item.days} day{item.days === 1 ? "" : "s"}</strong>
                <div className="muted">{item.reason} · earned {formatDate(item.earnedOn)} · expires {formatDate(item.expiresOn)}</div>
              </div>
              <StatusBadge value={expired ? "inactive" : item.status === "used" ? "used" : "available"} />
            </div>
          );
        })}
      </section>
      {can("leave.manage") && (
        <section className="panel">
          <h2>Grant comp-off</h2>
          {error && <Banner tone="error">{error}</Banner>}
          <Field label="Employee">
            <select value={employeeId} onChange={(event) => setEmployee(event.target.value)}>
              {state.employees.filter((item) => item.status !== "inactive").map((item) => <option key={item.id} value={item.id}>{fullName(item)}</option>)}
            </select>
          </Field>
          <Field label="Days"><input type="number" min={0.5} step={0.5} value={days} onChange={(event) => setDays(Number(event.target.value))} /></Field>
          <Field label="Earned on"><input type="date" value={earnedOn} onChange={(event) => { setEarned(event.target.value); setExpiry(defaultCompOffExpiry(event.target.value)); }} /></Field>
          <Field label="Expires"><input type="date" value={expiresOn} onChange={(event) => setExpiry(event.target.value)} /></Field>
          <Field label="Reason"><textarea value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
          <Button onClick={async () => {
            const result = await actions.grantCompOff({ employeeId, days, earnedOn, expiresOn, reason });
            if (!result.ok) setError(result.message);
            else { setError(""); setReason(""); }
          }}>Grant comp-off</Button>
        </section>
      )}
    </div>
  );
}

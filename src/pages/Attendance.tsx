import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, Check, Clock, Palmtree, X } from "lucide-react";
import { ClockCard } from "../components/clock";
import { LocationView } from "../components/location-view";
import { Banner, Button, DataTable, DatePicker, DecisionDialog, Field, Modal, PageHeader, Pager, PersonLink, StatusBadge, Tabs, Timeline, TimePicker, usePage } from "../components/ui";
import { dayFlags, recordOn, type DayFlags } from "../domain/attendance";
import { punchLocationText } from "../domain/location";
import { addDays, todayIso } from "../domain/dates";
import { canReview } from "../lib/access";
import { downloadCsv } from "../lib/download";
import { formatDate, formatDateTime, formatDuration, formatTime, fullName, labelFor } from "../lib/format";
import { photoSrc } from "../lib/photo";
import { useTab } from "../lib/useTab";
import { useApp } from "../store/store";
import type { AttendanceRecord, Employee, RegularizationRequest } from "../types";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function Attendance() {
  const { user, can } = useApp();
  const tabs = [
    { id: "mine", label: "My attendance" },
    { id: "corrections", label: "Corrections" },
    ...(can("attendance.team") ? [{ id: "team", label: "Team" }] : []),
    ...(can("attendance.company") ? [{ id: "company", label: "Company" }] : []),
  ];
  const [tab, setTab] = useTab(tabs.map((item) => item.id), "mine");
  if (!user) return null;
  return (
    <div>
      <PageHeader title="Attendance" subtitle="Record today, then review history, corrections, and the people you are allowed to see." />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === "mine" && <Mine />}
      {tab === "corrections" && <Corrections />}
      {tab === "team" && can("attendance.team") && <DayBoard mode="team" />}
      {tab === "company" && can("attendance.company") && <DayBoard mode="company" />}
    </div>
  );
}

function Mine() {
  const { state, user } = useApp();
  const [params, setParams] = useSearchParams();
  const [from, setFrom] = useState(addDays(todayIso(), -30));
  const [to, setTo] = useState(todayIso());
  const [status, setStatus] = useState("all");
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<AttendanceRecord | null>(null);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const requested = params.get("correct") === "1" || window.location.hash === "#correction";
    if (!requested) return;
    setOpen(true);
    if (params.get("correct") === "1") {
      const next = new URLSearchParams(params);
      next.delete("correct");
      setParams(next, { replace: true });
    }
    if (window.location.hash === "#correction") {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    }
  }, [params, setParams]);
  const rangeInvalid = !from || !to || from > to;
  const rows = !user || rangeInvalid
    ? []
    : state.attendance
        .filter((item) => item.employeeId === user.id && item.date >= from && item.date <= to && (status === "all" || item.status === status))
        .sort((a, b) => b.date.localeCompare(a.date));
  const page = usePage(rows, 8, `${from}|${to}|${status}`);
  if (!user) return null;
  return (
    <div>
      <ClockCard />
      <section className="panel">
        <div className="panel-head">
          <h2>Attendance history</h2>
          <Button onClick={() => { setNotice(""); setOpen(true); }}>Request correction</Button>
        </div>
        <p className="muted">Corrections open in a separate request so they don't sit next to today's clock-in.</p>
        {notice && <Banner tone="success">{notice}</Banner>}
        {rangeInvalid && <Banner tone="error">Choose a start date that is on or before the end date.</Banner>}
        <div className="filters">
          <label className="field">From<DatePicker value={from} onChange={setFrom} /></label>
          <label className="field">To<DatePicker value={to} onChange={setTo} min={from || undefined} /></label>
          <label className="field">Status
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="all">All</option>
              <option value="present">Present</option>
              <option value="late">Late</option>
              <option value="absent">Absent</option>
              <option value="leave">On leave</option>
              <option value="incomplete">Missed punch</option>
              <option value="holiday">Holiday</option>
            </select>
          </label>
        </div>
        <DataTable
          className="cards-on-mobile"
          caption="My attendance history"
          rows={page.slice}
          rowKey={(row) => row.id}
          emptyTitle={rangeInvalid ? "Dates need adjusting" : "No attendance in this range"}
          emptyBody={rangeInvalid ? "Set the start date on or before the end date." : "Change the dates or clock in to start today's record."}
          columns={[
            { key: "date", header: "Date", render: (row) => formatDate(row.date) },
            { key: "status", header: "Status", render: (row) => <Mark value={row.status} /> },
            { key: "where", header: "Work location", render: (row) => row.workMode ? labelFor(row.workMode) : "—" },
            { key: "in", header: "Clock in", render: (row) => formatTime(row.clockIn) },
            { key: "out", header: "Clock out", render: (row) => formatTime(row.clockOut) },
            { key: "hours", header: "Hours", render: (row) => formatDuration(row.clockIn, row.clockOut) },
            { key: "device", header: "Device location", render: (row) => punchLocationText(row) },
            { key: "exception", header: "Exception", render: (row) => exceptionMark(row) },
            { key: "correction", header: "Correction", render: (row) => correctionMark(state.regularizations, row.employeeId, row.date) },
            { key: "details", header: "Details", render: (row) => <Button size="sm" variant="secondary" onClick={() => setSelected(row)}>View</Button> },
          ]}
        />
        <Pager page={page.page} count={page.count} total={page.total} onPage={page.setPage} />
      </section>
      <CorrectionDialog open={open} onClose={() => setOpen(false)} onSubmitted={() => setNotice("Correction submitted. Track the status and reviewer comments under Corrections.")} />
      <RecordDialog record={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function CorrectionDialog({ open, onClose, onSubmitted }: { open: boolean; onClose: () => void; onSubmitted: () => void }) {
  const { state, user, actions } = useApp();
  const [step, setStep] = useState<"edit" | "review">("edit");
  const [date, setDate] = useState(addDays(todayIso(), -1));
  const [requestedIn, setIn] = useState(state.settings.workStart);
  const [requestedOut, setOut] = useState("");
  const [reason, setReason] = useState("");
  const [attachmentName, setAttachment] = useState("");
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (open) setStep("edit");
  }, [open]);
  if (!user) return null;
  const existing = recordOn(state, user.id, date);
  const validate = () => {
    const next: Record<string, string> = {};
    if (!date) next.date = "Choose the date to correct.";
    else if (date > todayIso()) next.date = "You can only correct a date that has already started.";
    else if (state.regularizations.some((item) => item.employeeId === user.id && item.date === date && item.status === "pending")) {
      next.date = "You already have a pending correction for this date.";
    }
    if (!requestedIn) next.in = "Enter a clock-in time.";
    if (!requestedOut) next.out = "Enter a clock-out time.";
    if (requestedIn && requestedOut && requestedOut <= requestedIn) next.out = "Clock-out must be after clock-in.";
    if (reason.trim().length < 8) next.reason = "Add a short reason (at least 8 characters).";
    setFields(next);
    setError(Object.keys(next).length ? "Fix the highlighted fields before continuing." : "");
    return Object.keys(next).length === 0;
  };
  const submit = async () => {
    setPending(true);
    const result = await actions.submitRegularization({ date, requestedIn, requestedOut, reason, attachmentName });
    setPending(false);
    if (!result.ok) {
      setStep("edit");
      setError(result.message);
      return;
    }
    setReason("");
    setAttachment("");
    setOut("");
    setError("");
    setFields({});
    onSubmitted();
    onClose();
  };
  return (
    <Modal open={open} title={step === "edit" ? "Request a correction" : "Review correction"} onClose={onClose}>
      <p className="muted">If this is approved, that day's attendance is updated. The request, including the original punches, stays in the audit trail.</p>
      {error && <Banner tone="error">{error}</Banner>}
      {step === "edit" ? (
        <>
          <Field label="Date" error={fields.date}>
            <DatePicker value={date} onChange={setDate} aria-invalid={Boolean(fields.date)} />
          </Field>
          <div className="form-grid">
            <Field label="Requested clock-in" error={fields.in}>
              <TimePicker value={requestedIn} onChange={setIn} aria-invalid={Boolean(fields.in)} />
            </Field>
            <Field label="Requested clock-out" error={fields.out}>
              <TimePicker value={requestedOut} onChange={setOut} sameAs={requestedIn} aria-invalid={Boolean(fields.out)} />
            </Field>
          </div>
          <Field label="Reason" error={fields.reason}>
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} />
          </Field>
          <Field label="Attachment (optional)" hint="The file name is stored with the request. The file itself is not uploaded.">
            <input type="file" onChange={(event) => setAttachment(event.target.files?.[0]?.name ?? "")} />
          </Field>
          {attachmentName && (
            <p className="muted">Selected: {attachmentName} <Button size="sm" variant="ghost" onClick={() => setAttachment("")}>Remove</Button></p>
          )}
          <div className="actions">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={() => { if (validate()) { setError(""); setStep("review"); } }}>Review request</Button>
          </div>
        </>
      ) : (
        <>
          <dl className="dl">
            <dt>Date</dt><dd>{formatDate(date)}</dd>
            <dt>Original punches</dt><dd>{formatTime(existing?.clockIn ?? null)} – {formatTime(existing?.clockOut ?? null)}</dd>
            <dt>Requested punches</dt><dd>{formatTime(`${date}T${requestedIn}`)} – {formatTime(`${date}T${requestedOut}`)}</dd>
            <dt>Reason</dt><dd>{reason.trim()}</dd>
            <dt>Attachment</dt><dd>{attachmentName || "None"}</dd>
          </dl>
          <div className="actions">
            <Button variant="secondary" onClick={() => setStep("edit")}>Back</Button>
            <Button onClick={submit} disabled={pending}>{pending ? "Submitting…" : "Submit correction"}</Button>
          </div>
        </>
      )}
    </Modal>
  );
}

function RecordDialog({ record, onClose }: { record: AttendanceRecord | null; onClose: () => void }) {
  const { state, user } = useApp();
  if (!record || !user) return null;
  const person = state.employees.find((item) => item.id === record.employeeId);
  const correction = latestCorrection(state.regularizations, record.employeeId, record.date);
  const reviewer = correction?.reviewerId ? state.employees.find((item) => item.id === correction.reviewerId) : null;
  return (
    <Modal open title="Attendance details" onClose={onClose}>
      <dl className="dl">
        {person && person.id !== user.id && <><dt>Employee</dt><dd>{fullName(person)}</dd></>}
        <dt>Date</dt><dd>{formatDate(record.date)}</dd>
        <dt>Status</dt><dd><Mark value={record.status} /></dd>
        <dt>Work location</dt><dd>{record.workMode ? labelFor(record.workMode) : "Not recorded"}</dd>
        <dt>Clock in</dt><dd>{formatTime(record.clockIn)}</dd>
        <dt>Clock out</dt><dd>{formatTime(record.clockOut)}</dd>
        <dt>Hours</dt><dd>{formatDuration(record.clockIn, record.clockOut)}</dd>
        <dt>Source</dt><dd>{labelFor(record.source)}</dd>
        {record.note && <><dt>Note</dt><dd>{record.note}</dd></>}
        <dt>Correction</dt><dd>{correction ? <Mark value={correction.status} /> : "None"}</dd>
        {correction?.reviewComment && <><dt>Reviewer comment</dt><dd>{correction.reviewComment}</dd></>}
        {reviewer && correction?.reviewedAt && <><dt>Reviewed</dt><dd>{fullName(reviewer)} · {formatDateTime(correction.reviewedAt)}</dd></>}
      </dl>
      <LocationView label="Clock-in device location" fix={record.clockInLocation} recordId={record.id} which="in" />
      <LocationView label="Clock-out device location" fix={record.clockOutLocation} recordId={record.id} which="out" />
      <p className="muted">The selected work location is separate from the device position.</p>
      <Button variant="secondary" onClick={onClose}>Close</Button>
    </Modal>
  );
}

function Corrections() {
  const { state, user, can, actions } = useApp();
  const [view, setView] = useState("mine");
  const [detail, setDetail] = useState<RegularizationRequest | null>(null);
  const [decision, setDecision] = useState<{ request: RegularizationRequest; kind: "approved" | "rejected" } | null>(null);
  const [inTime, setIn] = useState("");
  const [outTime, setOut] = useState("");
  const [decisionError, setDecisionError] = useState("");
  const showReview = can("attendance.review");
  const mine = user ? state.regularizations.filter((item) => item.employeeId === user.id) : [];
  const review = user ? state.regularizations.filter((item) => item.status === "pending" && canReview(state, user, item.employeeId, "attendance")) : [];
  const minePage = usePage(mine, 8, mine.map((item) => item.id + item.status).join("|"));
  const reviewPage = usePage(review, 8, review.map((item) => item.id).join("|"));
  if (!user) return null;
  const activeView = showReview && view === "review" ? "review" : "mine";
  const openDecision = (request: RegularizationRequest, kind: "approved" | "rejected") => {
    setDetail(null);
    setDecision({ request, kind });
    setIn(request.requestedIn);
    setOut(request.requestedOut);
    setDecisionError("");
  };
  return (
    <section className="panel">
      <h2>Corrections</h2>
      <p className="muted">Your own requests stay separate from requests waiting for your review. Rejected requests do not change attendance.</p>
      {showReview && (
        <Tabs
          tabs={[
            { id: "mine", label: "My requests", count: mine.length },
            { id: "review", label: "Awaiting my review", count: review.length },
          ]}
          value={activeView}
          onChange={setView}
        />
      )}
      {activeView === "mine" ? (
        <DataTable
          className="cards-on-mobile"
          caption="My correction requests"
          rows={minePage.slice}
          rowKey={(row) => row.id}
          emptyTitle="No corrections yet"
          emptyBody="Use Request correction on My attendance when a punch is missing or wrong."
          columns={[
            { key: "date", header: "Date", render: (row) => formatDate(row.date) },
            { key: "req", header: "Requested", render: (row) => `${row.requestedIn} – ${row.requestedOut}` },
            { key: "orig", header: "Original", render: (row) => `${formatTime(row.originalIn)} – ${formatTime(row.originalOut)}` },
            { key: "status", header: "Status", render: (row) => <Mark value={row.status} /> },
            { key: "comment", header: "Reviewer comment", render: (row) => row.reviewComment || "—" },
            { key: "details", header: "Details", render: (row) => <Button size="sm" variant="secondary" onClick={() => setDetail(row)}>View</Button> },
          ]}
        />
      ) : (
        <DataTable
          className="cards-on-mobile"
          caption="Corrections awaiting review"
          rows={reviewPage.slice}
          rowKey={(row) => row.id}
          emptyTitle="Nothing is waiting for you"
          emptyBody="Pending corrections assigned to you will appear here."
          columns={[
            { key: "who", header: "Employee", render: (row) => employeeName(state.employees, row.employeeId) },
            { key: "date", header: "Date", render: (row) => formatDate(row.date) },
            { key: "orig", header: "Original punches", render: (row) => `${formatTime(row.originalIn)} – ${formatTime(row.originalOut)}` },
            { key: "req", header: "Requested punches", render: (row) => `${row.requestedIn} – ${row.requestedOut}` },
            { key: "reason", header: "Reason", render: (row) => row.reason },
            { key: "submitted", header: "Submitted", render: (row) => formatDateTime(row.submittedAt) },
            { key: "status", header: "Status", render: (row) => <Mark value={row.status} /> },
            { key: "action", header: "Actions", render: (row) => (
              <div className="actions">
                <Button size="sm" variant="secondary" onClick={() => setDetail(row)}>View</Button>
                <Button size="sm" onClick={() => openDecision(row, "approved")}>Approve</Button>
                <Button size="sm" variant="danger" onClick={() => openDecision(row, "rejected")}>Reject</Button>
              </div>
            ) },
          ]}
        />
      )}
      <Pager
        page={activeView === "mine" ? minePage.page : reviewPage.page}
        count={activeView === "mine" ? minePage.count : reviewPage.count}
        total={activeView === "mine" ? minePage.total : reviewPage.total}
        onPage={activeView === "mine" ? minePage.setPage : reviewPage.setPage}
      />
      <RequestDialog request={detail} onClose={() => setDetail(null)} onDecide={openDecision} />
      <DecisionDialog
        open={Boolean(decision)}
        title={decision?.kind === "rejected" ? "Reject correction" : "Approve correction"}
        body={decision ? `${employeeName(state.employees, decision.request.employeeId)} · ${formatDate(decision.request.date)}. This decision is recorded on the request.` : ""}
        confirmLabel={decision?.kind === "rejected" ? "Reject" : "Approve"}
        tone={decision?.kind === "rejected" ? "danger" : "primary"}
        requireComment={decision?.kind === "rejected"}
        onClose={() => setDecision(null)}
        onConfirm={async (comment) => {
          if (!decision) return;
          if (decision.kind === "approved" && outTime <= inTime) {
            setDecisionError("Clock-out must be after clock-in.");
            return;
          }
          const result = await actions.decideRegularization(
            decision.request.id,
            decision.kind,
            comment,
            decision.kind === "approved" ? { requestedIn: inTime, requestedOut: outTime } : undefined,
          );
          if (!result.ok) setDecisionError(result.message);
          else setDecision(null);
        }}
      >
        {decisionError && <Banner tone="error">{decisionError}</Banner>}
        {decision?.kind === "approved" && (
          <>
            <p className="muted">You can adjust the times before approving. The original request stays on the audit trail.</p>
            <div className="form-grid">
              <Field label="Clock in"><TimePicker value={inTime} onChange={setIn} /></Field>
              <Field label="Clock out"><TimePicker value={outTime} onChange={setOut} sameAs={inTime} /></Field>
            </div>
          </>
        )}
        {decision?.kind === "rejected" && <p className="muted">A comment is required. Attendance for this day is not changed.</p>}
      </DecisionDialog>
    </section>
  );
}

function RequestDialog({
  request,
  onClose,
  onDecide,
}: {
  request: RegularizationRequest | null;
  onClose: () => void;
  onDecide: (request: RegularizationRequest, kind: "approved" | "rejected") => void;
}) {
  const { state, user } = useApp();
  if (!request || !user) return null;
  const reviewer = request.reviewerId ? state.employees.find((item) => item.id === request.reviewerId) : null;
  const attendance = state.attendance.find((item) => item.employeeId === request.employeeId && item.date === request.date);
  const allowed = request.status === "pending" && canReview(state, user, request.employeeId, "attendance");
  return (
    <Modal open title="Correction details" onClose={onClose}>
      <dl className="dl">
        <dt>Employee</dt><dd>{employeeName(state.employees, request.employeeId)}</dd>
        <dt>Date</dt><dd>{formatDate(request.date)}</dd>
        <dt>Original punches</dt><dd>{formatTime(request.originalIn)} – {formatTime(request.originalOut)}</dd>
        <dt>Requested punches</dt><dd>{request.requestedIn} – {request.requestedOut}</dd>
        {request.appliedIn && <><dt>Applied punches</dt><dd>{request.appliedIn} – {request.appliedOut}</dd></>}
        <dt>Reason</dt><dd>{request.reason}</dd>
        <dt>Attachment</dt><dd>{request.attachmentName || "None"}</dd>
        <dt>Status</dt><dd><Mark value={request.status} /></dd>
        <dt>Submitted</dt><dd>{formatDateTime(request.submittedAt)}</dd>
        {reviewer && request.reviewedAt && <><dt>Reviewed by</dt><dd>{fullName(reviewer)} · {formatDateTime(request.reviewedAt)}</dd></>}
        {request.reviewComment && <><dt>Reviewer comment</dt><dd>{request.reviewComment}</dd></>}
      </dl>
      <LocationView label="Original clock-in location" fix={request.originalClockInLocation} recordId={attendance?.id} which="in" />
      <LocationView label="Original clock-out location" fix={request.originalClockOutLocation} recordId={attendance?.id} which="out" />
      <p className="muted">Approving this correction updates the times and keeps the original device location on the punch and on this request.</p>
      <h3>Audit history</h3>
      <Timeline items={request.history.map((item) => ({
        id: item.id,
        title: item.action,
        meta: `${actorName(state.employees, item.actorId)} · ${formatDateTime(item.at)}`,
        body: item.comment,
      }))} />
      <div className="actions">
        {allowed && <Button onClick={() => onDecide(request, "approved")}>Approve</Button>}
        {allowed && <Button variant="danger" onClick={() => onDecide(request, "rejected")}>Reject</Button>}
        <Button variant="secondary" onClick={onClose}>Close</Button>
      </div>
    </Modal>
  );
}

interface BoardRow {
  key: string;
  person: Employee;
  date: string;
  record: AttendanceRecord | null;
  flags: DayFlags;
}

function DayBoard({ mode }: { mode: "team" | "company" }) {
  const { state, user, can } = useApp();
  const [params] = useSearchParams();
  const initialDate = params.get("date");
  const starting = initialDate && /^\d{4}-\d{2}-\d{2}$/.test(initialDate) ? initialDate : todayIso();
  const [date, setDate] = useState(starting);
  const [from, setFrom] = useState(starting);
  const [to, setTo] = useState(starting);
  const [department, setDepartment] = useState(params.get("department") ?? "all");
  const [location, setLocation] = useState(params.get("location") ?? "all");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [selected, setSelected] = useState<BoardRow | null>(null);
  const teamOnly = params.get("team") === "1";
  useEffect(() => {
    const nextDate = params.get("date");
    if (nextDate && /^\d{4}-\d{2}-\d{2}$/.test(nextDate)) {
      setDate(nextDate);
      setFrom(nextDate);
      setTo(nextDate);
    }
    setDepartment(params.get("department") ?? "all");
    setLocation(params.get("location") ?? "all");
  }, [params]);
  const allowed = mode === "team" ? can("attendance.team") : can("attendance.company");
  const rangeInvalid = mode === "company" && (!from || !to || from > to);
  const focus = mode === "team" ? date : from;
  const singleDay = mode === "team" || from === to;
  const people = !user || !allowed ? [] : state.employees.filter((person) => {
    if (person.status === "inactive") return false;
    if ((mode === "team" || teamOnly) && person.managerId !== user.id) return false;
    if (department !== "all" && person.departmentId !== department) return false;
    if (location !== "all" && person.locationId !== location) return false;
    if (query && !fullName(person).toLowerCase().includes(query.trim().toLowerCase())) return false;
    return true;
  });
  const baseRows: BoardRow[] = rangeInvalid ? [] : singleDay
    ? people.map((person) => {
        const record = recordOn(state, person.id, focus);
        return { key: `${person.id}-${focus}`, person, date: focus, record, flags: dayFlags(state, person, focus, record) };
      })
    : state.attendance
        .filter((item) => item.date >= from && item.date <= to && people.some((person) => person.id === item.employeeId))
        .map((record) => {
          const person = people.find((item) => item.id === record.employeeId)!;
          return { key: record.id, person, date: record.date, record, flags: dayFlags(state, person, record.date, record) };
        })
        .sort((a, b) => b.date.localeCompare(a.date) || fullName(a.person).localeCompare(fullName(b.person)));
  const rows = baseRows.filter((row) => matchesStatus(row, status));
  const page = usePage(rows, 10, `${mode}|${date}|${from}|${to}|${department}|${location}|${teamOnly}|${query}|${status}`);
  if (!user) return null;
  if (!allowed) return <Banner tone="error">You don't have access to this attendance view.</Banner>;
  const counts = {
    present: baseRows.filter((row) => row.flags.present).length,
    remote: baseRows.filter((row) => row.flags.remote).length,
    onLeave: baseRows.filter((row) => row.flags.onLeave).length,
    absent: baseRows.filter((row) => row.flags.absent).length,
    exceptions: baseRows.filter((row) => row.flags.exception).length,
  };
  const offLabel = state.settings.weeklyOff.map((day) => WEEKDAYS[day] ?? "").filter(Boolean).join(", ") || "None";
  const noTeam = mode === "team" && state.employees.filter((person) => person.managerId === user.id && person.status !== "inactive").length === 0;
  const exportRows = () => {
    downloadCsv(`buildesk-attendance-${from}-to-${to}.csv`, [
      ["Employee", "Department", "Office", "Date", "Status", "Clock in", "Clock out", "Hours", "Work location", "Exception"],
      ...rows.map((row) => [
        fullName(row.person),
        departmentName(state.departments, row.person.departmentId),
        officeName(state.locations, row.person.locationId),
        row.date,
        statusText(row),
        row.record?.clockIn ? formatTime(row.record.clockIn) : "",
        row.record?.clockOut ? formatTime(row.record.clockOut) : "",
        row.record ? formatDuration(row.record.clockIn, row.record.clockOut) : "",
        row.record?.workMode ? labelFor(row.record.workMode) : "",
        row.flags.exception ? exceptionText(row) : "",
      ]),
    ]);
  };
  return (
    <section className="panel">
      <div className="spread">
        <div>
          <h2>{mode === "team" ? "Team attendance" : "Company attendance"}</h2>
          <p className="muted">{mode === "team" ? "Direct reports only." : "Company-wide attendance for your role."}{teamOnly ? " Limited to your direct reports." : ""}</p>
        </div>
        {mode === "company" && <Button variant="secondary" onClick={exportRows} disabled={rows.length === 0}>Export CSV</Button>}
      </div>
      <p className="faint">Dates follow this device's local calendar. A separate company timezone is not configured. Weekly off: {offLabel}. Shift {state.settings.workStart}, grace {state.settings.graceMinutes} minutes. A missing punch on a weekly off or location holiday is not marked absent, and late status is not applied on those days.</p>
      {rangeInvalid && <Banner tone="error">Choose a start date that is on or before the end date.</Banner>}
      <div className="filters">
        {mode === "team" ? (
          <label className="field">Date<DatePicker value={date} onChange={setDate} /></label>
        ) : (
          <>
            <label className="field">From<DatePicker value={from} onChange={setFrom} /></label>
            <label className="field">To<DatePicker value={to} onChange={setTo} min={from || undefined} /></label>
          </>
        )}
        <label className="field">Employee<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name" /></label>
        <label className="field">Department
          <select value={department} onChange={(event) => setDepartment(event.target.value)}>
            <option value="all">All departments</option>
            {state.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label className="field">Office
          <select value={location} onChange={(event) => setLocation(event.target.value)}>
            <option value="all">All offices</option>
            {state.locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label className="field">Status
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">All</option>
            <option value="present">Present</option>
            <option value="remote">Working remotely</option>
            <option value="leave">On leave</option>
            <option value="absent">Absent</option>
            <option value="exceptions">Exceptions</option>
            <option value="late">Late</option>
            <option value="incomplete">Missed punch</option>
            <option value="holiday">Holiday</option>
          </select>
        </label>
      </div>
      {!rangeInvalid && people.length > 0 && (
        <div className="snapshot" aria-label={singleDay ? "Attendance summary for the selected day" : "Attendance summary for the selected range"}>
          <SummaryButton label="Present" value={counts.present} pressed={status === "present"} onClick={() => setStatus(status === "present" ? "all" : "present")} />
          <SummaryButton label="Working remotely" value={counts.remote} pressed={status === "remote"} onClick={() => setStatus(status === "remote" ? "all" : "remote")} />
          <SummaryButton label="On leave" value={counts.onLeave} pressed={status === "leave"} onClick={() => setStatus(status === "leave" ? "all" : "leave")} />
          <SummaryButton label="Absent" value={counts.absent} pressed={status === "absent"} onClick={() => setStatus(status === "absent" ? "all" : "absent")} />
          <SummaryButton label="Exceptions" value={counts.exceptions} pressed={status === "exceptions"} onClick={() => setStatus(status === "exceptions" ? "all" : "exceptions")} />
        </div>
      )}
      {!singleDay && !rangeInvalid && <p className="faint">This range lists recorded attendance. Days without a punch are not added as extra rows.</p>}
      <DataTable
        className="cards-on-mobile"
        caption={mode === "team" ? "Team attendance" : "Company attendance"}
        rows={page.slice}
        rowKey={(row) => row.key}
        emptyTitle={noTeam ? "No direct reports" : "No attendance to show"}
        emptyBody={noTeam ? "People who report to you will appear here." : "Adjust the date, search, or filters."}
        columns={[
          ...(singleDay ? [] : [{ key: "date", header: "Date", render: (row: BoardRow) => formatDate(row.date) }]),
          { key: "name", header: "Employee", render: (row: BoardRow) => <PersonLink name={fullName(row.person)} color={row.person.avatarColor} photoSrc={photoSrc(row.person.id, row.person.photoUpdatedAt)} to={`/people/${row.person.id}?tab=attendance`} meta={row.person.jobTitle} /> },
          { key: "team", header: "Team", render: (row: BoardRow) => departmentName(state.departments, row.person.departmentId) },
          { key: "office", header: "Office", render: (row: BoardRow) => officeName(state.locations, row.person.locationId) },
          { key: "in", header: "Clock in", render: (row: BoardRow) => formatTime(row.record?.clockIn ?? null) },
          { key: "out", header: "Clock out", render: (row: BoardRow) => formatTime(row.record?.clockOut ?? null) },
          { key: "hours", header: "Hours", render: (row: BoardRow) => formatDuration(row.record?.clockIn ?? null, row.record?.clockOut ?? null) },
          { key: "where", header: "Work location", render: (row: BoardRow) => row.record?.workMode ? labelFor(row.record.workMode) : "—" },
          { key: "status", header: "Status", render: (row: BoardRow) => <Mark value={statusValue(row)} /> },
          { key: "exception", header: "Exception", render: (row: BoardRow) => row.flags.exception ? <Mark value={row.record?.status === "late" || row.record?.status === "incomplete" ? row.record.status : "absent"} /> : "—" },
          { key: "details", header: "Details", render: (row: BoardRow) => <Button size="sm" variant="secondary" onClick={() => setSelected(row)}>View</Button> },
        ]}
      />
      <Pager page={page.page} count={page.count} total={page.total} onPage={page.setPage} />
      {selected?.record && <RecordDialog record={selected.record} onClose={() => setSelected(null)} />}
      {selected && !selected.record && (
        <Modal open title="Attendance details" onClose={() => setSelected(null)}>
          <dl className="dl">
            <dt>Employee</dt><dd><Link to={`/people/${selected.person.id}?tab=attendance`}>{fullName(selected.person)}</Link></dd>
            <dt>Date</dt><dd>{formatDate(selected.date)}</dd>
            <dt>Status</dt><dd>{statusText(selected)}</dd>
            <dt>Team</dt><dd>{departmentName(state.departments, selected.person.departmentId)}</dd>
            <dt>Office</dt><dd>{officeName(state.locations, selected.person.locationId)}</dd>
          </dl>
          <p className="muted">There is no punch for this day.</p>
          <Button variant="secondary" onClick={() => setSelected(null)}>Close</Button>
        </Modal>
      )}
    </section>
  );
}

function SummaryButton({ label, value, pressed, onClick }: { label: string; value: number; pressed: boolean; onClick: () => void }) {
  return (
    <button type="button" aria-pressed={pressed} onClick={onClick}>
      <strong>{value}</strong>
      <span>{label}</span>
    </button>
  );
}

function Mark({ value }: { value: string }) {
  const Icon = value === "present" || value === "approved" ? Check
    : value === "late" || value === "incomplete" || value === "pending" ? AlertTriangle
    : value === "absent" || value === "rejected" ? X
    : value === "leave" ? Palmtree
    : Clock;
  return (
    <span className="status-mark">
      <Icon size={14} aria-hidden />
      <StatusBadge value={value} />
    </span>
  );
}

function exceptionMark(record: AttendanceRecord) {
  if (record.status === "late" || record.status === "incomplete" || record.status === "absent") return <Mark value={record.status} />;
  return "—";
}

function latestCorrection(items: RegularizationRequest[], employeeId: string, date: string): RegularizationRequest | null {
  const matches = items.filter((item) => item.employeeId === employeeId && item.date === date);
  return matches.find((item) => item.status === "pending") ?? [...matches].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))[0] ?? null;
}

function correctionMark(items: RegularizationRequest[], employeeId: string, date: string) {
  const correction = latestCorrection(items, employeeId, date);
  return correction ? <Mark value={correction.status} /> : "—";
}

function employeeName(people: Employee[], id: string): string {
  const person = people.find((item) => item.id === id);
  return person ? fullName(person) : "Employee";
}

function actorName(people: Employee[], id: string): string {
  return employeeName(people, id);
}

function departmentName(departments: { id: string; name: string }[], id: string): string {
  return departments.find((item) => item.id === id)?.name ?? "—";
}

function officeName(locations: { id: string; name: string }[], id: string): string {
  return locations.find((item) => item.id === id)?.name ?? "—";
}

function matchesStatus(row: BoardRow, status: string): boolean {
  if (status === "all") return true;
  if (status === "present") return row.flags.present;
  if (status === "remote") return row.flags.remote;
  if (status === "leave") return row.flags.onLeave;
  if (status === "absent") return row.flags.absent;
  if (status === "exceptions") return row.flags.exception;
  return row.record?.status === status;
}

function statusValue(row: BoardRow): string {
  if (row.record) return row.record.status;
  if (row.flags.onLeave) return "leave";
  if (row.flags.absent) return "absent";
  if (row.flags.holiday) return "holiday";
  if (row.flags.weeklyOff) return "weekly_off";
  return "absent";
}

function statusText(row: BoardRow): string {
  return labelFor(statusValue(row));
}

function exceptionText(row: BoardRow): string {
  if (row.record?.status === "late" || row.record?.status === "incomplete" || row.record?.status === "absent") return labelFor(row.record.status);
  if (row.flags.absent) return "Absent";
  return "Exception";
}

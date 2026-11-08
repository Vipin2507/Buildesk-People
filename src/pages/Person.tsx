import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { EmployeeForm } from "../components/employee-form";
import { Banner, Button, DataTable, EmptyState, Field, Modal, PageHeader, StatusBadge, Tabs } from "../components/ui";
import { leaveSummaries } from "../domain/leave";
import { policyApplies, publishedVersion } from "../domain/policies";
import { canOpenProfile, canSeeCompensation, canSeeSection, type ProfileSection } from "../lib/access";
import { downloadText } from "../lib/download";
import { formatDate, formatDateTime, formatDuration, formatMoney, formatTime, fullName, labelFor } from "../lib/format";
import { useTab } from "../lib/useTab";
import { useApp } from "../store/store";
import type { DocumentSensitivity, Employee } from "../types";

const SECTIONS: { id: ProfileSection; label: string }[] = [
  { id: "personal", label: "Personal Information" },
  { id: "salary", label: "Salary Details" },
  { id: "team", label: "Team Details" },
  { id: "emergency", label: "Emergency Contacts" },
  { id: "documents", label: "Documents" },
  { id: "attendance", label: "Attendance" },
  { id: "leaves", label: "Leaves" },
  { id: "regularization", label: "Regularization" },
  { id: "assets", label: "Assets" },
  { id: "policies", label: "HR Policies" },
];

export function Person() {
  const { id } = useParams();
  const { state, user, can } = useApp();
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useTab(SECTIONS.map((item) => item.id), "personal");
  const employee = state.employees.find((item) => item.id === id);
  if (!user) return null;
  if (!employee) return <EmptyState title="Employee not found" body="That profile is not in this demo workspace." action={<Link className="btn btn-secondary" to="/people">Back to people</Link>} />;
  if (!canOpenProfile(state, user, employee)) return <EmptyState title="Profile unavailable" body="You can open your own profile and the people your role is allowed to see." action={<Link className="btn btn-secondary" to="/people">Back to people</Link>} />;
  const allowed = canSeeSection(state, user, employee, tab as ProfileSection);
  return (
    <div>
      <PageHeader
        title={fullName(employee)}
        subtitle={`${employee.employeeCode} · ${employee.jobTitle}`}
        crumbs={[{ label: "People", to: "/people" }, { label: fullName(employee) }]}
        actions={can("people.manage") ? <Button onClick={() => setEditing(true)}>Edit record</Button> : undefined}
      />
      <Tabs tabs={SECTIONS} value={tab} onChange={setTab} />
      {allowed ? <Section employee={employee} section={tab as ProfileSection} /> : <Restricted section={tab as ProfileSection} self={employee.id === user.id} />}
      <Modal open={editing} title={`Edit ${fullName(employee)}`} onClose={() => setEditing(false)}>
        <EmployeeForm employee={employee} onDone={() => setEditing(false)} />
      </Modal>
    </div>
  );
}

function Restricted({ section, self }: { section: ProfileSection; self: boolean }) {
  const copy: Record<ProfileSection, string> = {
    personal: "This section is not available for your role.",
    salary: "Salary and payroll amounts are limited to HR, payroll, and the employee’s own payslips.",
    team: "Team details are not available for your role.",
    emergency: "Emergency contacts are limited to the employee and authorized HR roles.",
    documents: "Employment documents are limited to the employee and authorized HR roles.",
    attendance: self ? "Attendance is not available for your role." : "Attendance for this person is limited to their manager, HR, and payroll roles with company attendance.",
    leaves: "Leave details are limited to the employee, their manager, and HR.",
    regularization: "Regularization requests are limited to the employee, their reviewer, and HR.",
    assets: "You can see your own assigned assets. Asset administration and other people’s assignments stay with HR and system admin.",
    policies: "Policies are not available for your role.",
  };
  return <Banner tone="info">{copy[section]}</Banner>;
}

function Section({ employee, section }: { employee: Employee; section: ProfileSection }) {
  const { state, user, can, actions } = useApp();
  const [gross, setGross] = useState(employee.monthlyGross);
  const [message, setMessage] = useState("");
  const [docTitle, setDocTitle] = useState("");
  const [docKind, setDocKind] = useState("Employment");
  const [docSensitivity, setSensitivity] = useState<DocumentSensitivity>("standard");
  const [docFile, setDocFile] = useState("");
  const [docError, setDocError] = useState("");
  if (!user) return null;
  const manager = state.employees.find((item) => item.id === employee.managerId);
  const reports = state.employees.filter((item) => item.managerId === employee.id && item.status !== "inactive");
  const department = state.departments.find((item) => item.id === employee.departmentId)?.name ?? "—";
  const location = state.locations.find((item) => item.id === employee.locationId)?.name ?? "—";
  const line: Employee[] = [];
  let cursor = manager;
  while (cursor && line.length < 6) {
    line.unshift(cursor);
    cursor = state.employees.find((item) => item.id === cursor?.managerId);
  }

  if (section === "personal") {
    const contact = employee.id === user.id || can("people.sensitive");
    return (
      <section className="panel">
        <div className="panel-head"><h2>Personal Information</h2><StatusBadge value={employee.status} /></div>
        <dl className="dl">
          <dt>Name</dt><dd>{fullName(employee)}</dd>
          <dt>Employee ID</dt><dd>{employee.employeeCode}</dd>
          <dt>Work email</dt><dd><a href={`mailto:${employee.email}`}>{employee.email}</a></dd>
          <dt>Work location</dt><dd>{location}</dd>
          <dt>Joining date</dt><dd>{formatDate(employee.joiningDate)}</dd>
          <dt>Employment status</dt><dd>{labelFor(employee.status)}</dd>
          <dt>Employment type</dt><dd>{labelFor(employee.employmentType)}</dd>
        </dl>
        {contact ? (
          <dl className="dl">
            <dt>Phone</dt><dd>{employee.phone || "—"}</dd>
            <dt>Personal email</dt><dd>{employee.personalEmail || "—"}</dd>
            <dt>Address</dt><dd>{employee.address || "—"}</dd>
            <dt>Date of birth</dt><dd>{formatDate(employee.dateOfBirth)}</dd>
          </dl>
        ) : <Banner tone="info">Phone, personal email, and address stay with the employee and HR.</Banner>}
      </section>
    );
  }

  if (section === "salary") {
    const payslips = state.payslips.filter((item) => item.employeeId === employee.id);
    const showGross = canSeeCompensation(state, user);
    return (
      <section className="panel">
        <h2>Salary Details</h2>
        <p className="muted">Demo payroll uses a monthly gross plus an explicit adjustment. It does not calculate tax, PF, or professional tax.</p>
        {showGross && (
          <>
            <dl className="dl"><dt>Monthly gross</dt><dd>{formatMoney(employee.monthlyGross, state.settings.currency)}</dd></dl>
            {can("people.compensation") && (
              <div className="form-grid">
                <Field label={`Monthly gross (${state.settings.currency})`} error={message}>
                  <input type="number" min={0} value={gross} onChange={(event) => setGross(Number(event.target.value))} />
                </Field>
              </div>
            )}
            {can("people.compensation") && <Button onClick={async () => { const result = await actions.updateCompensation(employee.id, gross); setMessage(result.ok ? "" : result.message); }}>Save compensation</Button>}
          </>
        )}
        {!showGross && <Banner tone="info">The monthly gross is hidden. You can still open payslips generated for you.</Banner>}
        {payslips.length === 0 && <p className="muted">No payslips have been generated for this employee.</p>}
        {payslips.map((item) => (
          <div key={item.id} className="notice">
            <div>
              <strong>{formatDate(item.periodStart)} – {formatDate(item.periodEnd)}</strong>
              <div className="muted">Payable {formatMoney(item.payable, state.settings.currency)} · present {item.presentDays} · unpaid leave {item.unpaidLeaveDays}</div>
            </div>
            <Button variant="secondary" onClick={() => downloadText(`payslip-${employee.employeeCode}-${item.periodStart}.txt`, `Payslip ${item.periodStart} to ${item.periodEnd}\nPayable ${formatMoney(item.payable, state.settings.currency)}\nDemo payslip. Statutory deductions are not calculated.`)}>Download</Button>
          </div>
        ))}
      </section>
    );
  }

  if (section === "team") {
    return (
      <div className="grid-2">
        <section className="panel">
          <h2>Team Details</h2>
          <dl className="dl">
            <dt>Department</dt><dd>{department}</dd>
            <dt>Job title</dt><dd>{employee.jobTitle}</dd>
            <dt>Manager</dt><dd>{manager ? <Link to={`/people/${manager.id}`}>{fullName(manager)}</Link> : "—"}</dd>
            <dt>Role</dt><dd>{labelFor(employee.role)}</dd>
          </dl>
          <h3>Reporting line</h3>
          <ol>
            {line.map((item) => <li key={item.id}><Link to={`/people/${item.id}`}>{fullName(item)}</Link> · {item.jobTitle}</li>)}
            <li>{fullName(employee)} · {employee.jobTitle}</li>
          </ol>
        </section>
        <section className="panel">
          <h2>Organization chart placement</h2>
          <p className="muted">{line.length ? line.map((item) => item.jobTitle).join(" → ") + " → " : ""}{employee.jobTitle}</p>
          <h3>Direct reports</h3>
          {reports.length === 0 && <p className="muted">No active direct reports.</p>}
          {reports.map((item) => <div key={item.id} className="notice"><Link to={`/people/${item.id}`}>{fullName(item)}</Link><span className="muted">{item.jobTitle}</span></div>)}
        </section>
      </div>
    );
  }

  if (section === "emergency") {
    return (
      <section className="panel">
        <h2>Emergency Contacts</h2>
        <dl className="dl">
          <dt>Contact</dt><dd>{employee.emergencyName || "—"}</dd>
          <dt>Relationship</dt><dd>{employee.emergencyRelationship || "—"}</dd>
          <dt>Phone</dt><dd>{employee.emergencyPhone || "—"}</dd>
          <dt>Secondary contact</dt><dd>{employee.emergencySecondaryName || "—"}</dd>
          <dt>Secondary relationship</dt><dd>{employee.emergencySecondaryRelationship || "—"}</dd>
          <dt>Secondary phone</dt><dd>{employee.emergencySecondaryPhone || "—"}</dd>
        </dl>
      </section>
    );
  }

  if (section === "documents") {
    const docs = state.documents.filter((item) => item.employeeId === employee.id && (item.sensitivity === "standard" || employee.id === user.id || (item.sensitivity === "sensitive" && can("people.sensitive")) || (item.sensitivity === "compensation" && canSeeCompensation(state, user))));
    return (
      <section className="panel">
        <h2>Documents</h2>
        {docs.length === 0 && <p className="muted">No documents you are allowed to open.</p>}
        {docs.map((item) => (
          <div key={item.id} className="notice">
            <div>
              <strong>{item.title}</strong>
              <div className="muted">{item.kind} · {labelFor(item.sensitivity)} · {formatDateTime(item.uploadedAt)}</div>
            </div>
            <Button variant="secondary" onClick={() => downloadText(item.fileName, `${item.title}\n${item.kind}\nDemo copy. The uploaded file is stored by name only.`)}>Download</Button>
          </div>
        ))}
        {can("documents.manage") && (
          <form className="stack" noValidate onSubmit={async (event) => {
            event.preventDefault();
            const result = await actions.saveDocument({ employeeId: employee.id, title: docTitle, kind: docKind, sensitivity: docSensitivity, fileName: docFile });
            if (!result.ok) setDocError(result.message);
            else { setDocError(""); setDocTitle(""); setDocFile(""); }
          }}>
            <h3>Add document</h3>
            {docError && <Banner tone="error">{docError}</Banner>}
            <div className="form-grid">
              <Field label="Title"><input value={docTitle} onChange={(event) => setDocTitle(event.target.value)} /></Field>
              <Field label="Type"><input value={docKind} onChange={(event) => setDocKind(event.target.value)} /></Field>
              <Field label="Access">
                <select value={docSensitivity} onChange={(event) => setSensitivity(event.target.value as DocumentSensitivity)}>
                  <option value="standard">Standard — HR and the employee</option>
                  <option value="sensitive">Sensitive — HR and the employee</option>
                  <option value="compensation">Compensation — payroll roles and the employee</option>
                </select>
              </Field>
            </div>
            <Field label="File" hint="The demo stores the file name, not the file.">
              <input type="file" onChange={(event) => setDocFile(event.target.files?.[0]?.name ?? "")} />
            </Field>
            <Button type="submit">Upload document</Button>
          </form>
        )}
      </section>
    );
  }

  if (section === "attendance") {
    const rows = state.attendance.filter((item) => item.employeeId === employee.id).slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 14);
    return (
      <DataTable
        caption="Attendance"
        rows={rows}
        rowKey={(row) => row.id}
        emptyTitle="No attendance"
        emptyBody="Attendance records for this employee will appear here."
        columns={[
          { key: "date", header: "Date", render: (row) => formatDate(row.date) },
          { key: "hours", header: "Hours", render: (row) => formatDuration(row.clockIn, row.clockOut) },
          { key: "in", header: "In", render: (row) => formatTime(row.clockIn) },
          { key: "out", header: "Out", render: (row) => formatTime(row.clockOut) },
          { key: "where", header: "Work location", render: (row) => row.workMode ? labelFor(row.workMode) : "—" },
          { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
          { key: "note", header: "Exception", render: (row) => row.status === "present" ? "—" : row.note || labelFor(row.status) },
        ]}
      />
    );
  }

  if (section === "leaves") {
    const balances = leaveSummaries(state, employee.id);
    const requests = state.leaveRequests.filter((item) => item.employeeId === employee.id);
    return (
      <div className="stack">
        <section className="panel">
          <h2>Leave balances</h2>
          {balances.map((item) => (
            <div key={item.typeId} className="notice">
              <strong>{item.name}</strong>
              <span className="muted">{item.available === null ? "No annual cap" : `${item.available} available`} · used {item.used} · pending {item.pending}</span>
            </div>
          ))}
        </section>
        <DataTable
          caption="Leave requests"
          rows={requests}
          rowKey={(row) => row.id}
          emptyTitle="No leave requests"
          emptyBody="Requests and their history will appear here."
          columns={[
            { key: "type", header: "Type", render: (row) => state.settings.leaveTypes.find((item) => item.id === row.typeId)?.name ?? row.typeId },
            { key: "when", header: "Dates", render: (row) => `${formatDate(row.startDate)} – ${formatDate(row.endDate)}` },
            { key: "days", header: "Days", render: (row) => String(row.days) },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
          ]}
        />
      </div>
    );
  }

  if (section === "regularization") {
    const rows = state.regularizations.filter((item) => item.employeeId === employee.id);
    return (
      <DataTable
        caption="Regularization"
        rows={rows}
        rowKey={(row) => row.id}
        emptyTitle="No regularization requests"
        emptyBody="Attendance corrections requested by this employee will appear here."
        columns={[
          { key: "date", header: "Date", render: (row) => formatDate(row.date) },
          { key: "times", header: "Requested", render: (row) => `${row.requestedIn} – ${row.requestedOut}` },
          { key: "reason", header: "Reason", render: (row) => row.reason },
          { key: "decision", header: "Decision", render: (row) => row.reviewComment || "—" },
          { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
        ]}
      />
    );
  }

  if (section === "assets") {
    const rows = state.assets.filter((item) => item.assignedTo === employee.id || item.history.some((event) => event.comment.includes(employee.employeeCode) || event.action.toLowerCase().includes("return")));
    const assigned = state.assets.filter((item) => item.assignedTo === employee.id);
    const show = can("assets.manage") ? assigned : assigned;
    return (
      <div className="stack">
        {show.length === 0 && <EmptyState title="No assigned assets" body="Equipment currently held by this employee will appear here." />}
        {show.map((item) => (
          <section key={item.id} className="panel">
            <div className="panel-head"><h2><Link to={`/assets/${item.id}`}>{item.name}</Link></h2><StatusBadge value={item.status} /></div>
            <p className="muted">{item.tag} · {item.brand} {item.model} · assigned {item.assignedAt ? formatDate(item.assignedAt) : "—"} · returned {item.returnedAt ? formatDate(item.returnedAt) : "—"}</p>
            <ul>
              {item.history.slice().reverse().slice(0, 4).map((event) => <li key={event.id}>{event.action} · {formatDateTime(event.at)}{event.comment ? ` · ${event.comment}` : ""}</li>)}
            </ul>
          </section>
        ))}
        {rows.length > assigned.length && can("assets.manage") && <p className="muted">Older assignment notes stay on each asset’s history.</p>}
      </div>
    );
  }

  const policies = state.policies.filter((item) => policyApplies(item, employee) && (item.status === "published" || item.status === "archived" || can("policies.manage")));
  return (
    <div className="stack">
      {policies.length === 0 && <EmptyState title="No applicable policies" body="Published policies for this employee’s location or department will appear here." />}
      {policies.map((item) => {
        const version = publishedVersion(item) ?? item.versions[item.versions.length - 1];
        return (
          <Link key={item.id} className="notice" to={`/policies/${item.id}`}>
            <div>
              <strong>{item.title}</strong>
              <div className="muted">{item.category} · version {version?.version ?? "—"} · effective {version ? formatDate(version.effectiveDate) : "—"}</div>
            </div>
            <StatusBadge value={item.status} />
          </Link>
        );
      })}
    </div>
  );
}

import { useState } from "react";
import { Banner, Button, DataTable, Field, NoAccess, PageHeader, Tabs } from "../components/ui";
import { PERMISSIONS, ROLES } from "../lib/access";
import { currentPeriod } from "../domain/payroll";
import { PAYROLL_ASSUMPTION } from "../domain/payroll";
import { formatDateTime, labelFor, rangeLabel } from "../lib/format";
import { useTab } from "../lib/useTab";
import { useApp } from "../store/store";
import type { AuditArea } from "../types";

export function Settings() {
  const { can } = useApp();
  const tabs = [
    ...(can("settings.org") ? [{ id: "org", label: "Organization" }, { id: "schedule", label: "Schedule" }, { id: "catalog", label: "Departments and locations" }, { id: "leave", label: "Leave types" }, { id: "categories", label: "Categories" }] : []),
    ...(can("settings.payroll") ? [{ id: "payroll", label: "Payroll period" }] : []),
    ...(can("settings.roles") ? [{ id: "roles", label: "Roles" }] : []),
    ...(can("audit.view") ? [{ id: "audit", label: "Audit history" }] : []),
  ];
  const [tab, setTab] = useTab(tabs.map((item) => item.id), tabs[0]?.id ?? "audit");
  if (tabs.length === 0) return <NoAccess body="Organization settings are available to HR, payroll, and system administrators." />;
  return (
    <div>
      <PageHeader title="Settings" subtitle="Company setup stored on the Buildesk People server. Permission changes are saved and enforced on the next request." />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === "org" && <OrgForm />}
      {tab === "schedule" && <ScheduleForm />}
      {tab === "catalog" && <Catalog />}
      {tab === "leave" && <LeaveTypes />}
      {tab === "categories" && <Categories />}
      {tab === "payroll" && <PayrollSettings />}
      {tab === "roles" && <Roles />}
      {tab === "audit" && <Audit />}
    </div>
  );
}

function OrgForm() {
  const { state, actions } = useApp();
  const [orgName, setOrg] = useState(state.settings.orgName);
  const [currency, setCurrency] = useState(state.settings.currency);
  const [error, setError] = useState("");
  return (
    <section className="panel narrow">
      <Field label="Organization name"><input value={orgName} onChange={(event) => setOrg(event.target.value)} /></Field>
      <Field label="Currency code" hint="Changing the code changes display only. Amounts are not converted."><input value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} /></Field>
      {error && <Banner tone="error">{error}</Banner>}
      <Button onClick={async () => {
        const result = await actions.updateSettings({ orgName, currency });
        setError(result.ok ? "" : result.message);
      }}>Save organization</Button>
    </section>
  );
}

function ScheduleForm() {
  const { state, actions } = useApp();
  const [workStart, setStart] = useState(state.settings.workStart);
  const [grace, setGrace] = useState(state.settings.graceMinutes);
  const [days, setDays] = useState(state.settings.weeklyOff);
  const [locationRequired, setLocationRequired] = useState(state.settings.attendanceLocationRequired);
  const [retention, setRetention] = useState(state.settings.locationRetentionDays == null ? "" : String(state.settings.locationRetentionDays));
  const [error, setError] = useState("");
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return (
    <section className="panel narrow">
      <Field label="Workday starts"><input type="time" value={workStart} onChange={(event) => setStart(event.target.value)} /></Field>
      <Field label="Grace minutes"><input type="number" min={0} value={grace} onChange={(event) => setGrace(Number(event.target.value))} /></Field>
      <p>Weekly off</p>
      <div className="actions">
        {names.map((name, index) => (
          <label key={name} className="check">
            <input type="checkbox" checked={days.includes(index)} onChange={(event) => setDays(event.target.checked ? [...days, index] : days.filter((day) => day !== index))} />
            <span>{name}</span>
          </label>
        ))}
      </div>
      <fieldset className="stack">
        <legend>Punch location</legend>
        <label className="check">
          <input type="checkbox" checked={locationRequired} onChange={(event) => setLocationRequired(event.target.checked)} />
          <span>Require a device location for clock in and clock out</span>
        </label>
        <p className="hint">When this is off, an employee can finish a punch with location not shared if the browser cannot provide a position. When it is on, the punch is saved only after a position is captured. A device position does not prove identity or a street address.</p>
        <Field label="Location retention in days" hint="Leave this blank to keep a punch location for the same life as the attendance record. No retention period is configured until a number is saved. Saving a number removes coordinates older than that many days and leaves the punch itself.">
          <input type="number" min={1} value={retention} placeholder="Not configured" onChange={(event) => setRetention(event.target.value)} />
        </Field>
      </fieldset>
      {error && <Banner tone="error">{error}</Banner>}
      <Button onClick={async () => {
        const trimmed = retention.trim();
        const locationRetentionDays = trimmed === "" ? null : Number(trimmed);
        const result = await actions.updateSettings({ workStart, graceMinutes: grace, weeklyOff: days, attendanceLocationRequired: locationRequired, locationRetentionDays });
        setError(result.ok ? "" : result.message);
      }}>Save schedule</Button>
    </section>
  );
}

function Catalog() {
  const { state, actions } = useApp();
  const [department, setDepartment] = useState("");
  const [location, setLocation] = useState("");
  const [city, setCity] = useState("");
  const [kind, setKind] = useState<"office" | "remote" | "client">("office");
  const [error, setError] = useState("");
  return (
    <div className="grid-2">
      <section className="panel">
        <h2>Departments</h2>
        {state.departments.map((item) => (
          <div key={item.id} className="notice"><span>{item.name}</span><Button size="sm" variant="ghost" onClick={async () => { const result = await actions.deleteDepartment(item.id); setError(result.ok ? "" : result.message); }}>Remove</Button></div>
        ))}
        <Field label="New department"><input value={department} onChange={(event) => setDepartment(event.target.value)} /></Field>
        <Button onClick={async () => { const result = await actions.addDepartment(department); setError(result.ok ? "" : result.message); if (result.ok) setDepartment(""); }}>Add department</Button>
      </section>
      <section className="panel">
        <h2>Work locations</h2>
        {state.locations.map((item) => (
          <div key={item.id} className="notice"><span>{item.name} · {item.city}</span><Button size="sm" variant="ghost" onClick={async () => { const result = await actions.deleteLocation(item.id); setError(result.ok ? "" : result.message); }}>Remove</Button></div>
        ))}
        <Field label="Name"><input value={location} onChange={(event) => setLocation(event.target.value)} /></Field>
        <Field label="City"><input value={city} onChange={(event) => setCity(event.target.value)} /></Field>
        <Field label="Kind">
          <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
            <option value="office">Office</option>
            <option value="remote">Remote</option>
            <option value="client">Client site</option>
          </select>
        </Field>
        <Button onClick={async () => { const result = await actions.addLocation({ name: location, city, kind }); setError(result.ok ? "" : result.message); if (result.ok) { setLocation(""); setCity(""); } }}>Add location</Button>
        {error && <Banner tone="error">{error}</Banner>}
      </section>
    </div>
  );
}

function LeaveTypes() {
  const { state, actions } = useApp();
  const [error, setError] = useState("");
  return (
    <section className="panel">
      <p className="muted">Entitlements are annual. Unpaid leave has no cap. Changing a type updates the balance calculation.</p>
      {error && <Banner tone="error">{error}</Banner>}
      {state.settings.leaveTypes.map((type) => (
        <LeaveTypeRow key={type.id} typeId={type.id} onError={setError} save={actions.updateLeaveType} />
      ))}
    </section>
  );
}

function LeaveTypeRow({ typeId, onError, save }: { typeId: string; onError: (value: string) => void; save: ReturnType<typeof useApp>["actions"]["updateLeaveType"] }) {
  const { state } = useApp();
  const type = state.settings.leaveTypes.find((item) => item.id === typeId)!;
  const [name, setName] = useState(type.name);
  const [annual, setAnnual] = useState(type.annual === null ? "" : String(type.annual));
  const [paid, setPaid] = useState(type.paid);
  const [half, setHalf] = useState(type.allowHalfDay);
  return (
    <div className="notice">
      <Field label="Name"><input value={name} onChange={(event) => setName(event.target.value)} /></Field>
      <Field label="Annual days" hint="Leave blank for no cap."><input value={annual} onChange={(event) => setAnnual(event.target.value)} /></Field>
      <label className="check"><input type="checkbox" checked={paid} onChange={(event) => setPaid(event.target.checked)} /><span>Paid</span></label>
      <label className="check"><input type="checkbox" checked={half} onChange={(event) => setHalf(event.target.checked)} /><span>Allow half day</span></label>
      <Button size="sm" onClick={async () => {
        const result = await save({ ...type, name, paid, allowHalfDay: half, annual: annual.trim() === "" ? null : Number(annual) });
        onError(result.ok ? "" : result.message);
      }}>Save</Button>
    </div>
  );
}

function Categories() {
  const { state, actions } = useApp();
  const [expense, setExpense] = useState("");
  const [ticket, setTicket] = useState("");
  const [error, setError] = useState("");
  return (
    <div className="grid-2">
      <section className="panel">
        <h2>Expense categories</h2>
        {state.settings.expenseCategories.map((item) => <div key={item} className="notice"><span>{item}</span><Button size="sm" variant="ghost" onClick={async () => { const result = await actions.removeCategory("expense", item); setError(result.ok ? "" : result.message); }}>Remove</Button></div>)}
        <Field label="New category"><input value={expense} onChange={(event) => setExpense(event.target.value)} /></Field>
        <Button onClick={async () => { const result = await actions.addCategory("expense", expense); setError(result.ok ? "" : result.message); if (result.ok) setExpense(""); }}>Add</Button>
      </section>
      <section className="panel">
        <h2>Ticket categories</h2>
        {state.settings.ticketCategories.map((item) => <div key={item} className="notice"><span>{item}</span><Button size="sm" variant="ghost" onClick={async () => { const result = await actions.removeCategory("ticket", item); setError(result.ok ? "" : result.message); }}>Remove</Button></div>)}
        <Field label="New category"><input value={ticket} onChange={(event) => setTicket(event.target.value)} /></Field>
        <Button onClick={async () => { const result = await actions.addCategory("ticket", ticket); setError(result.ok ? "" : result.message); if (result.ok) setTicket(""); }}>Add</Button>
        {error && <Banner tone="error">{error}</Banner>}
      </section>
    </div>
  );
}

function PayrollSettings() {
  const { state, actions } = useApp();
  const [start, setStart] = useState(state.settings.payrollStartDay);
  const [end, setEnd] = useState(state.settings.payrollEndDay);
  const [error, setError] = useState("");
  const period = currentPeriod({ ...state.settings, payrollStartDay: start, payrollEndDay: end });
  return (
    <section className="panel narrow">
      <Banner tone="info">{PAYROLL_ASSUMPTION}</Banner>
      <div className="form-grid">
        <Field label="Period starts on day"><input type="number" min={1} max={31} value={start} onChange={(event) => setStart(Number(event.target.value))} /></Field>
        <Field label="Period ends on day"><input type="number" min={1} max={31} value={end} onChange={(event) => setEnd(Number(event.target.value))} /></Field>
      </div>
      <p>With these days, the current period would be {rangeLabel(period.start, period.end)}. Shorter months end on the last calendar day.</p>
      {error && <Banner tone="error">{error}</Banner>}
      <Button onClick={async () => {
        const result = await actions.updateSettings({ payrollStartDay: start, payrollEndDay: end });
        setError(result.ok ? "" : result.message);
      }}>Save payroll period</Button>
    </section>
  );
}

function Roles() {
  const { state, actions } = useApp();
  const [error, setError] = useState("");
  return (
    <section className="panel">
      <p className="muted">HR and System admin always keep access to roles and user management. These choices apply on the next request.</p>
      {error && <Banner tone="error">{error}</Banner>}
      <div className="table-wrap">
        <table className="data">
          <caption className="sr-only">Role permissions</caption>
          <thead>
            <tr>
              <th>Permission</th>
              {ROLES.map((role) => <th key={role}>{labelFor(role)}</th>)}
            </tr>
          </thead>
          <tbody>
            {PERMISSIONS.map((permission) => (
              <tr key={permission.id}>
                <td><strong>{permission.label}</strong><div className="muted">{permission.description}</div></td>
                {ROLES.map((role) => {
                  const checked = state.settings.rolePermissions[role]?.includes(permission.id) ?? false;
                  const locked = (role === "admin" || role === "hr") && (permission.id === "settings.roles" || permission.id === "users.manage");
                  return (
                    <td key={role}>
                      <input
                        type="checkbox"
                        aria-label={`${labelFor(role)} ${permission.label}`}
                        checked={checked}
                        disabled={locked}
                        onChange={async (event) => {
                          const result = await actions.setPermission(role, permission.id, event.target.checked);
                          setError(result.ok ? "" : result.message);
                        }}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button variant="secondary" onClick={() => actions.resetPermissions()}>Restore recommended permissions</Button>
    </section>
  );
}

function Audit() {
  const { state, user, can } = useApp();
  const [area, setArea] = useState<AuditArea | "all">("all");
  if (!user) return null;
  const rows = state.audits.filter((item) => {
    if (area !== "all" && item.area !== area) return false;
    if (item.scope === "payroll" && !can("reports.payroll") && !can("payroll.manage")) return false;
    if (item.scope === "insurance" && !can("insurance.manage") && item.actorId !== user.id) return false;
    return true;
  });
  return (
    <section className="panel">
      <label className="field">Area
        <select value={area} onChange={(event) => setArea(event.target.value as AuditArea | "all")}>
          <option value="all">All areas</option>
          {["people", "attendance", "leave", "payroll", "expenses", "tickets", "assets", "policies", "users", "settings", "insurance"].map((item) => <option key={item} value={item}>{labelFor(item) === item ? item : labelFor(item)}</option>)}
        </select>
      </label>
      <DataTable
        caption="Audit history"
        rows={rows}
        rowKey={(row) => row.id}
        emptyTitle="No audit events"
        emptyBody="Sensitive changes, approvals, and payroll actions will be listed here."
        columns={[
          { key: "when", header: "When", render: (row) => formatDateTime(row.at) },
          { key: "who", header: "Who", render: (row) => {
            const employee = state.employees.find((item) => item.id === row.actorId);
            if (employee) return `${employee.firstName} ${employee.lastName}`.trim();
            const account = state.accounts.find((item) => item.id === row.actorId);
            return account?.displayName || "System";
          } },
          { key: "area", header: "Area", render: (row) => row.area },
          { key: "what", header: "What happened", render: (row) => row.summary },
        ]}
      />
    </section>
  );
}

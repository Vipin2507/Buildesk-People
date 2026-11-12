import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Banner, Button, DataTable, DatePicker, Field, NoAccess, PageHeader, Tabs, TimePicker } from "../components/ui";
import { companyConfig } from "../domain/config";
import { PAYROLL_ASSUMPTION, currentPeriod } from "../domain/payroll";
import { PERMISSIONS, ROLES } from "../lib/access";
import { formatDateTime, labelFor, monthLabel, rangeLabel } from "../lib/format";
import { useTab } from "../lib/useTab";
import { useApp } from "../store/store";
import type { AuditArea, PayrollRounding } from "../types";
import { MastersPanel } from "./settings/MastersPanel";

export function Settings() {
  const { can, state } = useApp();
  const tabs = [
    ...(can("settings.org") ? [
      { id: "org", label: "Organization" },
      { id: "work", label: "Work & attendance" },
      { id: "leave", label: "Leave & holidays" },
    ] : []),
    ...(can("settings.payroll") ? [{ id: "payroll", label: "Payroll" }] : []),
    ...(can("settings.roles") ? [{ id: "roles", label: "Approvals & roles" }] : []),
    ...(can("settings.org") ? [
      { id: "notifications", label: "Notifications" },
      { id: "security", label: "Security & privacy" },
      { id: "integrations", label: "Integrations" },
      { id: "masters", label: "Masters" },
    ] : []),
    ...((can("leave.manage") && !can("settings.org")) ? [{ id: "masters", label: "Masters" }] : []),
    ...(can("audit.view") ? [{ id: "audit", label: "Audit log" }] : []),
  ];
  const [tab, setTab] = useTab(tabs.map((item) => item.id), tabs[0]?.id ?? "audit");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const changeTab = (next: string) => {
    if (dirty && !window.confirm("You have unsaved changes in this section. Leave without saving?")) return;
    setDirty(false);
    setTab(next);
  };

  if (tabs.length === 0) {
    return <NoAccess body="Organization settings are available to HR, payroll, and system administrators." />;
  }

  return (
    <div className="settings-module">
      <PageHeader
        title="Settings"
        subtitle="Company configuration stored on the Buildesk People server. Changes are validated, audited, and applied across modules that read the shared workspace."
      />
      <Tabs tabs={tabs} value={tab} onChange={changeTab} />
      {tab === "org" && <OrgForm onDirty={setDirty} />}
      {tab === "work" && <WorkAttendanceForm onDirty={setDirty} />}
      {tab === "leave" && <LeaveHolidaysSettings onDirty={setDirty} />}
      {tab === "payroll" && <PayrollSettings onDirty={setDirty} />}
      {tab === "roles" && <Roles />}
      {tab === "notifications" && <NotificationsSettings onDirty={setDirty} />}
      {tab === "security" && <SecuritySettings onDirty={setDirty} />}
      {tab === "integrations" && <IntegrationsSettings />}
      {tab === "masters" && <MastersPanel />}
      {tab === "audit" && <Audit />}
      {dirty && tab !== "masters" && tab !== "roles" && tab !== "audit" && tab !== "integrations" && (
        <p className="faint settings-dirty">This section has unsaved edits.</p>
      )}
      {can("settings.org") && (
        <p className="muted settings-footnote">
          Current company clock label: {companyConfig(state).timezone}. Punch timestamps still use the Asia/Kolkata office clock in this build.
        </p>
      )}
    </div>
  );
}

function OrgForm({ onDirty }: { onDirty: (dirty: boolean) => void }) {
  const { state, actions } = useApp();
  const [orgName, setOrg] = useState(state.settings.orgName);
  const [currency, setCurrency] = useState(state.settings.currency);
  const [timezone, setTimezone] = useState(state.settings.timezone || "Asia/Kolkata");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  useEffect(() => {
    onDirty(orgName !== state.settings.orgName || currency !== state.settings.currency || timezone !== (state.settings.timezone || "Asia/Kolkata"));
  }, [orgName, currency, timezone, state.settings, onDirty]);

  return (
    <section className="panel narrow">
      <h2>Organization</h2>
      <p className="muted">Company identity used across the workspace. Departments and locations are managed in Masters.</p>
      <Field label="Organization name"><input value={orgName} onChange={(event) => setOrg(event.target.value)} /></Field>
      <Field label="Currency code" hint="Changing the code changes display only. Amounts are not converted.">
        <input value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} />
      </Field>
      <Field label="Company timezone" hint="Stored for display and reporting context. Attendance punches continue to use the configured office clock.">
        <input value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="Asia/Kolkata" />
      </Field>
      <div className="actions">
        <Link className="btn btn-secondary btn-sm" to="/settings?tab=masters">Open Masters</Link>
      </div>
      {error && <Banner tone="error">{error}</Banner>}
      {saved && <Banner tone="success">{saved}</Banner>}
      <div className="actions">
        <Button onClick={async () => {
          const result = await actions.updateSettings({ orgName, currency, timezone });
          setError(result.ok ? "" : result.message);
          setSaved(result.ok ? "Organization settings saved." : "");
          if (result.ok) onDirty(false);
        }}>Save organization</Button>
        <Button variant="secondary" onClick={() => {
          setOrg(state.settings.orgName);
          setCurrency(state.settings.currency);
          setTimezone(state.settings.timezone || "Asia/Kolkata");
          setError("");
          setSaved("");
          onDirty(false);
        }}>Cancel</Button>
      </div>
    </section>
  );
}

function WorkAttendanceForm({ onDirty }: { onDirty: (dirty: boolean) => void }) {
  const { state, actions } = useApp();
  const policy = state.settings.halfDayPolicy;
  const [workStart, setStart] = useState(state.settings.workStart);
  const [grace, setGrace] = useState(state.settings.graceMinutes);
  const [days, setDays] = useState(state.settings.weeklyOff);
  const [locationRequired, setLocationRequired] = useState(state.settings.attendanceLocationRequired);
  const [retention, setRetention] = useState(state.settings.locationRetentionDays == null ? "" : String(state.settings.locationRetentionDays));
  const [threshold, setThreshold] = useState(policy?.thresholdHours == null ? "" : String(policy.thresholdHours));
  const [allowHalf, setAllowHalf] = useState(policy?.allowEmployeeRequest !== false);
  const [effectiveDate, setEffective] = useState(policy?.effectiveDate ?? "");
  const [error, setError] = useState("");
  const [impactOpen, setImpactOpen] = useState(false);
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  useEffect(() => {
    const baselineRetention = state.settings.locationRetentionDays == null ? "" : String(state.settings.locationRetentionDays);
    const baselineThreshold = state.settings.halfDayPolicy?.thresholdHours == null ? "" : String(state.settings.halfDayPolicy.thresholdHours);
    const dirty = workStart !== state.settings.workStart
      || grace !== state.settings.graceMinutes
      || JSON.stringify([...days].sort()) !== JSON.stringify([...state.settings.weeklyOff].sort())
      || locationRequired !== state.settings.attendanceLocationRequired
      || retention !== baselineRetention
      || threshold !== baselineThreshold
      || allowHalf !== (state.settings.halfDayPolicy?.allowEmployeeRequest !== false)
      || effectiveDate !== (state.settings.halfDayPolicy?.effectiveDate ?? "");
    onDirty(dirty);
  }, [workStart, grace, days, locationRequired, retention, threshold, allowHalf, effectiveDate, state.settings, onDirty]);

  const save = async () => {
    const trimmed = retention.trim();
    const locationRetentionDays = trimmed === "" ? null : Number(trimmed);
    const halfDayPolicy = {
      thresholdHours: threshold.trim() === "" ? null : Number(threshold),
      allowEmployeeRequest: allowHalf,
      effectiveDate: effectiveDate || null,
      note: policy?.note || "Half-day leave uses first/second half on leave types that allow it. An hours threshold is stored only when your company configures one.",
    };
    const result = await actions.updateSettings({
      workStart,
      graceMinutes: grace,
      weeklyOff: days,
      attendanceLocationRequired: locationRequired,
      locationRetentionDays,
      halfDayPolicy,
    });
    setError(result.ok ? "" : result.message);
    if (result.ok) {
      onDirty(false);
      setImpactOpen(false);
    }
  };

  return (
    <div className="grid-2">
      <section className="panel">
        <h2>Work schedule</h2>
        <p className="muted">Applied to late detection, weekly offs, and attendance summaries.</p>
        <Field label="Workday starts"><TimePicker value={workStart} onChange={setStart} /></Field>
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
          <Field label="Location retention in days" hint="Blank keeps coordinates with the attendance record. Saving a number removes older coordinates only.">
            <input type="number" min={1} value={retention} placeholder="Not configured" onChange={(event) => setRetention(event.target.value)} />
          </Field>
        </fieldset>
      </section>
      <section className="panel">
        <h2>Half-day rules</h2>
        <Banner tone="info">Leave half-day requests still use first/second half on leave types that allow them. An hours threshold is stored only when your company provides one — attendance duration formulas are not invented here.</Banner>
        <label className="check">
          <input type="checkbox" checked={allowHalf} onChange={(event) => setAllowHalf(event.target.checked)} />
          <span>Allow employees to request a half day when the leave type permits it</span>
        </label>
        <Field label="Half-day hours threshold (optional)">
          <input type="number" min={0.5} max={12} step="0.5" value={threshold} placeholder="Not configured" onChange={(event) => setThreshold(event.target.value)} />
        </Field>
        <Field label="Effective date" hint="Use when the threshold should apply from a future date. Existing finalized payroll is not rewritten.">
          <DatePicker value={effectiveDate} onChange={setEffective} placeholder="Immediate / not set" />
        </Field>
        {error && <Banner tone="error">{error}</Banner>}
        <div className="actions">
          <Button onClick={() => setImpactOpen(true)}>Review & save</Button>
          <Link className="btn btn-secondary" to="/settings?tab=masters">Manage schedules & reasons in Masters</Link>
        </div>
        {impactOpen && (
          <div className="modal-back" onMouseDown={() => setImpactOpen(false)}>
            <div className="modal" role="dialog" aria-modal="true" aria-label="Confirm schedule changes" onMouseDown={(event) => event.stopPropagation()}>
              <h2>Confirm work & attendance changes</h2>
              <p>These settings affect late detection, weekly offs, punch location policy, and half-day request availability. Historical punches and finalized payroll are not recalculated automatically.</p>
              <ul className="muted">
                <li>Workday start: {workStart}</li>
                <li>Grace: {grace} minutes</li>
                <li>Weekly off days: {days.map((day) => names[day]).join(", ") || "None"}</li>
                <li>Half-day threshold: {threshold.trim() === "" ? "Not configured" : `${threshold} hours`}</li>
              </ul>
              <div className="actions">
                <Button onClick={save}>Save changes</Button>
                <Button variant="secondary" onClick={() => setImpactOpen(false)}>Cancel</Button>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function LeaveHolidaysSettings({ onDirty }: { onDirty: (dirty: boolean) => void }) {
  const { state, actions, can } = useApp();
  const [error, setError] = useState("");
  useEffect(() => { onDirty(false); }, [onDirty]);
  return (
    <div className="grid-2">
      <section className="panel">
        <h2>Leave types</h2>
        <p className="muted">Entitlements are annual. Unpaid leave has no cap. Full create/archive controls are in Masters.</p>
        {error && <Banner tone="error">{error}</Banner>}
        {state.settings.leaveTypes.filter((item) => item.active !== false).map((type) => (
          <LeaveTypeRow key={type.id} typeId={type.id} onError={setError} save={actions.updateLeaveType} />
        ))}
        {can("leave.manage") && <Link className="btn btn-secondary btn-sm" to="/settings?tab=masters">Manage leave types in Masters</Link>}
      </section>
      <section className="panel">
        <h2>Holidays & calendars</h2>
        <p className="muted">Holiday dates and company events are company data. Fixed days can repeat yearly; lunar festival dates are one-time for the year you set.</p>
        <p>{state.holidays.length} holidays · {state.events.length} events configured.</p>
        <div className="actions">
          <Link className="btn btn-primary btn-sm" to="/leave?tab=holidays">Open holiday calendar</Link>
          <Link className="btn btn-secondary btn-sm" to="/settings?tab=masters">Manage in Masters</Link>
          <Link className="btn btn-secondary btn-sm" to="/leave?tab=calendar">View leave calendar</Link>
        </div>
        <Banner tone="info">Approval routing for leave remains manager/HR permissions. Configurable multi-step chains are not available in this build.</Banner>
      </section>
    </div>
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

function PayrollSettings({ onDirty }: { onDirty: (dirty: boolean) => void }) {
  const { state, actions } = useApp();
  const [start, setStart] = useState(state.settings.payrollStartDay);
  const [end, setEnd] = useState(state.settings.payrollEndDay);
  const [fyMonth, setFyMonth] = useState(state.settings.financialYearStartMonth ?? 4);
  const [divisor, setDivisor] = useState(state.settings.payrollDailyWageDivisor == null ? "" : String(state.settings.payrollDailyWageDivisor));
  const [rounding, setRounding] = useState<PayrollRounding>(state.settings.payrollRounding ?? "none");
  const [error, setError] = useState("");
  const period = currentPeriod({ ...state.settings, payrollStartDay: start, payrollEndDay: end });

  useEffect(() => { onDirty(true); }, [start, end, fyMonth, divisor, rounding, onDirty]);

  return (
    <section className="panel narrow">
      <h2>Payroll</h2>
      <Banner tone="info">{PAYROLL_ASSUMPTION}</Banner>
      <div className="form-grid">
        <Field label="Period starts on day"><input type="number" min={1} max={31} value={start} onChange={(event) => setStart(Number(event.target.value))} /></Field>
        <Field label="Period ends on day"><input type="number" min={1} max={31} value={end} onChange={(event) => setEnd(Number(event.target.value))} /></Field>
        <Field label="Financial year starts">
          <select value={fyMonth} onChange={(event) => setFyMonth(Number(event.target.value))}>
            {Array.from({ length: 12 }, (_, index) => (
              <option key={index + 1} value={index + 1}>{monthLabel(2026, index)}</option>
            ))}
          </select>
        </Field>
        <Field label="Daily wage divisor" hint="Leave blank until your company confirms the divisor. Used only as monthly gross ÷ divisor.">
          <input type="number" min={1} step="0.5" value={divisor} placeholder="Not configured" onChange={(event) => setDivisor(event.target.value)} />
        </Field>
        <Field label="Rounding">
          <select value={rounding} onChange={(event) => setRounding(event.target.value as PayrollRounding)}>
            <option value="none">None (exact amounts)</option>
            <option value="nearest_rupee">Nearest rupee</option>
            <option value="nearest_half">Nearest half rupee</option>
          </select>
        </Field>
      </div>
      <p>With these days, the current period would be {rangeLabel(period.start, period.end)}. Shorter months end on the last calendar day.</p>
      <p className="muted">Earning and deduction component names are managed in Masters. Statutory rates and formulas are not stored as settings.</p>
      {error && <Banner tone="error">{error}</Banner>}
      <div className="actions">
        <Button onClick={async () => {
          const result = await actions.updateSettings({
            payrollStartDay: start,
            payrollEndDay: end,
            financialYearStartMonth: fyMonth,
            payrollDailyWageDivisor: divisor.trim() === "" ? null : Number(divisor),
            payrollRounding: rounding,
          });
          setError(result.ok ? "" : result.message);
          if (result.ok) onDirty(false);
        }}>Save payroll settings</Button>
        <Link className="btn btn-secondary" to="/settings?tab=masters">Payroll component names</Link>
        <Link className="btn btn-secondary" to="/payroll">Open payroll runs</Link>
      </div>
    </section>
  );
}

function Roles() {
  const { state, actions } = useApp();
  const [error, setError] = useState("");
  return (
    <section className="panel">
      <h2>Approvals & roles</h2>
      <p className="muted">HR and System admin always keep access to roles and user management. Approval decisions still use manager and permission checks — multi-step workflow builders are not configured in this build.</p>
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
      <div className="actions">
        <Button variant="secondary" onClick={() => actions.resetPermissions()}>Restore recommended permissions</Button>
        <Link className="btn btn-secondary" to="/users">User accounts</Link>
      </div>
    </section>
  );
}

function NotificationsSettings({ onDirty }: { onDirty: (dirty: boolean) => void }) {
  const { state, actions } = useApp();
  const prefs = state.settings.notificationPrefs ?? { birthdays: true, events: true, approvals: true, attendance: true };
  const [birthdays, setBirthdays] = useState(prefs.birthdays);
  const [events, setEvents] = useState(prefs.events);
  const [approvals, setApprovals] = useState(prefs.approvals);
  const [attendance, setAttendance] = useState(prefs.attendance);
  const [error, setError] = useState("");
  useEffect(() => { onDirty(true); }, [birthdays, events, approvals, attendance, onDirty]);
  return (
    <section className="panel narrow">
      <h2>Notifications & events</h2>
      <p className="muted">Organization preferences for in-app notification kinds. Channel delivery uses Integrations / Automation.</p>
      <label className="check"><input type="checkbox" checked={approvals} onChange={(event) => setApprovals(event.target.checked)} /><span>Approval notifications</span></label>
      <label className="check"><input type="checkbox" checked={attendance} onChange={(event) => setAttendance(event.target.checked)} /><span>Attendance notifications</span></label>
      <label className="check"><input type="checkbox" checked={birthdays} onChange={(event) => setBirthdays(event.target.checked)} /><span>Birthday notifications</span></label>
      <label className="check"><input type="checkbox" checked={events} onChange={(event) => setEvents(event.target.checked)} /><span>Company event reminders</span></label>
      {error && <Banner tone="error">{error}</Banner>}
      <div className="actions">
        <Button onClick={async () => {
          const result = await actions.updateSettings({ notificationPrefs: { birthdays, events, approvals, attendance } });
          setError(result.ok ? "" : result.message);
          if (result.ok) onDirty(false);
        }}>Save notification preferences</Button>
        <Link className="btn btn-secondary" to="/notifications">Open inbox</Link>
        <Link className="btn btn-secondary" to="/settings?tab=integrations">Integrations</Link>
      </div>
    </section>
  );
}

function SecuritySettings({ onDirty }: { onDirty: (dirty: boolean) => void }) {
  const { state, actions } = useApp();
  const [retention, setRetention] = useState(state.settings.locationRetentionDays == null ? "" : String(state.settings.locationRetentionDays));
  const [locationRequired, setLocationRequired] = useState(state.settings.attendanceLocationRequired);
  const [error, setError] = useState("");
  useEffect(() => { onDirty(true); }, [retention, locationRequired, onDirty]);
  return (
    <section className="panel narrow">
      <h2>Security & privacy</h2>
      <p className="muted">Session passwords and account status are managed under User Management. Birthday visibility stays on each employee profile.</p>
      <label className="check">
        <input type="checkbox" checked={locationRequired} onChange={(event) => setLocationRequired(event.target.checked)} />
        <span>Require device location on punches</span>
      </label>
      <Field label="Punch location retention (days)" hint="Coordinates older than this are removed; the attendance punch remains.">
        <input type="number" min={1} value={retention} placeholder="Not configured" onChange={(event) => setRetention(event.target.value)} />
      </Field>
      <Banner tone="info">Audit history is available to roles with audit.view. Secrets for WhatsApp/email stay on the server automation config, not in this form.</Banner>
      {error && <Banner tone="error">{error}</Banner>}
      <div className="actions">
        <Button onClick={async () => {
          const trimmed = retention.trim();
          const result = await actions.updateSettings({
            attendanceLocationRequired: locationRequired,
            locationRetentionDays: trimmed === "" ? null : Number(trimmed),
          });
          setError(result.ok ? "" : result.message);
          if (result.ok) onDirty(false);
        }}>Save privacy settings</Button>
        <Link className="btn btn-secondary" to="/users">User management</Link>
        <Link className="btn btn-secondary" to="/settings?tab=audit">Audit log</Link>
      </div>
    </section>
  );
}

function IntegrationsSettings() {
  const { state, can } = useApp();
  const automation = state.automation;
  const waha = automation?.waha;
  const emailReady = Boolean(automation?.settings.n8nWebhookBase?.trim()) && Boolean(automation?.endpoints?.some((item) => item.channel === "email" && item.isEnabled));
  const wahaOk = Boolean(waha?.isEnabled && waha.apiUrl?.trim() && waha.sessionName?.trim());
  return (
    <section className="panel">
      <h2>Integrations</h2>
      <p className="muted">Connection status for configured channels. Credentials are not shown here.</p>
      <div className="notice split">
        <div>
          <strong>WhatsApp (WAHA)</strong>
          <div className="muted">{wahaOk ? `Enabled · session ${waha?.sessionName}` : "Not configured or disabled"}</div>
        </div>
        <StatusTone ok={wahaOk} />
      </div>
      <div className="notice split">
        <div>
          <strong>Email (n8n webhook)</strong>
          <div className="muted">{emailReady ? "Webhook base and email endpoint enabled" : "Not configured"}</div>
        </div>
        <StatusTone ok={emailReady} />
      </div>
      <div className="notice split">
        <div>
          <strong>Teams / calendar sync</strong>
          <div className="muted">Not configured in this build.</div>
        </div>
        <span className="badge tone-gray">Not configured</span>
      </div>
      <div className="notice split">
        <div>
          <strong>File storage</strong>
          <div className="muted">Profile photos and attachments use the Buildesk People server store.</div>
        </div>
        <span className="badge tone-green">Connected</span>
      </div>
      <div className="actions">
        {can("automation.manage") && <Link className="btn btn-primary" to="/automation">Open Automation</Link>}
        <Link className="btn btn-secondary" to="/settings?tab=notifications">Notification preferences</Link>
      </div>
    </section>
  );
}

function StatusTone({ ok }: { ok: boolean }) {
  return <span className={`badge tone-${ok ? "green" : "amber"}`}>{ok ? "Configured" : "Needs attention"}</span>;
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
      <h2>Audit log</h2>
      <p className="muted">History of setting, master, approval, and other sensitive changes. Secrets and bank details are not logged.</p>
      <label className="field">Area
        <select value={area} onChange={(event) => setArea(event.target.value as AuditArea | "all")}>
          <option value="all">All areas</option>
          {["people", "attendance", "leave", "payroll", "expenses", "tickets", "assets", "policies", "users", "settings", "insurance", "automation"].map((item) => (
            <option key={item} value={item}>{labelFor(item) === item ? item : labelFor(item)}</option>
          ))}
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

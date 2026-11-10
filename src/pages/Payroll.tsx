import { useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, FolderOpen, Wallet } from "lucide-react";
import { Banner, Button, DataTable, EmptyState, Field, Modal, NoAccess, PageHeader, Panel, Stat, StatusBadge, Tabs } from "../components/ui";
import {
  PAYROLL_ASSUMPTION,
  currentPeriod,
  financialYearBounds,
  financialYearLabel,
  financialYearStartMonth,
  isRunLocked,
  maskBankAccount,
  normalizeLine,
  periodForMonth,
  runTotals,
  sourceLabel,
} from "../domain/payroll";
import { downloadText } from "../lib/download";
import { formatDate, formatDateTime, formatMoney, fullName, monthLabel, rangeLabel } from "../lib/format";
import {
  PAYROLL_COLUMNS,
  exportPayrollRegister,
  issuesToCsv,
  parseDelimited,
  previewImport,
  suggestMapping,
  type ImportIssue,
  type PayrollColumnKey,
} from "../lib/payroll-excel";
import { useTab } from "../lib/useTab";
import { useApp } from "../store/store";
import type { Employee, PayrollLine, PayrollRun, Payslip } from "../types";

type ModuleTab = "overview" | "runs" | "reports" | "history" | "settings" | "payslips";

export function Payroll() {
  const { runId } = useParams();
  const { state, user, can, busy } = useApp();
  if (!user) return null;

  const manage = can("payroll.manage");
  const tabs: { id: ModuleTab; label: string }[] = manage
    ? [
        { id: "overview", label: "Overview" },
        { id: "runs", label: "Payroll runs" },
        { id: "reports", label: "Reports" },
        { id: "history", label: "History" },
        { id: "settings", label: "Settings" },
        { id: "payslips", label: "Payslips" },
      ]
    : [{ id: "payslips", label: "My payslips" }];

  const [tab, setTab] = useTab(tabs.map((item) => item.id), manage ? "overview" : "payslips");
  if (runId && !manage) {
    return <NoAccess body="Payroll runs are limited to HR, payroll, and system administrators. You can still open your own payslips." />;
  }

  const period = currentPeriod(state.settings);
  const fy = financialYearLabel(period.start, state.settings);

  return (
    <div className="payroll-module">
      <PageHeader
        title="Payroll"
        subtitle={`${fy} · Period day ${state.settings.payrollStartDay}–${state.settings.payrollEndDay}. Current window ${rangeLabel(period.start, period.end)}.`}
        crumbs={runId ? [{ label: "Payroll", to: "/payroll" }, { label: "Run" }] : undefined}
      />
      {!runId && <Tabs tabs={tabs} value={tab} onChange={(id) => setTab(id as ModuleTab)} />}
      {busy === "payroll" && <Banner tone="info">Updating payroll inputs…</Banner>}
      {(runId || (tab === "runs" && manage)) && <Runs selectedId={runId} />}
      {!runId && tab === "overview" && manage && <Overview onOpenRuns={() => setTab("runs")} />}
      {!runId && tab === "reports" && manage && <Reports />}
      {!runId && tab === "history" && manage && <History />}
      {!runId && tab === "settings" && manage && <PayrollModuleSettings />}
      {!runId && tab === "payslips" && <Payslips />}
    </div>
  );
}

function Overview({ onOpenRuns }: { onOpenRuns: () => void }) {
  const { state, can } = useApp();
  const navigate = useNavigate();
  const period = currentPeriod(state.settings);
  const run = state.payrollRuns.find((item) => item.periodStart === period.start && item.periodEnd === period.end) ?? null;
  const showMoney = can("payroll.manage");
  const totals = run ? runTotals(run) : null;
  const missing = run ? run.lines.filter((line) => line.exceptions.length > 0 || (line.monthlyGross ?? 0) <= 0).length : null;
  const nextAction = !run
    ? "Create a draft for the current period."
    : run.recalcRequired
      ? "Inputs changed — recalculate before verification."
      : run.status === "draft"
        ? "Calculate payroll, then review exceptions."
        : run.status === "calculated"
          ? "Send for review or verify the run."
          : run.status === "in_review"
            ? "Verify, then approve to publish payslips."
            : run.status === "verified"
              ? "Approve the run to lock totals and publish payslips."
              : run.status === "finalized"
                ? "Mark as paid with a payment reference."
                : run.status === "paid"
                  ? "This period is paid. Browse history for archives."
                  : "Review the failed run and refresh inputs.";

  return (
    <div className="stack-lg">
      <div className="stats">
        <Stat
          label="Financial year"
          value={financialYearLabel(period.start, state.settings)}
          hint={`Starts month ${financialYearStartMonth(state.settings)}`}
          icon={<FolderOpen size={18} />}
          tone="blue"
          to="/payroll"
        />
        <Stat
          label="Pay period"
          value={rangeLabel(period.start, period.end)}
          hint={run ? `${run.lines.length} employees in run` : "No run for this period yet"}
          icon={<Wallet size={18} />}
          tone="teal"
          to={run ? `/payroll/${run.id}` : undefined}
        />
        <Stat
          label="Status"
          value={run ? labelStatus(run.status) : "No run"}
          hint={run?.recalcRequired ? "Recalculation required" : nextAction}
          icon={<CheckCircle2 size={18} />}
          tone={run?.status === "paid" ? "green" : run?.recalcRequired ? "amber" : "violet"}
          to={run ? `/payroll/${run.id}` : undefined}
        />
        <Stat
          label="Exceptions"
          value={missing === null ? "—" : String(missing)}
          hint="Missing or invalid payroll inputs"
          icon={<AlertTriangle size={18} />}
          tone="amber"
          to={run ? `/payroll/${run.id}` : undefined}
        />
      </div>

      {showMoney && (
        <div className="stats">
          <Stat label="Gross earnings" value={totals ? formatMoney(totals.grossEarnings, state.settings.currency) : "—"} hint="Authorized payroll roles only" icon={<Wallet size={18} />} tone="blue" to={run ? `/payroll/${run.id}` : undefined} />
          <Stat label="Deductions" value={totals ? formatMoney(totals.deductions, state.settings.currency) : "—"} hint="Entered or imported amounts only" icon={<Wallet size={18} />} tone="amber" to={run ? `/payroll/${run.id}` : undefined} />
          <Stat label="Net payable" value={totals ? formatMoney(totals.payable, state.settings.currency) : "—"} hint={totals ? `${totals.employees} employees` : "Unavailable until a run exists"} icon={<Wallet size={18} />} tone="green" to={run ? `/payroll/${run.id}` : undefined} />
        </div>
      )}

      <Panel title="Next action" action={<Button variant="secondary" onClick={onOpenRuns}>Open runs</Button>}>
        <p>{nextAction}</p>
        <Banner tone="info">{PAYROLL_ASSUMPTION}</Banner>
        <div className="actions">
          {!run && (
            <Button onClick={() => navigate("/payroll")}>Go to Payroll runs to create a draft</Button>
          )}
          {run && <Button onClick={() => navigate(`/payroll/${run.id}`)}>Continue this period</Button>}
        </div>
      </Panel>
    </div>
  );
}

function labelStatus(status: PayrollRun["status"]): string {
  if (status === "finalized") return "Approved";
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function Runs({ selectedId }: { selectedId?: string }) {
  const { state, actions } = useApp();
  const navigate = useNavigate();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [error, setError] = useState("");
  const selected = state.payrollRuns.find((item) => item.id === selectedId) ?? null;
  const preview = periodForMonth(year, month, state.settings);
  const runs = [...state.payrollRuns].sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));

  return (
    <div className="grid-2">
      <section className="panel">
        <h2>Payroll runs</h2>
        {runs.length === 0 && <EmptyState title="No payroll runs" body="Create a draft for a pay period to gather attendance, salary, and deduction inputs." />}
        {runs.map((run) => (
          <Link key={run.id} to={`/payroll/${run.id}`} className="notice split">
            <span>
              <strong>{rangeLabel(run.periodStart, run.periodEnd)}</strong>
              <span className="muted" style={{ display: "block" }}>
                {financialYearLabel(run.periodStart, state.settings)} · {run.lines.length} employees
                {run.recalcRequired ? " · Recalculation needed" : ""}
              </span>
            </span>
            <StatusBadge value={run.status} />
          </Link>
        ))}
        <h3>New draft</h3>
        <p className="muted">
          This period would be {rangeLabel(preview.start, preview.end)}
          {preview.excluded.length ? `. ${preview.excluded.length} date(s) fall outside the configured days.` : ""}.
          Duplicate active runs for the same period are blocked.
        </p>
        <div className="form-grid">
          <Field label="Month">
            <select value={month} onChange={(event) => setMonth(Number(event.target.value))}>
              {Array.from({ length: 12 }, (_, index) => (
                <option key={index} value={index}>{monthLabel(year, index)}</option>
              ))}
            </select>
          </Field>
          <Field label="Year">
            <input type="number" value={year} onChange={(event) => setYear(Number(event.target.value))} />
          </Field>
        </div>
        {error && <Banner tone="error">{error}</Banner>}
        <Button
          onClick={async () => {
            const result = await actions.createPayrollRun(year, month);
            if (!result.ok) setError(result.message);
            else if (result.id) navigate(`/payroll/${result.id}`);
          }}
        >
          Create draft run
        </Button>
      </section>
      <div>{selected ? <RunDetail runId={selected.id} /> : <EmptyState title="Select a run" body="Open a period to review the register, calculate, verify, approve, and pay." />}</div>
    </div>
  );
}

function RunDetail({ runId }: { runId: string }) {
  const { state, actions, busy, can } = useApp();
  const run = state.payrollRuns.find((item) => item.id === runId);
  const [approveOpen, setApproveOpen] = useState(false);
  const [paidOpen, setPaidOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [verifyNote, setVerifyNote] = useState("");
  const [paymentRef, setPaymentRef] = useState("");
  const [paymentNote, setPaymentNote] = useState("");
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState("all");
  const [exceptionsOnly, setExceptionsOnly] = useState(false);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [revealBank, setRevealBank] = useState(false);

  const totals = useMemo(() => (run ? runTotals(run) : null), [run]);
  if (!run || !totals) return null;

  const locked = isRunLocked(run.status);
  const showSalary = can("payroll.manage");
  const showBank = can("payroll.manage");

  const filtered = run.lines.filter((raw) => {
    const line = normalizeLine(raw, state.settings);
    const person = state.employees.find((item) => item.id === line.employeeId);
    if (!person) return false;
    if (department !== "all" && person.departmentId !== department) return false;
    if (exceptionsOnly && line.exceptions.length === 0) return false;
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      const hay = `${person.employeeCode} ${fullName(person)}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const steps = ["Draft", "Calculated", "In review", "Verified", "Approved", "Paid"];
  const stepIndex =
    run.status === "paid" ? 5
      : run.status === "finalized" ? 4
        : run.status === "verified" ? 3
          : run.status === "in_review" ? 2
            : run.status === "calculated" ? 1
              : 0;

  return (
    <section className="panel">
      <div className="spread">
        <div>
          <h2>{rangeLabel(run.periodStart, run.periodEnd)}</h2>
          <p className="muted">{financialYearLabel(run.periodStart, state.settings)}</p>
        </div>
        <StatusBadge value={run.status} />
      </div>

      <div className="stepper" aria-label="Payroll workflow">
        {steps.map((label, index) => (
          <span key={label} className={index <= stepIndex ? "step on" : "step"}>{index + 1}. {label}</span>
        ))}
      </div>

      <Banner tone="info">{PAYROLL_ASSUMPTION}</Banner>
      {run.recalcRequired && <Banner tone="warning">Inputs changed after the last calculation. Recalculate before verify or approve.</Banner>}
      {run.warnings.map((warning) => <Banner key={warning} tone="warning">{warning}</Banner>)}

      {showSalary && (
        <p>
          <strong>Gross earnings {formatMoney(totals.grossEarnings, state.settings.currency)}</strong>
          {" · "}Deductions {formatMoney(totals.deductions, state.settings.currency)}
          {" · "}Net payable {formatMoney(totals.payable, state.settings.currency)}
          {" · "}{totals.exceptions} with exceptions
        </p>
      )}

      <div className="actions">
        <Button variant="secondary" disabled={locked || busy === "payroll"} onClick={() => actions.refreshPayroll(run.id)}>Refresh inputs</Button>
        <Button variant="secondary" disabled={locked || busy === "payroll"} onClick={() => setImportOpen(true)}>Upload Excel</Button>
        <Button
          variant="secondary"
          onClick={() =>
            exportPayrollRegister(
              `payroll-${run.periodStart}.csv`,
              run.lines,
              state.employees,
              {
                includeBank: showBank,
                includeSalary: showSalary,
                periodLabel: rangeLabel(run.periodStart, run.periodEnd),
              },
            )
          }
        >
          Export register
        </Button>
        {(run.status === "draft" || run.status === "calculated" || run.recalcRequired) && !locked && (
          <Button disabled={busy === "payroll"} onClick={async () => { const result = await actions.calculatePayroll(run.id); setError(result.ok ? "" : result.message); }}>
            Calculate
          </Button>
        )}
        {(run.status === "calculated" || run.status === "draft" || run.status === "verified") && !locked && (
          <Button variant="secondary" onClick={() => actions.advancePayroll(run.id, "in_review")}>Send for review</Button>
        )}
        {(run.status === "calculated" || run.status === "in_review") && !locked && (
          <Button
            variant="secondary"
            onClick={async () => {
              const result = await actions.verifyPayroll(run.id, verifyNote);
              setError(result.ok ? "" : result.message);
            }}
          >
            Verify
          </Button>
        )}
        {(run.status === "in_review" || run.status === "verified" || run.status === "calculated") && !locked && (
          <Button onClick={() => { setChecked(false); setApproveOpen(true); }}>Approve</Button>
        )}
        {run.status === "finalized" && (
          <Button onClick={() => { setPaymentRef(run.paymentReference ?? ""); setPaymentNote(run.paymentNote ?? ""); setPaidOpen(true); }}>Mark as paid</Button>
        )}
      </div>

      {(run.status === "calculated" || run.status === "in_review") && (
        <Field label="Verification note">
          <input value={verifyNote} onChange={(event) => setVerifyNote(event.target.value)} placeholder="Optional note for the audit trail" />
        </Field>
      )}

      {locked && <p className="muted">This run is locked. Corrections should be handled as a new adjustment run rather than rewriting this record.</p>}
      {run.verifiedAt && (
        <p className="muted">
          Verified {formatDateTime(run.verifiedAt)}
          {run.verifiedBy ? ` by ${fullName(state.employees.find((item) => item.id === run.verifiedBy)!)}` : ""}
          {run.verifyNote ? ` — ${run.verifyNote}` : ""}
        </p>
      )}
      {run.paidAt && (
        <p className="muted">
          Paid {formatDateTime(run.paidAt)}
          {run.paymentReference ? ` · Ref ${run.paymentReference}` : ""}
          {run.paymentNote ? ` — ${run.paymentNote}` : ""}
        </p>
      )}

      <div className="form-grid" style={{ marginTop: 12 }}>
        <Field label="Search">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Employee ID or name" />
        </Field>
        <Field label="Department">
          <select value={department} onChange={(event) => setDepartment(event.target.value)}>
            <option value="all">All departments</option>
            {state.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </Field>
        <label className="check">
          <input type="checkbox" checked={exceptionsOnly} onChange={(event) => setExceptionsOnly(event.target.checked)} />
          <span>Exceptions only</span>
        </label>
        {showBank && (
          <label className="check">
            <input type="checkbox" checked={revealBank} onChange={(event) => setRevealBank(event.target.checked)} />
            <span>Reveal bank account numbers</span>
          </label>
        )}
      </div>

      <h3>Employee payroll register</h3>
      <div className="table-wrap payroll-register">
        <table className="data">
          <caption className="sr-only">Payroll register for {rangeLabel(run.periodStart, run.periodEnd)}</caption>
          <thead>
            <tr>
              <th>Employee ID</th>
              <th>Name</th>
              <th>Department</th>
              <th>Designation</th>
              <th>Joining</th>
              {showBank && <th>Bank</th>}
              <th>Full</th>
              <th>Half</th>
              <th>WO</th>
              <th>PL</th>
              <th>Paid days</th>
              <th>Absent</th>
              <th>LOP</th>
              {showSalary && (
                <>
                  <th>Monthly</th>
                  <th>Daily</th>
                  <th>Gross</th>
                  <th>OT</th>
                  <th>Extras</th>
                  <th>Arrears</th>
                  <th>PF</th>
                  <th>ESIC</th>
                  <th>Penalties</th>
                  <th>Loan</th>
                  <th>Other</th>
                  <th>Deductions</th>
                  <th>Net</th>
                </>
              )}
              <th>Flags</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((raw) => {
              const line = normalizeLine(raw, state.settings);
              const person = state.employees.find((item) => item.id === line.employeeId)!;
              const dept = state.departments.find((item) => item.id === person.departmentId)?.name ?? "—";
              return (
                <tr key={line.employeeId}>
                  <td>{person.employeeCode}</td>
                  <td>{fullName(person)}</td>
                  <td>{dept}</td>
                  <td>{person.jobTitle || "—"}</td>
                  <td>{formatDate(person.joiningDate)}</td>
                  {showBank && (
                    <td>{revealBank && person.bankAccountNumber ? person.bankAccountNumber : maskBankAccount(person.bankAccountNumber)}</td>
                  )}
                  <td>{line.fullDays}</td>
                  <td>{line.halfDays}</td>
                  <td>{line.weeklyOffs}</td>
                  <td>{line.paidLeaveDays}</td>
                  <td>{line.paidDays}</td>
                  <td>{line.absentDays}</td>
                  <td>{line.lopDays}</td>
                  {showSalary && (
                    <>
                      <td>{formatMoney(line.monthlyGross, state.settings.currency)}</td>
                      <td>{line.dailyWage == null ? "Not configured" : formatMoney(line.dailyWage, state.settings.currency)}</td>
                      <td>{formatMoney(line.grossEarnings ?? line.payable, state.settings.currency)}</td>
                      <td>{formatMoney(line.overtime ?? 0, state.settings.currency)}</td>
                      <td>{formatMoney(line.extras ?? 0, state.settings.currency)}</td>
                      <td>{formatMoney(line.arrears ?? 0, state.settings.currency)}</td>
                      <td>{formatMoney(line.pf ?? 0, state.settings.currency)}</td>
                      <td>{formatMoney(line.esic ?? 0, state.settings.currency)}</td>
                      <td>{formatMoney(line.penalties ?? 0, state.settings.currency)}</td>
                      <td>{formatMoney(line.loan ?? 0, state.settings.currency)}</td>
                      <td>{formatMoney(line.otherDeductions ?? 0, state.settings.currency)}</td>
                      <td>{formatMoney(line.totalDeductions ?? 0, state.settings.currency)}</td>
                      <td>{formatMoney(line.payable, state.settings.currency)}</td>
                    </>
                  )}
                  <td>{line.exceptions.length ? `${line.exceptions.length}` : "—"}</td>
                  <td><Button size="sm" variant="secondary" onClick={() => setDrawerId(line.employeeId)}>Open</Button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {filtered.length === 0 && <EmptyState title="No matching employees" body="Adjust search or filters to see register rows." />}

      <div className="payroll-cards">
        {filtered.map((raw) => {
          const line = normalizeLine(raw, state.settings);
          const person = state.employees.find((item) => item.id === line.employeeId)!;
          return (
            <article key={`card-${line.employeeId}`} className="panel compact">
              <div className="spread">
                <strong>{fullName(person)}</strong>
                <Button size="sm" variant="secondary" onClick={() => setDrawerId(line.employeeId)}>Detail</Button>
              </div>
              <p className="muted">{person.employeeCode} · {state.departments.find((item) => item.id === person.departmentId)?.name ?? "—"}</p>
              {showSalary && <p>Net {formatMoney(line.payable, state.settings.currency)}</p>}
              {line.exceptions[0] && <p className="muted">{line.exceptions[0]}</p>}
            </article>
          );
        })}
      </div>

      {error && <Banner tone="error">{error}</Banner>}

      {drawerId && (
        <LineDrawer
          run={run}
          employeeId={drawerId}
          locked={locked}
          revealBank={revealBank && showBank}
          onClose={() => setDrawerId(null)}
        />
      )}

      <Modal open={approveOpen} title="Approve payroll" onClose={() => setApproveOpen(false)}>
        <p>Approving locks the run for {rangeLabel(run.periodStart, run.periodEnd)}, creates published payslips, and marks included expense claims as paid.</p>
        <p>Net payable: <strong>{formatMoney(totals.payable, state.settings.currency)}</strong> for {totals.employees} employees.</p>
        <Banner tone="warning">{PAYROLL_ASSUMPTION}</Banner>
        <label className="check">
          <input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} />
          <span>I reviewed exceptions and totals. Statutory deductions are only included if entered or imported.</span>
        </label>
        <div className="actions">
          <Button variant="secondary" onClick={() => setApproveOpen(false)}>Cancel</Button>
          <Button
            disabled={!checked}
            onClick={async () => {
              const result = await actions.advancePayroll(run.id, "finalized");
              setError(result.ok ? "" : result.message);
              if (result.ok) setApproveOpen(false);
            }}
          >
            Approve payroll
          </Button>
        </div>
      </Modal>

      <Modal open={paidOpen} title="Mark payroll paid" onClose={() => setPaidOpen(false)}>
        <p>Record the payment batch for {rangeLabel(run.periodStart, run.periodEnd)}. This does not transfer funds.</p>
        <Field label="Payment reference / batch id" required>
          <input value={paymentRef} onChange={(event) => setPaymentRef(event.target.value)} />
        </Field>
        <Field label="Notes">
          <input value={paymentNote} onChange={(event) => setPaymentNote(event.target.value)} />
        </Field>
        <div className="actions">
          <Button variant="secondary" onClick={() => setPaidOpen(false)}>Cancel</Button>
          <Button
            onClick={async () => {
              const result = await actions.advancePayroll(run.id, "paid", { reference: paymentRef, note: paymentNote });
              setError(result.ok ? "" : result.message);
              if (result.ok) setPaidOpen(false);
            }}
          >
            Confirm paid
          </Button>
        </div>
      </Modal>

      <ImportModal open={importOpen} run={run} onClose={() => setImportOpen(false)} />
    </section>
  );
}

function LineDrawer({
  run,
  employeeId,
  locked,
  revealBank,
  onClose,
}: {
  run: PayrollRun;
  employeeId: string;
  locked: boolean;
  revealBank: boolean;
  onClose: () => void;
}) {
  const { state, actions } = useApp();
  const person = state.employees.find((item) => item.id === employeeId);
  const line = normalizeLine(run.lines.find((item) => item.employeeId === employeeId)!, state.settings);
  const [draft, setDraft] = useState({
    adjustment: String(line.adjustment),
    reason: line.adjustmentReason,
    overtime: String(line.overtime ?? 0),
    extras: String(line.extras ?? 0),
    arrears: String(line.arrears ?? 0),
    pf: String(line.pf ?? 0),
    esic: String(line.esic ?? 0),
    penalties: String(line.penalties ?? 0),
    loan: String(line.loan ?? 0),
    otherDeductions: String(line.otherDeductions ?? 0),
  });
  const [error, setError] = useState("");
  if (!person) return null;

  const rows: Array<{ label: string; value: string; source?: string }> = [
    { label: "Monthly salary", value: formatMoney(line.monthlyGross, state.settings.currency), source: sourceLabel(line.sources?.monthlyGross ?? "employee") },
    { label: "Daily wage", value: line.dailyWage == null ? "Not configured" : formatMoney(line.dailyWage, state.settings.currency), source: state.settings.payrollDailyWageDivisor ? "Configured divisor" : "Not configured" },
    { label: "Full days", value: String(line.fullDays), source: sourceLabel(line.sources?.fullDays ?? "attendance") },
    { label: "Half days", value: String(line.halfDays), source: sourceLabel(line.sources?.halfDays ?? "attendance") },
    { label: "Weekly offs", value: String(line.weeklyOffs), source: sourceLabel(line.sources?.weeklyOffs ?? "attendance") },
    { label: "Paid leaves", value: String(line.paidLeaveDays), source: sourceLabel(line.sources?.paidLeaveDays ?? "attendance") },
    { label: "Paid days", value: String(line.paidDays), source: "Derived from attendance inputs (confirm company rule)" },
    { label: "Absent / LOP", value: `${line.absentDays} / ${line.lopDays}`, source: sourceLabel(line.sources?.lopDays ?? "attendance") },
    { label: "Reimbursements", value: formatMoney(line.reimbursement, state.settings.currency), source: sourceLabel(line.sources?.reimbursement ?? "calculated") },
    { label: "Gross earnings", value: formatMoney(line.grossEarnings ?? line.payable, state.settings.currency), source: "Monthly + OT + extras + arrears + reimbursements + adjustment" },
    { label: "Total deductions", value: formatMoney(line.totalDeductions ?? 0, state.settings.currency), source: "Sum of entered PF, ESIC, penalties, loan, other" },
    { label: "Net payable", value: formatMoney(line.payable, state.settings.currency), source: "Gross earnings − total deductions" },
  ];

  return (
    <Modal open title={`Payroll detail · ${fullName(person)}`} onClose={onClose}>
      <dl className="dl">
        <dt>Employee ID</dt><dd>{person.employeeCode}</dd>
        <dt>Department</dt><dd>{state.departments.find((item) => item.id === person.departmentId)?.name ?? "—"}</dd>
        <dt>Designation</dt><dd>{person.jobTitle || "—"}</dd>
        <dt>Joining</dt><dd>{formatDate(person.joiningDate)}</dd>
        <dt>Bank</dt>
        <dd>{revealBank && person.bankAccountNumber ? person.bankAccountNumber : maskBankAccount(person.bankAccountNumber)}</dd>
      </dl>
      <table className="data">
        <caption className="sr-only">Calculation breakdown</caption>
        <thead><tr><th>Field</th><th>Value</th><th>Source / rule</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}><td>{row.label}</td><td>{row.value}</td><td className="muted">{row.source}</td></tr>
          ))}
        </tbody>
      </table>
      {line.exceptions.length > 0 && (
        <Banner tone="warning">{line.exceptions.join(" ")}</Banner>
      )}
      {!locked && (
        <>
          <h3>Manual / imported components</h3>
          <p className="muted">Enter company amounts only. Rates and eligibility are not invented by the app.</p>
          <div className="form-grid">
            {([
              ["overtime", "Overtime"],
              ["extras", "Extras"],
              ["arrears", "Arrears"],
              ["pf", "PF"],
              ["esic", "ESIC"],
              ["penalties", "Penalties"],
              ["loan", "Loan / advance"],
              ["otherDeductions", "Other deductions"],
              ["adjustment", "Adjustment"],
            ] as const).map(([key, label]) => (
              <Field key={key} label={label}>
                <input
                  value={draft[key]}
                  onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
                  inputMode="decimal"
                />
              </Field>
            ))}
            <Field label="Adjustment reason" className="span-2">
              <input value={draft.reason} onChange={(event) => setDraft({ ...draft, reason: event.target.value })} />
            </Field>
          </div>
          {error && <Banner tone="error">{error}</Banner>}
          <div className="actions">
            <Button
              onClick={async () => {
                const result = await actions.updatePayrollLine(
                  run.id,
                  employeeId,
                  Number(draft.adjustment || 0),
                  draft.reason,
                  {
                    overtime: Number(draft.overtime || 0),
                    extras: Number(draft.extras || 0),
                    arrears: Number(draft.arrears || 0),
                    pf: Number(draft.pf || 0),
                    esic: Number(draft.esic || 0),
                    penalties: Number(draft.penalties || 0),
                    loan: Number(draft.loan || 0),
                    otherDeductions: Number(draft.otherDeductions || 0),
                  },
                );
                setError(result.ok ? "" : result.message);
                if (result.ok) onClose();
              }}
            >
              Save line
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}

function ImportModal({ open, run, onClose }: { open: boolean; run: PayrollRun; onClose: () => void }) {
  const { state, actions } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Partial<Record<PayrollColumnKey, string>>>({});
  const [issues, setIssues] = useState<ImportIssue[]>([]);
  const [previewLines, setPreviewLines] = useState<PayrollLine[] | null>(null);
  const [applied, setApplied] = useState(0);
  const [error, setError] = useState("");

  const reset = () => {
    setFileName("");
    setHeaders([]);
    setRows([]);
    setMapping({});
    setIssues([]);
    setPreviewLines(null);
    setApplied(0);
    setError("");
  };

  return (
    <Modal
      open={open}
      title="Upload Excel / CSV"
      onClose={() => {
        reset();
        onClose();
      }}
    >
      <Banner tone="info">
        Native .xlsx parsing is not installed. Upload a CSV (Excel → Save As CSV) matching your payroll sheet. Map columns once, preview, then import. Finalized runs cannot be overwritten.
      </Banner>
      <Field label="Spreadsheet file">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            const text = await file.text();
            const parsed = parseDelimited(text);
            setFileName(file.name);
            setHeaders(parsed.headers);
            setRows(parsed.rows);
            setMapping(suggestMapping(parsed.headers));
            setPreviewLines(null);
            setIssues([]);
          }}
        />
      </Field>
      {headers.length > 0 && (
        <>
          <h3>Column mapping</h3>
          <div className="form-grid">
            {PAYROLL_COLUMNS.map((column) => (
              <Field key={column.key} label={`${column.label}${column.required ? " *" : ""}`}>
                <select
                  value={mapping[column.key] ?? ""}
                  onChange={(event) => setMapping({ ...mapping, [column.key]: event.target.value || undefined })}
                >
                  <option value="">— Not mapped —</option>
                  {headers.map((header) => <option key={header} value={header}>{header}</option>)}
                </select>
              </Field>
            ))}
          </div>
          <div className="actions">
            <Button
              variant="secondary"
              onClick={() => {
                const result = previewImport({ headers, rows }, mapping, state.employees, run.lines);
                setIssues(result.issues);
                setPreviewLines(result.lines);
                setApplied(result.applied);
              }}
            >
              Preview import
            </Button>
          </div>
        </>
      )}
      {issues.length > 0 && (
        <>
          <Banner tone={issues.some((item) => item.level === "error") ? "error" : "warning"}>
            {issues.filter((item) => item.level === "error").length} error(s), {issues.filter((item) => item.level === "warning").length} warning(s).
          </Banner>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => downloadText(`payroll-import-errors-${run.periodStart}.csv`, issuesToCsv(issues), "text/csv;charset=utf-8")}
          >
            Download error report
          </Button>
          <ul className="muted">
            {issues.slice(0, 8).map((item, index) => (
              <li key={`${item.row}-${index}`}>Row {item.row}: [{item.level}] {item.message}</li>
            ))}
          </ul>
        </>
      )}
      {previewLines && (
        <p>{applied} row(s) ready to apply for {rangeLabel(run.periodStart, run.periodEnd)}.</p>
      )}
      {error && <Banner tone="error">{error}</Banner>}
      <div className="actions">
        <Button
          variant="secondary"
          onClick={() => {
            reset();
            onClose();
          }}
        >
          Cancel
        </Button>
        <Button
          disabled={!previewLines || issues.some((item) => item.level === "error")}
          onClick={async () => {
            if (!previewLines) return;
            const warningCount = issues.filter((item) => item.level === "warning").length;
            const result = await actions.importPayrollLines(run.id, previewLines, fileName || "payroll-import.csv", warningCount);
            setError(result.ok ? "" : result.message);
            if (result.ok) {
              reset();
              onClose();
            }
          }}
        >
          Save import
        </Button>
      </div>
    </Modal>
  );
}

function Reports() {
  const { state, can } = useApp();
  const [runId, setRunId] = useState(state.payrollRuns[0]?.id ?? "");
  const run = state.payrollRuns.find((item) => item.id === runId) ?? null;
  const showSalary = can("payroll.manage");
  const showBank = can("payroll.manage");
  const totals = run ? runTotals(run) : null;
  const incompleteNote = run && !(run.status === "finalized" || run.status === "paid")
    ? "This report includes a run that is not yet approved. Totals may change."
    : null;

  return (
    <section className="panel">
      <h2>Reports</h2>
      <Field label="Payroll period">
        <select value={runId} onChange={(event) => setRunId(event.target.value)}>
          {state.payrollRuns.length === 0 && <option value="">No runs</option>}
          {state.payrollRuns.map((item) => (
            <option key={item.id} value={item.id}>
              {rangeLabel(item.periodStart, item.periodEnd)} ({labelStatus(item.status)})
            </option>
          ))}
        </select>
      </Field>
      {!run && <EmptyState title="No payroll data" body="Create and calculate a payroll run before generating reports." />}
      {run && totals && (
        <>
          {incompleteNote && <Banner tone="warning">{incompleteNote}</Banner>}
          <div className="stats">
            <Stat label="Employees" value={String(totals.employees)} hint="In selected run" icon={<Wallet size={18} />} tone="blue" />
            {showSalary && <Stat label="Gross earnings" value={formatMoney(totals.grossEarnings, state.settings.currency)} hint="Selected period" icon={<Wallet size={18} />} tone="teal" />}
            {showSalary && <Stat label="Deductions" value={formatMoney(totals.deductions, state.settings.currency)} hint="Entered amounts" icon={<Wallet size={18} />} tone="amber" />}
            {showSalary && <Stat label="Net payable" value={formatMoney(totals.payable, state.settings.currency)} hint="Selected period" icon={<Wallet size={18} />} tone="green" />}
          </div>
          <div className="actions">
            <Button
              variant="secondary"
              onClick={() =>
                exportPayrollRegister(`employee-salary-${run.periodStart}.csv`, run.lines, state.employees, {
                  includeBank: showBank,
                  includeSalary: showSalary,
                  periodLabel: rangeLabel(run.periodStart, run.periodEnd),
                })
              }
            >
              Employee-wise salary
            </Button>
            <Button
              variant="secondary"
              onClick={() => exportAttendanceSummary(run, state.employees, state.settings.currency)}
            >
              Attendance summary
            </Button>
            <Button
              variant="secondary"
              onClick={() => exportDeductions(run, state.employees, state.settings.currency, showSalary)}
            >
              Deduction report
            </Button>
            <Button
              variant="secondary"
              onClick={() => exportMonthlySummary(run, totals, state.settings.currency)}
            >
              Monthly summary
            </Button>
          </div>
          <DataTable
            caption="Employee-wise salary report"
            rows={run.lines.map((line) => normalizeLine(line, state.settings))}
            rowKey={(row) => row.employeeId}
            emptyTitle="No rows"
            emptyBody="This run has no employees."
            columns={[
              { key: "code", header: "Employee ID", render: (row) => state.employees.find((item) => item.id === row.employeeId)?.employeeCode ?? "—" },
              { key: "name", header: "Name", render: (row) => fullName(state.employees.find((item) => item.id === row.employeeId)!) },
              ...(showSalary
                ? [
                    { key: "gross", header: "Gross", render: (row: PayrollLine) => formatMoney(row.grossEarnings ?? row.payable, state.settings.currency) },
                    { key: "ded", header: "Deductions", render: (row: PayrollLine) => formatMoney(row.totalDeductions ?? 0, state.settings.currency) },
                    { key: "net", header: "Net", render: (row: PayrollLine) => formatMoney(row.payable, state.settings.currency) },
                  ]
                : []),
              { key: "status", header: "Exceptions", render: (row) => (row.exceptions.length ? String(row.exceptions.length) : "—") },
            ]}
          />
        </>
      )}
    </section>
  );
}

function exportAttendanceSummary(run: PayrollRun, employees: Employee[], _currency: string) {
  const rows: (string | number)[][] = [[
    "Employee ID", "Name", "Full days", "Half days", "Weekly offs", "Paid leaves", "Paid days", "Absent", "LOP", "Period",
  ]];
  for (const raw of run.lines) {
    const line = normalizeLine(raw);
    const person = employees.find((item) => item.id === line.employeeId);
    if (!person) continue;
    rows.push([
      person.employeeCode,
      fullName(person),
      line.fullDays ?? "",
      line.halfDays ?? "",
      line.weeklyOffs ?? "",
      line.paidLeaveDays ?? "",
      line.paidDays ?? "",
      line.absentDays,
      line.lopDays ?? "",
      rangeLabel(run.periodStart, run.periodEnd),
    ]);
  }
  downloadText(`attendance-summary-${run.periodStart}.csv`, rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n"), "text/csv;charset=utf-8");
}

function exportDeductions(run: PayrollRun, employees: Employee[], currency: string, showSalary: boolean) {
  if (!showSalary) return;
  const rows: (string | number)[][] = [[
    "Employee ID", "Name", "PF", "ESIC", "Penalties", "Loan/advance", "Other", "Total deductions", "Period", "Currency",
  ]];
  for (const raw of run.lines) {
    const line = normalizeLine(raw);
    const person = employees.find((item) => item.id === line.employeeId);
    if (!person) continue;
    rows.push([
      person.employeeCode,
      fullName(person),
      line.pf ?? 0,
      line.esic ?? 0,
      line.penalties ?? 0,
      line.loan ?? 0,
      line.otherDeductions ?? 0,
      line.totalDeductions ?? 0,
      rangeLabel(run.periodStart, run.periodEnd),
      currency,
    ]);
  }
  downloadText(`deductions-${run.periodStart}.csv`, rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n"), "text/csv;charset=utf-8");
}

function exportMonthlySummary(run: PayrollRun, totals: ReturnType<typeof runTotals>, currency: string) {
  const rows: (string | number)[][] = [
    ["Metric", "Value"],
    ["Period", rangeLabel(run.periodStart, run.periodEnd)],
    ["Status", labelStatus(run.status)],
    ["Employees", totals.employees],
    ["Gross earnings", totals.grossEarnings],
    ["Deductions", totals.deductions],
    ["Net payable", totals.payable],
    ["Exceptions", totals.exceptions],
    ["Currency", currency],
    ["Payment reference", run.paymentReference ?? ""],
  ];
  downloadText(`monthly-summary-${run.periodStart}.csv`, rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n"), "text/csv;charset=utf-8");
}

function History() {
  const { state } = useApp();
  const navigate = useNavigate();
  const grouped = useMemo(() => {
    const map = new Map<string, PayrollRun[]>();
    for (const run of state.payrollRuns) {
      const key = financialYearLabel(run.periodStart, state.settings);
      const list = map.get(key) ?? [];
      list.push(run);
      map.set(key, list);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [state.payrollRuns, state.settings]);

  const fyStart = financialYearStartMonth(state.settings);
  const now = new Date();
  const currentFyStartYear = now.getMonth() + 1 >= fyStart ? now.getFullYear() : now.getFullYear() - 1;
  const bounds = financialYearBounds(currentFyStartYear, state.settings);

  return (
    <section className="panel">
      <h2>Payroll folders / history</h2>
      <p className="muted">
        Organized by configurable financial year (currently starts month {fyStart}). Current FY window {rangeLabel(bounds.start, bounds.end)}.
        Approved and paid runs stay immutable in normal editing.
      </p>
      {grouped.length === 0 && <EmptyState title="No archived periods" body="Payroll folders appear after you create runs." />}
      {grouped.map(([fy, runs]) => (
        <div key={fy} className="history-folder">
          <h3>{fy}</h3>
          {runs
            .slice()
            .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))
            .map((run) => (
              <div key={run.id} className="notice split">
                <div>
                  <strong>{rangeLabel(run.periodStart, run.periodEnd)}</strong>
                  <span className="muted" style={{ display: "block" }}>
                    {run.lines.length} employees
                    {run.importHistory?.length ? ` · ${run.importHistory.length} import(s)` : ""}
                    {run.finalizedAt ? ` · Approved ${formatDateTime(run.finalizedAt)}` : ""}
                    {run.paidAt ? ` · Paid ${formatDateTime(run.paidAt)}` : ""}
                  </span>
                </div>
                <div className="actions">
                  <StatusBadge value={run.status} />
                  <Button size="sm" variant="secondary" onClick={() => navigate(`/payroll/${run.id}`)}>Open</Button>
                </div>
              </div>
            ))}
        </div>
      ))}
    </section>
  );
}

function PayrollModuleSettings() {
  return (
    <section className="panel">
      <h2>Payroll settings</h2>
      <p className="muted">
        Financial year start, pay-period days, daily wage divisor, and rounding live under organization Settings → Payroll.
        Approval flow here is Draft → Calculated → In review → Verified → Approved → Paid.
      </p>
      <Banner tone="info">{PAYROLL_ASSUMPTION}</Banner>
      <ul>
        <li>PF / ESIC / OT rates: enter or import amounts — not auto-calculated.</li>
        <li>Daily wage: only when a divisor is configured in Settings.</li>
        <li>Paid-day formula: currently full + half×0.5 + paid leave (confirm with company policy).</li>
        <li>Excel: CSV import with column mapping; native .xlsx requires a future library.</li>
      </ul>
      <Link className="btn btn-secondary" to="/settings">Open Settings → Payroll</Link>
    </section>
  );
}

function Payslips() {
  const { state, user, can } = useApp();
  const [open, setOpen] = useState<Payslip | null>(null);
  if (!user) return null;
  const manage = can("payroll.manage");
  const rows = state.payslips
    .filter((item) => {
      if (manage) return true;
      return item.employeeId === user.id && item.published !== false;
    })
    .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));

  return (
    <section className="panel">
      <h2>{manage ? "Payslips" : "My payslips"}</h2>
      <p className="muted">
        {manage
          ? "Payslips are created when a run is approved. Employees only see their own published slips."
          : "Only your published payslips are listed here."}
      </p>
      <DataTable
        caption="Payslips"
        rows={rows}
        rowKey={(row) => row.id}
        emptyTitle="No payslips yet"
        emptyBody="Payslips appear after a payroll administrator approves a run."
        columns={[
          ...(manage ? [{ key: "who", header: "Employee", render: (row: Payslip) => fullName(state.employees.find((item) => item.id === row.employeeId)!) }] : []),
          { key: "period", header: "Period", render: (row: Payslip) => rangeLabel(row.periodStart, row.periodEnd) },
          { key: "pay", header: "Net payable", render: (row: Payslip) => formatMoney(row.payable, state.settings.currency) },
          { key: "open", header: "Action", render: (row: Payslip) => <Button size="sm" variant="secondary" onClick={() => setOpen(row)}>View</Button> },
        ]}
      />
      <Modal open={Boolean(open)} title="Payslip" onClose={() => setOpen(null)}>
        {open && <PayslipView slip={open} />}
      </Modal>
    </section>
  );
}

function PayslipView({ slip }: { slip: Payslip }) {
  const { state, user, can } = useApp();
  if (!user) return null;
  if (!can("payroll.manage") && slip.employeeId !== user.id) {
    return <Banner tone="error">You can only open your own payslip.</Banner>;
  }
  const person = state.employees.find((item) => item.id === slip.employeeId);
  const text = [
    "Buildesk People — Payslip (text preview; PDF generation not configured)",
    person ? fullName(person) : "",
    rangeLabel(slip.periodStart, slip.periodEnd),
    `Monthly gross: ${formatMoney(slip.monthlyGross, state.settings.currency)}`,
    `Overtime: ${formatMoney(slip.overtime ?? 0, state.settings.currency)}`,
    `Extras: ${formatMoney(slip.extras ?? 0, state.settings.currency)}`,
    `Arrears: ${formatMoney(slip.arrears ?? 0, state.settings.currency)}`,
    `Manual adjustment: ${formatMoney(slip.adjustment, state.settings.currency)}${slip.adjustmentReason ? ` (${slip.adjustmentReason})` : ""}`,
    `Expense reimbursements: ${formatMoney(slip.reimbursement, state.settings.currency)}`,
    `Gross earnings: ${formatMoney(slip.grossEarnings ?? slip.payable, state.settings.currency)}`,
    `PF: ${formatMoney(slip.pf ?? 0, state.settings.currency)}`,
    `ESIC: ${formatMoney(slip.esic ?? 0, state.settings.currency)}`,
    `Penalties: ${formatMoney(slip.penalties ?? 0, state.settings.currency)}`,
    `Loan/advance: ${formatMoney(slip.loan ?? 0, state.settings.currency)}`,
    `Other deductions: ${formatMoney(slip.otherDeductions ?? 0, state.settings.currency)}`,
    `Total deductions: ${formatMoney(slip.totalDeductions ?? 0, state.settings.currency)}`,
    `Net payable: ${formatMoney(slip.payable, state.settings.currency)}`,
    "",
    PAYROLL_ASSUMPTION,
  ].join("\n");

  return (
    <div>
      <dl className="dl">
        <dt>Employee</dt><dd>{person ? fullName(person) : "—"}</dd>
        <dt>Period</dt><dd>{rangeLabel(slip.periodStart, slip.periodEnd)}</dd>
        <dt>Monthly gross</dt><dd>{formatMoney(slip.monthlyGross, state.settings.currency)}</dd>
        <dt>Gross earnings</dt><dd>{formatMoney(slip.grossEarnings ?? slip.payable, state.settings.currency)}</dd>
        <dt>Total deductions</dt><dd>{formatMoney(slip.totalDeductions ?? 0, state.settings.currency)}</dd>
        <dt>Net payable</dt><dd>{formatMoney(slip.payable, state.settings.currency)}</dd>
      </dl>
      <Banner tone="info">Demo text payslip preview. PDF generation is not configured in this build.</Banner>
      <Banner tone="info">{PAYROLL_ASSUMPTION}</Banner>
      <Button onClick={() => downloadText(`payslip-${slip.periodStart}-${slip.employeeId}.txt`, text)}>Download payslip</Button>
    </div>
  );
}

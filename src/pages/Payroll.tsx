import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Banner, Button, DataTable, EmptyState, Field, Modal, NoAccess, PageHeader, StatusBadge, Tabs } from "../components/ui";
import { PAYROLL_ASSUMPTION, currentPeriod, periodForMonth, runTotals } from "../domain/payroll";
import { downloadText } from "../lib/download";
import { formatMoney, fullName, monthLabel, rangeLabel } from "../lib/format";
import { useTab } from "../lib/useTab";
import { useApp } from "../store/store";
import type { Payslip } from "../types";

export function Payroll() {
  const { runId } = useParams();
  const { state, user, can, busy } = useApp();
  if (!user) return null;
  const tabs = [
    ...(can("payroll.manage") ? [{ id: "runs", label: "Payroll runs" }] : []),
    { id: "payslips", label: "Payslips" },
  ];
  const [tab, setTab] = useTab(tabs.map((item) => item.id), can("payroll.manage") ? "runs" : "payslips");
  if (runId && !can("payroll.manage")) return <NoAccess body="Payroll runs are limited to HR, payroll, and system administrators. You can still open your own payslips." />;
  return (
    <div>
      <PageHeader
        title="Payroll"
        subtitle={`Configured period: day ${state.settings.payrollStartDay} through day ${state.settings.payrollEndDay}. Current period ${rangeLabel(currentPeriod(state.settings).start, currentPeriod(state.settings).end)}.`}
        crumbs={runId ? [{ label: "Payroll", to: "/payroll" }, { label: "Run" }] : undefined}
      />
      {!runId && <Tabs tabs={tabs} value={tab} onChange={setTab} />}
      {(runId || (tab === "runs" && can("payroll.manage"))) && <Runs selectedId={runId} />}
      {!runId && tab === "payslips" && <Payslips />}
      {busy === "payroll" && <Banner tone="info">Gathering attendance, leave, and expense inputs…</Banner>}
    </div>
  );
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
  return (
    <div className="grid-2">
      <section className="panel">
        <h2>Runs</h2>
        {state.payrollRuns.map((run) => (
          <Link key={run.id} to={`/payroll/${run.id}`} className="notice">
            <span><strong>{rangeLabel(run.periodStart, run.periodEnd)}</strong><span className="muted" style={{ display: "block" }}>{run.lines.length} employees</span></span>
            <StatusBadge value={run.status} />
          </Link>
        ))}
        <h3>New draft</h3>
        <p className="muted">This period would be {rangeLabel(preview.start, preview.end)}{preview.excluded.length ? `. ${preview.excluded.length} date(s) fall outside the configured days.` : ""}</p>
        <div className="form-grid">
          <Field label="Month">
            <select value={month} onChange={(event) => setMonth(Number(event.target.value))}>
              {Array.from({ length: 12 }, (_, index) => <option key={index} value={index}>{monthLabel(year, index)}</option>)}
            </select>
          </Field>
          <Field label="Year"><input type="number" value={year} onChange={(event) => setYear(Number(event.target.value))} /></Field>
        </div>
        {error && <Banner tone="error">{error}</Banner>}
        <Button onClick={async () => {
          const result = await actions.createPayrollRun(year, month);
          if (!result.ok) setError(result.message);
          else if (result.id) navigate(`/payroll/${result.id}`);
        }}>Create draft run</Button>
      </section>
      <div>{selected ? <RunDetail runId={selected.id} /> : <EmptyState title="Select a run" body="Open a draft to review inputs, exceptions, and totals before finalizing." />}</div>
    </div>
  );
}

function RunDetail({ runId }: { runId: string }) {
  const { state, actions, busy } = useApp();
  const run = state.payrollRuns.find((item) => item.id === runId);
  const [finalizeOpen, setFinalize] = useState(false);
  const [checked, setChecked] = useState(false);
  const [adjustments, setAdjustments] = useState<Record<string, { amount: string; reason: string }>>({});
  const [error, setError] = useState("");
  const totals = useMemo(() => (run ? runTotals(run) : null), [run]);
  if (!run || !totals) return null;
  const locked = run.status === "finalized" || run.status === "paid";
  const steps = ["Period", "Inputs", "Exceptions", "Preview", "Confirm"];
  const step = run.status === "paid" ? 5 : run.status === "finalized" ? 4 : run.status === "in_review" ? 3 : 1;
  return (
    <section className="panel">
      <div className="spread">
        <h2>{rangeLabel(run.periodStart, run.periodEnd)}</h2>
        <StatusBadge value={run.status} />
      </div>
      <div className="stepper">
        {steps.map((label, index) => <span key={label} className={index <= step ? "step on" : "step"}>{index + 1}. {label}</span>)}
      </div>
      <Banner tone="info">{PAYROLL_ASSUMPTION}</Banner>
      {run.warnings.map((warning) => <Banner key={warning} tone="warning">{warning}</Banner>)}
      <p><strong>Gross {formatMoney(totals.gross, state.settings.currency)}</strong> · Adjustments {formatMoney(totals.adjustments, state.settings.currency)} · Reimbursements {formatMoney(totals.reimbursements, state.settings.currency)} · Payable {formatMoney(totals.payable, state.settings.currency)}</p>
      <div className="actions">
        <Button variant="secondary" disabled={locked || busy === "payroll"} onClick={() => actions.refreshPayroll(run.id)}>Refresh inputs</Button>
        {run.status === "draft" && <Button onClick={() => actions.advancePayroll(run.id, "in_review")}>Send for review</Button>}
        {run.status === "in_review" && <Button onClick={async () => { setChecked(false); setFinalize(true); }}>Finalize payroll</Button>}
        {run.status === "finalized" && <Button onClick={() => actions.advancePayroll(run.id, "paid")}>Mark as paid</Button>}
      </div>
      {locked && <p className="muted">This run is locked. Earlier punches and approvals stay in their own history.</p>}
      <h3>Exceptions</h3>
      {run.lines.every((line) => line.exceptions.length === 0) ? <p className="muted">No employee-level exceptions.</p> : run.lines.filter((line) => line.exceptions.length > 0).map((line) => (
        <div key={line.employeeId} className="notice">
          <strong>{fullName(state.employees.find((item) => item.id === line.employeeId)!)}</strong>
          <span className="muted">{line.exceptions.join(" ")}</span>
        </div>
      ))}
      <h3>Inputs</h3>
      <div className="table-wrap">
        <table className="data">
          <caption className="sr-only">Payroll inputs</caption>
          <thead>
            <tr>
              <th>Employee</th><th>Gross</th><th>Present</th><th>Leave</th><th>Unpaid</th><th>Absent</th><th>Reimburse</th><th>Adjustment</th><th>Payable</th>
            </tr>
          </thead>
          <tbody>
            {run.lines.map((line) => {
              const person = state.employees.find((item) => item.id === line.employeeId);
              const local = adjustments[line.employeeId] ?? { amount: String(line.adjustment), reason: line.adjustmentReason };
              return (
                <tr key={line.employeeId}>
                  <td>{person ? fullName(person) : "Employee"}</td>
                  <td>{formatMoney(line.monthlyGross, state.settings.currency)}</td>
                  <td>{line.presentDays}</td>
                  <td>{line.leaveDays}</td>
                  <td>{line.unpaidLeaveDays}</td>
                  <td>{line.absentDays}</td>
                  <td>{formatMoney(line.reimbursement, state.settings.currency)}</td>
                  <td>
                    {locked ? formatMoney(line.adjustment, state.settings.currency) : (
                      <div className="stack">
                        <input value={local.amount} onChange={(event) => setAdjustments({ ...adjustments, [line.employeeId]: { ...local, amount: event.target.value } })} aria-label={`Adjustment for ${person ? fullName(person) : "employee"}`} />
                        <input value={local.reason} placeholder="Reason if not zero" onChange={(event) => setAdjustments({ ...adjustments, [line.employeeId]: { ...local, reason: event.target.value } })} />
                        <Button size="sm" variant="secondary" onClick={async () => {
                          const result = await actions.updatePayrollLine(run.id, line.employeeId, Number(local.amount || 0), local.reason);
                          if (!result.ok) setError(result.message);
                          else setError("");
                        }}>Save</Button>
                      </div>
                    )}
                  </td>
                  <td>{formatMoney(line.payable, state.settings.currency)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {error && <Banner tone="error">{error}</Banner>}
      <Modal open={finalizeOpen} title="Finalize payroll" onClose={() => setFinalize(false)}>
        <p>This locks the run for {rangeLabel(run.periodStart, run.periodEnd)}, creates payslips, and marks included expense claims as paid.</p>
        <p>Payable total: <strong>{formatMoney(totals.payable, state.settings.currency)}</strong> for {totals.employees} employees.</p>
        <Banner tone="warning">{PAYROLL_ASSUMPTION}</Banner>
        <label className="check">
          <input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} />
          <span>I reviewed the exceptions and totals. I understand tax and statutory deductions are not calculated.</span>
        </label>
        <div className="actions">
          <Button variant="secondary" onClick={() => setFinalize(false)}>Cancel</Button>
          <Button disabled={!checked} onClick={async () => { actions.advancePayroll(run.id, "finalized"); setFinalize(false); }}>Finalize payroll</Button>
        </div>
      </Modal>
    </section>
  );
}

function Payslips() {
  const { state, user, can } = useApp();
  const [open, setOpen] = useState<Payslip | null>(null);
  if (!user) return null;
  const rows = state.payslips.filter((item) => can("payroll.manage") || item.employeeId === user.id).sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
  return (
    <section className="panel">
      <h2>{can("payroll.manage") ? "Payslips" : "My payslips"}</h2>
      <DataTable
        caption="Payslips"
        rows={rows}
        rowKey={(row) => row.id}
        emptyTitle="No payslips yet"
        emptyBody="Payslips appear after a payroll administrator finalizes a run."
        columns={[
          { key: "who", header: "Employee", render: (row) => fullName(state.employees.find((item) => item.id === row.employeeId)!) },
          { key: "period", header: "Period", render: (row) => rangeLabel(row.periodStart, row.periodEnd) },
          { key: "pay", header: "Payable", render: (row) => formatMoney(row.payable, state.settings.currency) },
          { key: "open", header: "Action", render: (row) => <Button size="sm" variant="secondary" onClick={() => setOpen(row)}>View</Button> },
        ]}
      />
      <Modal open={Boolean(open)} title="Payslip" onClose={() => setOpen(null)}>
        {open && <PayslipView slip={open} onClose={() => setOpen(null)} />}
      </Modal>
    </section>
  );
}

function PayslipView({ slip }: { slip: Payslip; onClose: () => void }) {
  const { state } = useApp();
  const person = state.employees.find((item) => item.id === slip.employeeId);
  const text = [
    "Buildesk People",
    "Payslip",
    person ? fullName(person) : "",
    rangeLabel(slip.periodStart, slip.periodEnd),
    `Monthly gross: ${formatMoney(slip.monthlyGross, state.settings.currency)}`,
    `Manual adjustment: ${formatMoney(slip.adjustment, state.settings.currency)}${slip.adjustmentReason ? ` (${slip.adjustmentReason})` : ""}`,
    `Expense reimbursements: ${formatMoney(slip.reimbursement, state.settings.currency)}`,
    "Statutory deductions: Not configured",
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
        <dt>Adjustment</dt><dd>{formatMoney(slip.adjustment, state.settings.currency)} {slip.adjustmentReason}</dd>
        <dt>Reimbursements</dt><dd>{formatMoney(slip.reimbursement, state.settings.currency)}</dd>
        <dt>Statutory deductions</dt><dd>Not configured</dd>
        <dt>Net payable</dt><dd>{formatMoney(slip.payable, state.settings.currency)}</dd>
      </dl>
      <Banner tone="info">{PAYROLL_ASSUMPTION}</Banner>
      <Button onClick={() => downloadText(`payslip-${slip.periodStart}.txt`, text)}>Download payslip</Button>
    </div>
  );
}

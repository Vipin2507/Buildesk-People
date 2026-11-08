import { clampDay, eachDate, todayIso } from "./dates";
import { isNonWorking, leaveTypeOnDate } from "./leave";
import type { AppState, Employee, OrgSettings, PayrollLine, PayrollRun } from "../types";

export interface PeriodWindow {
  start: string;
  end: string;
  excluded: string[];
}

export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

export function periodForMonth(year: number, monthIndex: number, settings: OrgSettings): PeriodWindow {
  const last = daysInMonth(year, monthIndex);
  const startDay = clampDay(settings.payrollStartDay, last);
  const endDay = clampDay(settings.payrollEndDay, last);
  const start = `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(startDay).padStart(2, "0")}`;
  const end = `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`;
  const excluded: string[] = [];
  for (let day = 1; day < startDay; day += 1) {
    excluded.push(`${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  }
  for (let day = endDay + 1; day <= last; day += 1) {
    excluded.push(`${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  }
  return { start, end, excluded };
}

export function currentPeriod(settings: OrgSettings, today = new Date()): PeriodWindow {
  return periodForMonth(today.getFullYear(), today.getMonth(), settings);
}

export function previousPeriod(settings: OrgSettings, today = new Date()): PeriodWindow {
  const date = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  return periodForMonth(date.getFullYear(), date.getMonth(), settings);
}

function payableOf(line: Pick<PayrollLine, "monthlyGross" | "adjustment" | "reimbursement">): number {
  return line.monthlyGross + line.adjustment + line.reimbursement;
}

export function buildPayrollLines(state: AppState, start: string, end: string, runId?: string): { lines: PayrollLine[]; warnings: string[] } {
  const today = todayIso();
  const warnings: string[] = [];
  if (end >= today) {
    warnings.push("This payroll period is still open. Totals can change until the period ends and inputs are refreshed.");
  }
  const people = state.employees.filter((item) => item.status !== "inactive");
  const lines = people.map((employee) => lineFor(state, employee, start, end, today, runId));
  if (lines.some((line) => line.lateDays > 0)) {
    warnings.push("Late arrivals are listed for review. No late-penalty rule is configured, so they do not change pay.");
  }
  if (lines.some((line) => line.unpaidLeaveDays > 0)) {
    warnings.push("Unpaid leave is flagged and does not change gross pay. No unpaid-leave deduction rule is configured.");
  }
  if (lines.some((line) => line.monthlyGross <= 0)) {
    warnings.push("One or more employees have no demo monthly gross. Their payable amount stays at reimbursements and adjustments only.");
  }
  return { lines, warnings };
}

function lineFor(state: AppState, employee: Employee, start: string, end: string, today: string, runId?: string): PayrollLine {
  const records = state.attendance.filter((item) => item.employeeId === employee.id && item.date >= start && item.date <= end);
  let presentDays = 0;
  let lateDays = 0;
  let leaveDays = 0;
  let unpaidLeaveDays = 0;
  let compOffDays = 0;
  let absentDays = 0;
  let incompleteDays = 0;
  let remoteDays = 0;
  const exceptions: string[] = [];

  records.forEach((record) => {
    if (record.date > today && record.status !== "leave") return;
    if (record.date === today && record.status !== "present" && record.status !== "late" && record.status !== "leave" && record.status !== "incomplete") {
      return;
    }
    if (record.status === "present") presentDays += 1;
    if (record.status === "late") {
      presentDays += 1;
      lateDays += 1;
    }
    if (record.status === "absent") absentDays += 1;
    if (record.status === "incomplete") incompleteDays += 1;
    if (record.status === "leave") {
      const request = state.leaveRequests.find(
        (item) =>
          item.employeeId === employee.id &&
          item.status === "approved" &&
          item.startDate <= record.date &&
          item.endDate >= record.date,
      );
      const portion = request && request.partial !== "none" ? 0.5 : 1;
      leaveDays += portion;
      const type = request ? state.settings.leaveTypes.find((item) => item.id === request.typeId) ?? null : leaveTypeOnDate(state, employee.id, record.date);
      if (type && !type.paid) unpaidLeaveDays += portion;
      if (type?.id === "comp-off") compOffDays += portion;
    }
    if (record.workMode === "remote" && (record.status === "present" || record.status === "late")) remoteDays += 1;
  });

  const pastEnd = end < today ? end : addSafe(today, -1);
  if (pastEnd >= start) {
    eachDate(start, pastEnd).forEach((iso) => {
      if (isNonWorking(iso, employee.locationId, state.settings, state.holidays)) return;
      const record = records.find((item) => item.date === iso);
      if (!record) absentDays += 1;
    });
  }

  if (incompleteDays > 0) exceptions.push(`${incompleteDays} missed punch${incompleteDays === 1 ? "" : "es"} in this period.`);
  if (absentDays > 0) exceptions.push(`${absentDays} absent day${absentDays === 1 ? "" : "s"} with no approved leave.`);
  if (unpaidLeaveDays > 0) exceptions.push(`${unpaidLeaveDays} unpaid leave day${unpaidLeaveDays === 1 ? "" : "s"}. Gross is unchanged.`);
  if (employee.monthlyGross <= 0) exceptions.push("Demo monthly gross is not set.");

  const pendingLeave = state.leaveRequests.some(
    (item) => item.employeeId === employee.id && item.status === "pending" && item.startDate <= end && item.endDate >= start,
  );
  if (pendingLeave) exceptions.push("A pending leave request overlaps this period and is not included.");
  const pendingFix = state.regularizations.some(
    (item) => item.employeeId === employee.id && item.status === "pending" && item.date >= start && item.date <= end,
  );
  if (pendingFix) exceptions.push("A pending attendance correction overlaps this period.");

  const expenses = state.expenses.filter((item) => {
    if (item.employeeId !== employee.id || item.date < start || item.date > end) return false;
    if (item.status === "approved" && !item.payrollRunId) return true;
    if (runId && item.payrollRunId === runId) return true;
    return false;
  });
  const reimbursement = expenses.reduce((sum, item) => sum + item.amount, 0);
  const pendingExpense = state.expenses.some(
    (item) => item.employeeId === employee.id && item.status === "pending" && item.date >= start && item.date <= end,
  );
  if (pendingExpense) exceptions.push("A pending expense in this period is not included.");

  const existing = state.payrollRuns.find((run) => run.id === runId)?.lines.find((line) => line.employeeId === employee.id);
  const adjustment = existing?.adjustment ?? 0;
  const adjustmentReason = existing?.adjustmentReason ?? "";
  const monthlyGross = employee.monthlyGross;
  const round = (value: number) => Math.round(value * 2) / 2;
  return {
    employeeId: employee.id,
    monthlyGross,
    presentDays: round(presentDays),
    lateDays: round(lateDays),
    leaveDays: round(leaveDays),
    unpaidLeaveDays: round(unpaidLeaveDays),
    compOffDays: round(compOffDays),
    absentDays: round(absentDays),
    incompleteDays: round(incompleteDays),
    remoteDays: round(remoteDays),
    reimbursement,
    adjustment,
    adjustmentReason,
    exceptions,
    payable: payableOf({ monthlyGross, adjustment, reimbursement }),
  };
}

export function periodWarnings(excluded: string[], settings: OrgSettings): string[] {
  if (excluded.length === 0) return [];
  const preview = excluded.slice(0, 4).map((iso) => iso.slice(8).replace(/^0/, "") + " " + monthShort(iso)).join(", ");
  const extra = excluded.length > 4 ? ` and ${excluded.length - 4} more` : "";
  return [
    `This run uses day ${settings.payrollStartDay} through day ${settings.payrollEndDay}. Dates outside that period are excluded: ${preview}${extra}.`,
  ];
}

function monthShort(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", { month: "short" }).format(new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))));
}

function addSafe(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, (m || 1) - 1, d || 1);
  date.setDate(date.getDate() + days);
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function applyAdjustments(lines: PayrollLine[], previous: PayrollLine[]): PayrollLine[] {
  return lines.map((line) => {
    const prior = previous.find((item) => item.employeeId === line.employeeId);
    const adjustment = prior?.adjustment ?? 0;
    const adjustmentReason = prior?.adjustmentReason ?? "";
    return {
      ...line,
      adjustment,
      adjustmentReason,
      payable: line.monthlyGross + adjustment + line.reimbursement,
    };
  });
}

export function runTotals(run: Pick<PayrollRun, "lines">) {
  return run.lines.reduce(
    (totals, line) => {
      totals.gross += line.monthlyGross;
      totals.adjustments += line.adjustment;
      totals.reimbursements += line.reimbursement;
      totals.payable += line.payable;
      totals.exceptions += line.exceptions.length > 0 ? 1 : 0;
      return totals;
    },
    { employees: run.lines.length, gross: 0, adjustments: 0, reimbursements: 0, payable: 0, exceptions: 0 },
  );
}

export const PAYROLL_ASSUMPTION =
  "Demo payroll uses the configured monthly gross, plus any manual adjustment and approved expense reimbursements. Tax, provident fund, professional tax, overtime, and other statutory rules are not configured and are not calculated. Unpaid leave is shown for review and does not change gross pay.";

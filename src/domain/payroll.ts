import { clampDay, eachDate, todayIso } from "./dates";
import { isNonWorking, leaveTypeOnDate } from "./leave";
import type { AppState, Employee, OrgSettings, PayrollLine, PayrollRun, PayrollValueSource } from "../types";

export interface PeriodWindow {
  start: string;
  end: string;
  excluded: string[];
}

export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

export function financialYearStartMonth(settings: OrgSettings): number {
  const month = settings.financialYearStartMonth ?? 4;
  return Math.min(12, Math.max(1, month));
}

/** Returns the financial-year label covering an ISO date, e.g. "FY 2026-27". */
export function financialYearLabel(iso: string, settings: OrgSettings): string {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const startMonth = financialYearStartMonth(settings);
  const fyStart = month >= startMonth ? year : year - 1;
  return `FY ${fyStart}-${String(fyStart + 1).slice(2)}`;
}

export function financialYearBounds(fyStartYear: number, settings: OrgSettings): { start: string; end: string } {
  const startMonth = financialYearStartMonth(settings);
  const start = `${fyStartYear}-${String(startMonth).padStart(2, "0")}-01`;
  const endYear = startMonth === 1 ? fyStartYear : fyStartYear + 1;
  const endMonth = startMonth === 1 ? 12 : startMonth - 1;
  const last = daysInMonth(endYear, endMonth - 1);
  const end = `${endYear}-${String(endMonth).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
  return { start, end };
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

export function computePayable(line: Pick<PayrollLine, "monthlyGross" | "adjustment" | "reimbursement" | "overtime" | "extras" | "arrears" | "pf" | "esic" | "penalties" | "loan" | "otherDeductions">): {
  grossEarnings: number;
  totalDeductions: number;
  payable: number;
} {
  const overtime = line.overtime ?? 0;
  const extras = line.extras ?? 0;
  const arrears = line.arrears ?? 0;
  const pf = line.pf ?? 0;
  const esic = line.esic ?? 0;
  const penalties = line.penalties ?? 0;
  const loan = line.loan ?? 0;
  const otherDeductions = line.otherDeductions ?? 0;
  const grossEarnings = line.monthlyGross + overtime + extras + arrears + line.reimbursement + line.adjustment;
  const totalDeductions = pf + esic + penalties + loan + otherDeductions;
  return { grossEarnings, totalDeductions, payable: grossEarnings - totalDeductions };
}

export function normalizeLine(line: PayrollLine, settings?: OrgSettings): PayrollLine {
  const overtime = line.overtime ?? 0;
  const extras = line.extras ?? 0;
  const arrears = line.arrears ?? 0;
  const pf = line.pf ?? 0;
  const esic = line.esic ?? 0;
  const penalties = line.penalties ?? 0;
  const loan = line.loan ?? 0;
  const otherDeductions = line.otherDeductions ?? 0;
  const halfDays = line.halfDays ?? 0;
  const fullDays = line.fullDays ?? Math.max(0, line.presentDays - halfDays);
  const paidLeaveDays = line.paidLeaveDays ?? Math.max(0, line.leaveDays - line.unpaidLeaveDays);
  const weeklyOffs = line.weeklyOffs ?? 0;
  const paidDays = line.paidDays ?? fullDays + halfDays * 0.5 + paidLeaveDays;
  const lopDays = line.lopDays ?? line.unpaidLeaveDays;
  const divisor = settings?.payrollDailyWageDivisor;
  const dailyWage = line.dailyWage !== undefined
    ? line.dailyWage
    : divisor && divisor > 0
      ? Math.round((line.monthlyGross / divisor) * 100) / 100
      : null;
  const money = computePayable({
    monthlyGross: line.monthlyGross,
    adjustment: line.adjustment,
    reimbursement: line.reimbursement,
    overtime,
    extras,
    arrears,
    pf,
    esic,
    penalties,
    loan,
    otherDeductions,
  });
  return {
    ...line,
    fullDays,
    halfDays,
    weeklyOffs,
    paidLeaveDays,
    paidDays,
    lopDays,
    dailyWage,
    overtime,
    extras,
    arrears,
    pf,
    esic,
    penalties,
    loan,
    otherDeductions,
    grossEarnings: money.grossEarnings,
    totalDeductions: money.totalDeductions,
    payable: money.payable,
    sources: {
      monthlyGross: "employee",
      presentDays: "attendance",
      leaveDays: "attendance",
      unpaidLeaveDays: "attendance",
      absentDays: "attendance",
      reimbursement: "calculated",
      adjustment: line.adjustment !== 0 ? "manual" : "manual",
      overtime: overtime !== 0 ? (line.sources?.overtime ?? "manual") : "unconfigured",
      extras: extras !== 0 ? (line.sources?.extras ?? "manual") : "unconfigured",
      arrears: arrears !== 0 ? (line.sources?.arrears ?? "manual") : "unconfigured",
      pf: pf !== 0 ? (line.sources?.pf ?? "manual") : "unconfigured",
      esic: esic !== 0 ? (line.sources?.esic ?? "manual") : "unconfigured",
      penalties: penalties !== 0 ? (line.sources?.penalties ?? "manual") : "unconfigured",
      loan: loan !== 0 ? (line.sources?.loan ?? "manual") : "unconfigured",
      otherDeductions: otherDeductions !== 0 ? (line.sources?.otherDeductions ?? "manual") : "unconfigured",
      dailyWage: dailyWage === null ? "unconfigured" : "calculated",
      ...line.sources,
    },
  };
}

export function buildPayrollLines(state: AppState, start: string, end: string, runId?: string): { lines: PayrollLine[]; warnings: string[] } {
  const today = todayIso();
  const warnings: string[] = [];
  if (end >= today) {
    warnings.push("This payroll period is still open. Totals can change until the period ends and inputs are refreshed.");
  }
  const people = state.employees.filter((item) => item.status !== "inactive");
  const lines = people.map((employee) => normalizeLine(lineFor(state, employee, start, end, today, runId), state.settings));
  if (lines.some((line) => line.lateDays > 0)) {
    warnings.push("Late arrivals are listed for review. No late-penalty rule is configured, so they do not change pay.");
  }
  if (lines.some((line) => line.unpaidLeaveDays > 0)) {
    warnings.push("Unpaid leave / LOP is flagged and does not change gross pay unless a deduction is entered manually or imported.");
  }
  if (lines.some((line) => line.monthlyGross <= 0)) {
    warnings.push("One or more employees have no monthly gross. Their payable amount stays at reimbursements, adjustments, and entered extras only.");
  }
  warnings.push("PF, ESIC, overtime, penalties, and loan recovery are not auto-calculated. Enter or import those amounts only when your company rules are known.");
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
  let halfDays = 0;
  let weeklyOffs = 0;
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
    if (record.status === "holiday") weeklyOffs += 1;
    if (record.status === "leave") {
      const request = state.leaveRequests.find(
        (item) =>
          item.employeeId === employee.id &&
          item.status === "approved" &&
          item.startDate <= record.date &&
          item.endDate >= record.date,
      );
      const portion = request && request.partial !== "none" ? 0.5 : 1;
      if (portion === 0.5) halfDays += 1;
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
      if (isNonWorking(iso, employee.locationId, state.settings, state.holidays)) {
        const record = records.find((item) => item.date === iso);
        if (!record) weeklyOffs += 1;
        return;
      }
      const record = records.find((item) => item.date === iso);
      if (!record) absentDays += 1;
    });
  }

  if (incompleteDays > 0) exceptions.push(`${incompleteDays} missed punch${incompleteDays === 1 ? "" : "es"} in this period.`);
  if (absentDays > 0) exceptions.push(`${absentDays} absent day${absentDays === 1 ? "" : "s"} with no approved leave.`);
  if (unpaidLeaveDays > 0) exceptions.push(`${unpaidLeaveDays} unpaid leave day${unpaidLeaveDays === 1 ? "" : "s"}. Gross is unchanged until a deduction is entered.`);
  if (employee.monthlyGross <= 0) exceptions.push("Monthly gross is not set.");
  if (!employee.bankAccountNumber) exceptions.push("Bank account is not on file.");

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
  const preserved = {
    overtime: existing?.overtime ?? 0,
    extras: existing?.extras ?? 0,
    arrears: existing?.arrears ?? 0,
    pf: existing?.pf ?? 0,
    esic: existing?.esic ?? 0,
    penalties: existing?.penalties ?? 0,
    loan: existing?.loan ?? 0,
    otherDeductions: existing?.otherDeductions ?? 0,
    sources: existing?.sources,
  };
  const money = computePayable({
    monthlyGross,
    adjustment,
    reimbursement,
    ...preserved,
  });
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
    halfDays: round(halfDays),
    weeklyOffs: round(weeklyOffs),
    reimbursement,
    adjustment,
    adjustmentReason,
    exceptions,
    payable: money.payable,
    ...preserved,
    grossEarnings: money.grossEarnings,
    totalDeductions: money.totalDeductions,
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
    const next = {
      ...line,
      adjustment,
      adjustmentReason,
      overtime: prior?.overtime ?? line.overtime ?? 0,
      extras: prior?.extras ?? line.extras ?? 0,
      arrears: prior?.arrears ?? line.arrears ?? 0,
      pf: prior?.pf ?? line.pf ?? 0,
      esic: prior?.esic ?? line.esic ?? 0,
      penalties: prior?.penalties ?? line.penalties ?? 0,
      loan: prior?.loan ?? line.loan ?? 0,
      otherDeductions: prior?.otherDeductions ?? line.otherDeductions ?? 0,
      sources: prior?.sources ?? line.sources,
    };
    const money = computePayable(next);
    return { ...next, grossEarnings: money.grossEarnings, totalDeductions: money.totalDeductions, payable: money.payable };
  });
}

export function runTotals(run: Pick<PayrollRun, "lines">) {
  return run.lines.reduce(
    (totals, raw) => {
      const line = normalizeLine(raw);
      totals.gross += line.monthlyGross;
      totals.adjustments += line.adjustment;
      totals.reimbursements += line.reimbursement;
      totals.grossEarnings += line.grossEarnings ?? line.payable;
      totals.deductions += line.totalDeductions ?? 0;
      totals.payable += line.payable;
      totals.exceptions += line.exceptions.length > 0 ? 1 : 0;
      return totals;
    },
    { employees: run.lines.length, gross: 0, adjustments: 0, reimbursements: 0, grossEarnings: 0, deductions: 0, payable: 0, exceptions: 0 },
  );
}

export function maskBankAccount(value: string | undefined | null): string {
  if (!value) return "Not on file";
  const digits = value.replace(/\s+/g, "");
  if (digits.length < 4) return "••••";
  return `••••${digits.slice(-4)}`;
}

export function canRevealBank(canManagePayroll: boolean): boolean {
  return canManagePayroll;
}

export function statusLabel(status: PayrollRun["status"]): string {
  if (status === "finalized") return "Approved";
  if (status === "calculated") return "Calculated";
  if (status === "verified") return "Verified";
  if (status === "failed") return "Failed";
  if (status === "in_review") return "In review";
  if (status === "paid") return "Paid";
  return "Draft";
}

export function isRunLocked(status: PayrollRun["status"]): boolean {
  return status === "finalized" || status === "paid";
}

export function sourceLabel(source: PayrollValueSource | undefined): string {
  if (source === "imported") return "Imported";
  if (source === "manual") return "Manual";
  if (source === "attendance") return "Attendance";
  if (source === "employee") return "Employee record";
  if (source === "calculated") return "Calculated";
  return "Not configured";
}

export const PAYROLL_ASSUMPTION =
  "Payroll uses the configured monthly gross, plus any manual adjustment, approved expense reimbursements, and any overtime, extras, arrears, or deductions that were entered or imported. Tax, PF, ESIC, professional tax, overtime rates, and other statutory rules are not auto-calculated. Configure or import those amounts only when your company rules are confirmed.";

import { activeMasters } from "./masters";
import { computePayable, normalizeLine } from "./payroll";
import { fullName, monthLabel } from "../lib/format";
import type {
  AppState,
  Employee,
  OrgSettings,
  PayrollLine,
  PayrollRun,
  Payslip,
  PayslipComponent,
  PayslipPaperSize,
} from "../types";

export const PAYSLIP_TEMPLATE_VERSION = "cravingcode-letter-v1";

export interface PayslipCompanyBlock {
  legalName: string;
  address: string;
  registrationId: string;
  currency: string;
  paperSize: PayslipPaperSize;
  notes: string;
}

export interface PayslipEmployeeBlock {
  name: string;
  employeeCode: string;
  designation: string;
  department: string;
  location: string;
}

export interface PayslipDto {
  slipId: string | null;
  runId: string;
  employeeId: string;
  periodStart: string;
  periodEnd: string;
  periodTitle: string;
  company: PayslipCompanyBlock;
  employee: PayslipEmployeeBlock;
  paidDays: number;
  lopDays: number;
  earnings: PayslipComponent[];
  deductions: PayslipComponent[];
  grossEarnings: number;
  totalDeductions: number;
  netPayable: number;
  netPayableWords: string;
  calculationSummary: string;
  notes: string;
  runStatus: PayrollRun["status"];
  official: boolean;
  watermark: string | null;
  templateVersion: string;
  version: number;
  filename: string;
}

export interface PayslipValidation {
  ok: boolean;
  missing: string[];
}

function masterName(state: AppState, kind: "payroll_earnings" | "payroll_deductions", code: string, fallback: string): string {
  const match = activeMasters(state, kind).find((item) => item.code === code || item.id === code);
  return match?.name ?? fallback;
}

export function companyBlock(settings: OrgSettings): PayslipCompanyBlock {
  return {
    legalName: (settings.legalName?.trim() || settings.orgName).toUpperCase(),
    address: settings.registeredAddress?.trim() || "",
    registrationId: settings.registrationId?.trim() || "",
    currency: settings.currency || "INR",
    paperSize: settings.payslipPaperSize === "a4" ? "a4" : "letter",
    notes: settings.payslipNotes?.trim() || "",
  };
}

export function employeeBlock(state: AppState, person: Employee): PayslipEmployeeBlock {
  return {
    name: fullName(person),
    employeeCode: person.employeeCode,
    designation: person.jobTitle?.trim() || "—",
    department: state.departments.find((item) => item.id === person.departmentId)?.name ?? "—",
    location: state.locations.find((item) => item.id === person.locationId)?.name ?? "—",
  };
}

/** Map persisted payroll line fields to printable components. Does not invent statutory splits. */
export function componentsFromLine(state: AppState, line: PayrollLine): {
  earnings: PayslipComponent[];
  deductions: PayslipComponent[];
  grossEarnings: number;
  totalDeductions: number;
  netPayable: number;
} {
  const normalized = normalizeLine(line, state.settings);
  const money = computePayable(normalized);
  const earnings: PayslipComponent[] = ([
    { key: "monthlyGross", label: masterName(state, "payroll_earnings", "monthly_gross", "Monthly gross"), amount: normalized.monthlyGross, kind: "earning" as const },
    { key: "overtime", label: masterName(state, "payroll_earnings", "overtime", "Overtime"), amount: normalized.overtime ?? 0, kind: "earning" as const },
    { key: "extras", label: masterName(state, "payroll_earnings", "extras", "Extras"), amount: normalized.extras ?? 0, kind: "earning" as const },
    { key: "arrears", label: masterName(state, "payroll_earnings", "arrears", "Arrears"), amount: normalized.arrears ?? 0, kind: "earning" as const },
    { key: "reimbursement", label: masterName(state, "payroll_earnings", "reimbursement", "Reimbursement"), amount: normalized.reimbursement, kind: "earning" as const },
    { key: "adjustment", label: masterName(state, "payroll_earnings", "adjustment", "Adjustment"), amount: normalized.adjustment, kind: "earning" as const },
  ] satisfies PayslipComponent[]).filter((item) => item.key === "monthlyGross" || item.amount !== 0);

  const deductions: PayslipComponent[] = ([
    { key: "pf", label: masterName(state, "payroll_deductions", "pf", "PF"), amount: normalized.pf ?? 0, kind: "deduction" as const },
    { key: "esic", label: masterName(state, "payroll_deductions", "esic", "ESIC"), amount: normalized.esic ?? 0, kind: "deduction" as const },
    { key: "penalties", label: masterName(state, "payroll_deductions", "penalty", "Penalties"), amount: normalized.penalties ?? 0, kind: "deduction" as const },
    { key: "loan", label: masterName(state, "payroll_deductions", "loan", "Loan / advance"), amount: normalized.loan ?? 0, kind: "deduction" as const },
    { key: "otherDeductions", label: masterName(state, "payroll_deductions", "other", "Other deductions"), amount: normalized.otherDeductions ?? 0, kind: "deduction" as const },
  ] satisfies PayslipComponent[]).filter((item) => item.amount !== 0);

  return {
    earnings,
    deductions,
    grossEarnings: money.grossEarnings,
    totalDeductions: money.totalDeductions,
    netPayable: money.payable,
  };
}

export function periodTitle(periodStart: string): string {
  const year = Number(periodStart.slice(0, 4));
  const monthIndex = Number(periodStart.slice(5, 7)) - 1;
  return `PAYSLIP | ${monthLabel(year, monthIndex).toUpperCase()}`;
}

export function payslipFilename(employeeCode: string, periodStart: string): string {
  const safeCode = employeeCode.replace(/[^a-zA-Z0-9_-]/g, "_") || "employee";
  return `Payslip_${safeCode}_${periodStart.slice(0, 7)}.pdf`;
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  const ten = Math.floor(n / 10);
  const one = n % 10;
  return `${TENS[ten]}${one ? ` ${ONES[one]}` : ""}`.trim();
}

function threeDigits(n: number): string {
  const hundred = Math.floor(n / 100);
  const rest = n % 100;
  if (hundred && rest) return `${ONES[hundred]} Hundred ${twoDigits(rest)}`;
  if (hundred) return `${ONES[hundred]} Hundred`;
  return twoDigits(rest);
}

/** Indian numbering for INR amounts shown on payslips. */
export function amountInWordsInr(amount: number): string {
  const rounded = Math.round(Math.abs(amount) * 100) / 100;
  const whole = Math.floor(rounded);
  const paise = Math.round((rounded - whole) * 100);
  if (whole === 0 && paise === 0) return "Zero Rupees Only";

  let n = whole;
  const crore = Math.floor(n / 10000000);
  n %= 10000000;
  const lakh = Math.floor(n / 100000);
  n %= 100000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  const parts: string[] = [];
  if (crore) parts.push(`${threeDigits(crore)} Crore`);
  if (lakh) parts.push(`${threeDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${threeDigits(thousand)} Thousand`);
  if (n) parts.push(threeDigits(n));
  let words = `${parts.join(" ")} Rupees`.replace(/\s+/g, " ").trim();
  if (paise) words += ` and ${twoDigits(paise)} Paise`;
  if (amount < 0) words = `Minus ${words}`;
  return `${words} Only`;
}

export function validatePayslipData(state: AppState, run: PayrollRun, person: Employee, line: PayrollLine): PayslipValidation {
  const missing: string[] = [];
  const company = companyBlock(state.settings);
  if (!company.legalName.trim()) missing.push("Company legal / display name");
  if (!company.address.trim()) missing.push("Company registered address (Settings → Organization)");
  if (!person.firstName.trim() && !person.lastName.trim()) missing.push("Employee name");
  if (!person.employeeCode.trim()) missing.push("Employee ID");
  if (!person.jobTitle.trim()) missing.push("Designation");
  if (!state.departments.some((item) => item.id === person.departmentId)) missing.push("Department");
  if (!state.locations.some((item) => item.id === person.locationId)) missing.push("Work location");
  if (!run.periodStart || !run.periodEnd) missing.push("Pay period");
  const normalized = normalizeLine(line, state.settings);
  if (normalized.monthlyGross == null || Number.isNaN(normalized.monthlyGross)) missing.push("Monthly gross");
  const money = computePayable(normalized);
  if (normalized.grossEarnings != null && Math.abs((normalized.grossEarnings ?? 0) - money.grossEarnings) > 0.01) {
    missing.push("Gross earnings does not match the payroll calculation");
  }
  if (normalized.totalDeductions != null && Math.abs((normalized.totalDeductions ?? 0) - money.totalDeductions) > 0.01) {
    missing.push("Total deductions does not match the payroll calculation");
  }
  if (Math.abs(normalized.payable - money.payable) > 0.01) {
    missing.push("Net payable does not match gross earnings minus deductions");
  }
  if (run.status !== "finalized" && run.status !== "paid") {
    /* preview allowed; official publish blocked separately */
  }
  return { ok: missing.length === 0, missing };
}

export function buildPayslipDto(
  state: AppState,
  run: PayrollRun,
  employeeId: string,
  options?: { slip?: Payslip | null; official?: boolean; requireValid?: boolean },
): { ok: true; dto: PayslipDto; person: Employee; line: PayrollLine; validation: PayslipValidation } | { ok: false; message: string; missing?: string[] } {
  const person = state.employees.find((item) => item.id === employeeId);
  if (!person) return { ok: false, message: "That employee was not found." };
  const raw = run.lines.find((item) => item.employeeId === employeeId);
  if (!raw) return { ok: false, message: "That employee is not on this payroll run." };
  const line = normalizeLine(raw, state.settings);
  const validation = validatePayslipData(state, run, person, line);
  const components = componentsFromLine(state, line);
  const company = companyBlock(state.settings);
  const official = Boolean(options?.official) && (run.status === "finalized" || run.status === "paid");
  const earningLabels = components.earnings.map((item) => item.label).join(" + ") || "Earnings";
  const deductionLabels = components.deductions.map((item) => item.label).join(" + ") || "Deductions";
  const dto: PayslipDto = {
    slipId: options?.slip?.id ?? null,
    runId: run.id,
    employeeId,
    periodStart: run.periodStart,
    periodEnd: run.periodEnd,
    periodTitle: periodTitle(run.periodStart),
    company,
    employee: employeeBlock(state, person),
    paidDays: line.paidDays ?? 0,
    lopDays: line.lopDays ?? line.unpaidLeaveDays,
    earnings: components.earnings,
    deductions: components.deductions,
    grossEarnings: components.grossEarnings,
    totalDeductions: components.totalDeductions,
    netPayable: components.netPayable,
    netPayableWords: amountInWordsInr(components.netPayable),
    calculationSummary: `${earningLabels} − ${deductionLabels} = Net payable`,
    notes: company.notes,
    runStatus: run.status,
    official,
    watermark: official ? null : "INTERNAL PREVIEW — NOT AN OFFICIAL PAYSLIP",
    templateVersion: state.settings.payslipTemplateVersion?.trim() || PAYSLIP_TEMPLATE_VERSION,
    version: options?.slip?.version ?? 0,
    filename: payslipFilename(person.employeeCode, run.periodStart),
  };
  if (options?.official && options?.requireValid !== false && !validation.ok) {
    return { ok: false, message: `Cannot generate an official payslip. Fix: ${validation.missing.join("; ")}.`, missing: validation.missing };
  }
  return { ok: true, dto, person, line, validation };
}

export function snapshotPayslipRecord(
  run: PayrollRun,
  line: PayrollLine,
  at: string,
  state: AppState,
  existing?: Payslip | null,
): Payslip {
  const normalized = normalizeLine(line, state.settings);
  const components = componentsFromLine(state, normalized);
  const person = state.employees.find((item) => item.id === line.employeeId);
  return {
    id: existing?.id || `slip_${run.id}_${line.employeeId}`,
    runId: run.id,
    employeeId: line.employeeId,
    periodStart: run.periodStart,
    periodEnd: run.periodEnd,
    monthlyGross: normalized.monthlyGross,
    adjustment: normalized.adjustment,
    adjustmentReason: normalized.adjustmentReason,
    reimbursement: normalized.reimbursement,
    payable: components.netPayable,
    presentDays: normalized.presentDays,
    leaveDays: normalized.leaveDays,
    unpaidLeaveDays: normalized.unpaidLeaveDays,
    absentDays: normalized.absentDays,
    generatedAt: existing?.generatedAt ?? at,
    published: existing?.published ?? false,
    publishedAt: existing?.publishedAt ?? null,
    publishedBy: existing?.publishedBy ?? null,
    generatedBy: existing?.generatedBy ?? null,
    overtime: normalized.overtime,
    extras: normalized.extras,
    arrears: normalized.arrears,
    pf: normalized.pf,
    esic: normalized.esic,
    penalties: normalized.penalties,
    loan: normalized.loan,
    otherDeductions: normalized.otherDeductions,
    totalDeductions: components.totalDeductions,
    grossEarnings: components.grossEarnings,
    paidDays: normalized.paidDays,
    lopDays: normalized.lopDays,
    status: existing?.status ?? "ready",
    version: existing?.version ?? 0,
    templateVersion: state.settings.payslipTemplateVersion?.trim() || PAYSLIP_TEMPLATE_VERSION,
    documentKey: existing?.documentKey ?? null,
    earningComponents: components.earnings,
    deductionComponents: components.deductions,
    companySnapshot: companyBlock(state.settings),
    employeeSnapshot: person ? employeeBlock(state, person) : undefined,
    notes: state.settings.payslipNotes?.trim() || "",
  };
}

export function canAccessPayslip(_state: AppState, viewerId: string, slip: Payslip, manage: boolean): boolean {
  if (manage) return true;
  return slip.employeeId === viewerId && slip.published === true && slip.status !== "superseded";
}

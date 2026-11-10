import { computePayable, normalizeLine } from "../domain/payroll";
import type { Employee, PayrollLine, PayrollValueSource } from "../types";
import { downloadCsv } from "./download";
import { fullName } from "./format";

/** Stable column keys for Excel-compatible CSV import/export. */
export const PAYROLL_COLUMNS = [
  { key: "employeeCode", label: "Employee ID", required: true },
  { key: "name", label: "Name", required: false },
  { key: "monthlyGross", label: "Monthly salary", required: false },
  { key: "fullDays", label: "Full days", required: false },
  { key: "halfDays", label: "Half days", required: false },
  { key: "weeklyOffs", label: "Weekly offs", required: false },
  { key: "paidLeaveDays", label: "Paid leaves", required: false },
  { key: "paidDays", label: "Paid days", required: false },
  { key: "absentDays", label: "Absent days", required: false },
  { key: "lopDays", label: "LOP", required: false },
  { key: "overtime", label: "Overtime", required: false },
  { key: "extras", label: "Extras", required: false },
  { key: "arrears", label: "Arrears", required: false },
  { key: "reimbursement", label: "Reimbursements", required: false },
  { key: "adjustment", label: "Adjustment", required: false },
  { key: "adjustmentReason", label: "Adjustment reason", required: false },
  { key: "pf", label: "PF", required: false },
  { key: "esic", label: "ESIC", required: false },
  { key: "penalties", label: "Penalties", required: false },
  { key: "loan", label: "Loan/advance", required: false },
  { key: "otherDeductions", label: "Other deductions", required: false },
  { key: "bankAccountNumber", label: "Bank account", required: false },
] as const;

export type PayrollColumnKey = (typeof PAYROLL_COLUMNS)[number]["key"];

export interface ImportIssue {
  row: number;
  level: "error" | "warning";
  message: string;
}

export interface ParsedImport {
  headers: string[];
  rows: string[][];
}

export function parseDelimited(text: string): ParsedImport {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const rows = lines.map(splitCsvLine);
  return { headers: rows[0].map((item) => item.trim()), rows: rows.slice(1) };
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

export function suggestMapping(headers: string[]): Partial<Record<PayrollColumnKey, string>> {
  const mapping: Partial<Record<PayrollColumnKey, string>> = {};
  const normalized = headers.map((header) => ({ raw: header, key: header.toLowerCase().replace(/[^a-z0-9]+/g, "") }));
  const aliases: Record<PayrollColumnKey, string[]> = {
    employeeCode: ["employeeid", "empid", "employee code", "code", "employeecode", "id"],
    name: ["name", "employeename", "fullname"],
    monthlyGross: ["monthlysalary", "salary", "gross", "monthlygross", "basicsalary"],
    fullDays: ["fulldays", "present", "presentdays"],
    halfDays: ["halfdays", "halfday"],
    weeklyOffs: ["weeklyoffs", "weekoff", "wo"],
    paidLeaveDays: ["paidleaves", "paidleave", "pl"],
    paidDays: ["paiddays", "payabledays"],
    absentDays: ["absentdays", "absent"],
    lopDays: ["lop", "lossofpay", "unpaid"],
    overtime: ["overtime", "ot"],
    extras: ["extras", "allowance", "incentive"],
    arrears: ["arrears"],
    reimbursement: ["reimbursements", "expenses", "reimbursement"],
    adjustment: ["adjustment", "manualadjustment"],
    adjustmentReason: ["adjustmentreason", "reason"],
    pf: ["pf", "providentfund"],
    esic: ["esic", "esi"],
    penalties: ["penalties", "penalty"],
    loan: ["loan", "advance", "loanadvance"],
    otherDeductions: ["otherdeductions", "deductions"],
    bankAccountNumber: ["bankaccount", "accountnumber", "bankac"],
  };
  for (const column of PAYROLL_COLUMNS) {
    const match = normalized.find((header) => aliases[column.key].some((alias) => header.key === alias.replace(/\s+/g, "") || header.raw.toLowerCase() === alias));
    if (match) mapping[column.key] = match.raw;
  }
  return mapping;
}

export function previewImport(
  parsed: ParsedImport,
  mapping: Partial<Record<PayrollColumnKey, string>>,
  employees: Employee[],
  existing: PayrollLine[],
): { lines: PayrollLine[]; issues: ImportIssue[]; applied: number } {
  const issues: ImportIssue[] = [];
  const byCode = new Map(employees.map((item) => [item.employeeCode.toLowerCase(), item]));
  const seen = new Set<string>();
  const next = existing.map((line) => ({ ...line }));
  let applied = 0;

  if (!mapping.employeeCode) {
    issues.push({ row: 0, level: "error", message: "Map a column to Employee ID before importing." });
    return { lines: next, issues, applied };
  }

  parsed.rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const valueOf = (key: PayrollColumnKey) => {
      const header = mapping[key];
      if (!header) return "";
      const col = parsed.headers.indexOf(header);
      return col >= 0 ? (row[col] ?? "").trim() : "";
    };
    const code = valueOf("employeeCode");
    if (!code) {
      issues.push({ row: rowNumber, level: "error", message: "Employee ID is missing." });
      return;
    }
    const employee = byCode.get(code.toLowerCase());
    if (!employee) {
      issues.push({ row: rowNumber, level: "error", message: `No employee matches ID ${code}.` });
      return;
    }
    if (seen.has(employee.id)) {
      issues.push({ row: rowNumber, level: "error", message: `Duplicate row for ${code}.` });
      return;
    }
    seen.add(employee.id);
    const lineIndex = next.findIndex((item) => item.employeeId === employee.id);
    if (lineIndex < 0) {
      issues.push({ row: rowNumber, level: "warning", message: `${code} is not in this payroll run and was skipped.` });
      return;
    }
    const current = { ...next[lineIndex] };
    const numericKeys: PayrollColumnKey[] = [
      "monthlyGross", "fullDays", "halfDays", "weeklyOffs", "paidLeaveDays", "paidDays", "absentDays", "lopDays",
      "overtime", "extras", "arrears", "reimbursement", "adjustment", "pf", "esic", "penalties", "loan", "otherDeductions",
    ];
    const sources: NonNullable<PayrollLine["sources"]> = { ...current.sources };
    for (const key of numericKeys) {
      const raw = valueOf(key);
      if (!raw) continue;
      const amount = Number(raw.replace(/,/g, ""));
      if (Number.isNaN(amount)) {
        issues.push({ row: rowNumber, level: "error", message: `${key} must be a number (got “${raw}”).` });
        continue;
      }
      (current as Record<string, unknown>)[key] = amount;
      sources[key] = "imported";
    }
    const reason = valueOf("adjustmentReason");
    if (reason) current.adjustmentReason = reason;
    if ((current.adjustment ?? 0) !== 0 && !current.adjustmentReason.trim()) {
      issues.push({ row: rowNumber, level: "error", message: "Adjustment reason is required when adjustment is not zero." });
      return;
    }
    current.sources = sources;
    const money = computePayable(current);
    current.grossEarnings = money.grossEarnings;
    current.totalDeductions = money.totalDeductions;
    current.payable = money.payable;
    current.needsRecalc = true;
    next[lineIndex] = current;
    applied += 1;
  });

  return { lines: next.map((line) => normalizeLine(line)), issues, applied };
}

export function exportPayrollRegister(
  filename: string,
  lines: PayrollLine[],
  employees: Employee[],
  options: { includeBank: boolean; includeSalary: boolean; periodLabel: string },
): void {
  const header = [
    "Employee ID", "Name", "Department", "Designation", "Joining date",
    ...(options.includeBank ? ["Bank account (masked)"] : []),
    "Full days", "Half days", "Weekly offs", "Paid leaves", "Paid days", "Absent days", "LOP",
    ...(options.includeSalary ? ["Monthly salary", "Daily wage", "Gross earnings", "Overtime", "Extras", "Arrears", "Reimbursements", "Adjustment"] : []),
    ...(options.includeSalary ? ["PF", "ESIC", "Penalties", "Loan/advance", "Other deductions", "Total deductions", "Net payable"] : []),
    "Exceptions",
    "Period",
  ];
  const rows: (string | number)[][] = [header];
  for (const raw of lines) {
    const line = normalizeLine(raw);
    const person = employees.find((item) => item.id === line.employeeId);
    if (!person) continue;
    const bank = person.bankAccountNumber ? `••••${person.bankAccountNumber.replace(/\s+/g, "").slice(-4)}` : "";
    rows.push([
      person.employeeCode,
      fullName(person),
      person.departmentId,
      person.jobTitle,
      person.joiningDate,
      ...(options.includeBank ? [bank] : []),
      line.fullDays ?? "",
      line.halfDays ?? "",
      line.weeklyOffs ?? "",
      line.paidLeaveDays ?? "",
      line.paidDays ?? "",
      line.absentDays,
      line.lopDays ?? line.unpaidLeaveDays,
      ...(options.includeSalary ? [
        line.monthlyGross,
        line.dailyWage ?? "Not configured",
        line.grossEarnings ?? line.payable,
        line.overtime ?? 0,
        line.extras ?? 0,
        line.arrears ?? 0,
        line.reimbursement,
        line.adjustment,
        line.pf ?? 0,
        line.esic ?? 0,
        line.penalties ?? 0,
        line.loan ?? 0,
        line.otherDeductions ?? 0,
        line.totalDeductions ?? 0,
        line.payable,
      ] : []),
      line.exceptions.join(" | "),
      options.periodLabel,
    ]);
  }
  downloadCsv(filename, rows);
}

export function issuesToCsv(issues: ImportIssue[]): string {
  return ["Row,Level,Message", ...issues.map((item) => `${item.row},${item.level},"${item.message.replaceAll('"', '""')}"`)].join("\n");
}

export function markSource(value: number, source: PayrollValueSource): { value: number; source: PayrollValueSource } {
  return { value, source };
}

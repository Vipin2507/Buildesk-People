import { hasPermission, canManageHrMeeting, canManageTicket, canSeeCompensation, canSeeDocument, canSeeSensitiveContact } from "../src/lib/access.ts";
import { defaultAutomationConfig } from "../src/data/automationDefaults.ts";
import { normalizeAutomationConfig } from "../src/domain/automation.ts";
import { normalizeMicrosoft365 } from "../src/domain/hr-meeting.ts";
import { policyApplies } from "../src/domain/policies.ts";
import { sessionEmployee } from "../src/lib/session.ts";
import type { AppState, Employee, PayrollRun, Ticket } from "../src/types.ts";

function redactHrMeetingTicket(ticket: Ticket, viewer: Employee, canHr: boolean): Ticket {
  if (ticket.kind !== "hr_meeting" || !ticket.meeting) return ticket;
  if (ticket.employeeId === viewer.id || canHr) return ticket;
  return {
    ...ticket,
    description: "Sensitive HR meeting details are restricted.",
    attachmentName: "",
    meeting: {
      ...ticket.meeting,
      contactNote: "",
      hrResponse: ticket.meeting.hrResponse ? "Response on file (restricted)." : "",
    },
    history: ticket.history.map((item) => ({
      ...item,
      comment: /approved|rescheduled|rejected|cancelled|opened|sync/i.test(item.action)
        ? item.comment
        : "Update on file (restricted).",
    })),
  };
}

function redactPayrollRun(run: PayrollRun): PayrollRun {
  const review = run.lines.filter((line) => line.exceptions.some((item) => !/monthly gross/i.test(item))).length;
  return {
    ...run,
    lines: [],
    warnings: review > 0
      ? [`${review} employees have attendance, leave, or expense items to review. Amounts are not shown.`]
      : ["Payroll amounts are not shown for this role."],
  };
}

function directReport(state: AppState, viewer: Employee, employeeId: string): boolean {
  return state.employees.some((item) => item.id === employeeId && item.managerId === viewer.id);
}

function redactEmployee(state: AppState, viewer: Employee, employee: Employee): Employee {
  const self = viewer.id === employee.id;
  const sensitive = canSeeSensitiveContact(state, viewer, employee);
  const compensation = canSeeCompensation(state, viewer) || (self && hasPermission(state, viewer, "payroll.self"));
  const birthday = self || employee.showBirthday || hasPermission(state, viewer, "people.sensitive");
  return {
    ...employee,
    phone: sensitive ? employee.phone : "",
    personalEmail: sensitive ? employee.personalEmail : "",
    address: sensitive ? employee.address : "",
    emergencyName: sensitive ? employee.emergencyName : "",
    emergencyRelationship: sensitive ? employee.emergencyRelationship : "",
    emergencyPhone: sensitive ? employee.emergencyPhone : "",
    emergencySecondaryName: sensitive ? employee.emergencySecondaryName : "",
    emergencySecondaryRelationship: sensitive ? employee.emergencySecondaryRelationship : "",
    emergencySecondaryPhone: sensitive ? employee.emergencySecondaryPhone : "",
    dateOfBirth: birthday ? employee.dateOfBirth : "",
    monthlyGross: compensation ? employee.monthlyGross : 0,
  };
}

/** The workspace as this session is allowed to see it. Writes still use the full record. */
export function presentWorkspace(source: AppState, accountId: string): AppState {
  const state = { ...source, currentUserId: accountId };
  const viewer = sessionEmployee(state);
  if (!viewer) return { ...state, accounts: [] };
  const self = viewer.id;
  const directory = hasPermission(state, viewer, "directory.view");
  const employees = state.employees
    .filter((item) => directory || item.id === self)
    .map((item) => redactEmployee(state, viewer, item));
  const seeAttendance = (employeeId: string) =>
    employeeId === self || hasPermission(state, viewer, "attendance.company") || (hasPermission(state, viewer, "attendance.team") && directReport(state, viewer, employeeId));
  const seeLeave = (employeeId: string) =>
    employeeId === self || hasPermission(state, viewer, "leave.manage") || (hasPermission(state, viewer, "leave.team") && directReport(state, viewer, employeeId));
  const seeExpense = (employeeId: string) => {
    if (employeeId === self) return true;
    if (!hasPermission(state, viewer, "expenses.review") && !hasPermission(state, viewer, "expenses.pay")) return false;
    if (viewer.role === "admin" || viewer.role === "hr" || viewer.role === "payroll") return true;
    return directReport(state, viewer, employeeId);
  };
  const visibleAccounts = hasPermission(state, viewer, "users.manage")
    ? state.accounts
    : state.accounts.filter((item) => item.id === accountId);
  const accounts = visibleAccounts.map((item) => ({ ...item, passwordHash: null }));
  const ids = new Set([accountId, self]);
  return {
    ...state,
    accounts,
    employees,
    attendance: state.attendance.filter((item) => seeAttendance(item.employeeId)),
    regularizations: state.regularizations.filter((item) => seeAttendance(item.employeeId)),
    leaveRequests: state.leaveRequests.filter((item) => seeLeave(item.employeeId)),
    compOff: state.compOff.filter((item) => seeLeave(item.employeeId)),
    expenses: state.expenses.filter((item) => seeExpense(item.employeeId)),
    insurance: state.insurance.filter((item) => item.employeeId === self || hasPermission(state, viewer, "insurance.manage")),
    tickets: state.tickets
      .filter((item) => item.employeeId === self || canManageTicket(state, viewer, item))
      .map((item) => redactHrMeetingTicket(item, viewer, canManageHrMeeting(state, viewer))),
    microsoft365: normalizeMicrosoft365(state.microsoft365),
    assets: state.assets.filter((item) => hasPermission(state, viewer, "assets.manage") || item.assignedTo === self),
    documents: state.documents.filter((item) => canSeeDocument(state, viewer, item)),
    policies: hasPermission(state, viewer, "policies.manage")
      ? state.policies
      : state.policies.filter((item) => item.status !== "draft" && policyApplies(item, viewer)),
    acknowledgements: hasPermission(state, viewer, "policies.manage")
      ? state.acknowledgements
      : state.acknowledgements.filter((item) => item.employeeId === self),
    payrollRuns: hasPermission(state, viewer, "payroll.manage")
      ? state.payrollRuns
      : hasPermission(state, viewer, "settings.org")
        ? state.payrollRuns.map(redactPayrollRun)
        : [],
    payslips: state.payslips.filter((item) => {
      if (hasPermission(state, viewer, "payroll.manage")) return item.status !== "superseded";
      return item.employeeId === self
        && item.published === true
        && item.status !== "superseded"
        && hasPermission(state, viewer, "payroll.self");
    }),
    notifications: state.notifications.filter((item) => ids.has(item.userId)),
    audits: hasPermission(state, viewer, "audit.view")
      ? state.audits.filter((item) => {
          if (item.scope === "payroll" && !hasPermission(state, viewer, "reports.payroll") && !hasPermission(state, viewer, "payroll.manage")) return false;
          if (item.scope === "insurance" && !hasPermission(state, viewer, "insurance.manage") && item.actorId !== self && item.actorId !== accountId) return false;
          return true;
        })
      : [],
    automation: hasPermission(state, viewer, "automation.manage")
      ? normalizeAutomationConfig(state.automation)
      : { ...defaultAutomationConfig(), settings: { ...defaultAutomationConfig().settings, automationsEnabled: false }, waha: { ...defaultAutomationConfig().waha, apiKey: "" }, rules: [], logs: [] },
  };
}

import { canReview, hasPermission } from "../lib/access";
import { formatMoney, fullName, labelFor, rangeLabel } from "../lib/format";
import { recordOn } from "./attendance";
import { addDays, todayIso, weekday } from "./dates";
import { holidayMatchesDate } from "./holidays";
import { holidaysFor, isNonWorking, leaveSummaries } from "./leave";
import { currentPeriod, runTotals } from "./payroll";
import { policyApplies, publishedVersion } from "./policies";
import type { AppState, Employee, PayrollRun, Role } from "../types";

export type OverviewKind = "employee" | "manager" | "hr" | "payroll" | "admin";

export function overviewKind(role: Role): OverviewKind {
  if (role === "manager" || role === "hr" || role === "payroll" || role === "admin") return role;
  return "employee";
}

export function previousWorkingDay(state: AppState, locationId: string, from = todayIso()): string {
  let cursor = addDays(from, -1);
  for (let i = 0; i < 14; i += 1) {
    if (!isNonWorking(cursor, locationId, state.settings, state.holidays)) return cursor;
    cursor = addDays(cursor, -1);
  }
  return addDays(from, -1);
}

export interface DayContext {
  today: string;
  focus: string;
  closed: "weekend" | "holiday" | null;
  holidayName: string | null;
  locationName: string;
}

export function dayContext(state: AppState, user: Employee): DayContext {
  const today = todayIso();
  const weekend = state.settings.weeklyOff.includes(weekday(today));
  const holidays = holidaysFor(today, user.locationId, state.holidays);
  const closed = weekend ? "weekend" : holidays.length > 0 ? "holiday" : null;
  const location = state.locations.find((item) => item.id === user.locationId);
  return {
    today,
    focus: closed ? previousWorkingDay(state, user.locationId, today) : today,
    closed,
    holidayName: holidays[0]?.name ?? null,
    locationName: location?.name ?? "Work location not set",
  };
}

export interface AttentionItem {
  id: string;
  title: string;
  count: number;
  priority: "high" | "normal";
  status: string;
  action: string;
  href: string;
}

export function attentionItems(state: AppState, user: Employee): AttentionItem[] {
  const items: AttentionItem[] = [];
  const fixes = state.regularizations.filter((item) => item.status === "pending" && canReview(state, user, item.employeeId, "attendance"));
  if (fixes.length > 0) {
    items.push({
      id: "fixes",
      title: "Attendance corrections",
      count: fixes.length,
      priority: "high",
      status: "Awaiting review",
      action: "Review corrections",
      href: "/attendance?tab=corrections",
    });
  }
  const leave = state.leaveRequests.filter((item) => item.status === "pending" && canReview(state, user, item.employeeId, "leave"));
  if (leave.length > 0) {
    items.push({
      id: "leave",
      title: "Leave requests",
      count: leave.length,
      priority: "normal",
      status: "Awaiting approval",
      action: "Review leave",
      href: "/leave?tab=approvals",
    });
  }
  const expenses = state.expenses.filter((item) => item.status === "pending" && canReview(state, user, item.employeeId, "expense"));
  if (expenses.length > 0) {
    items.push({
      id: "expenses",
      title: "Expense claims",
      count: expenses.length,
      priority: "normal",
      status: "Awaiting approval",
      action: "Review expenses",
      href: "/expenses?tab=approvals",
    });
  }
  const own = ownPending(state, user);
  if (own.total > 0) {
    items.push({
      id: "mine",
      title: "Your requests",
      count: own.total,
      priority: "normal",
      status: "Awaiting a decision",
      action: "Open requests",
      href: own.href,
    });
  }
  if (hasPermission(state, user, "payroll.manage")) {
    const openRuns = state.payrollRuns.filter((item) => item.status === "draft" || item.status === "in_review");
    if (openRuns.length > 0) {
      const run = openRuns.sort((a, b) => b.periodStart.localeCompare(a.periodStart))[0];
      items.push({
        id: "payroll",
        title: "Payroll run",
        count: openRuns.length,
        priority: "high",
        status: labelFor(run.status),
        action: "Open payroll",
        href: `/payroll/${run.id}`,
      });
    }
  }
  const tickets = state.tickets.filter((item) => item.assigneeId === user.id && item.status !== "resolved");
  if (tickets.length > 0) {
    const urgent = tickets.some((item) => item.priority === "urgent" || item.priority === "high");
    items.push({
      id: "tickets",
      title: "Tickets assigned to you",
      count: tickets.length,
      priority: urgent ? "high" : "normal",
      status: urgent ? "High priority" : "Open",
      action: "Open tickets",
      href: "/tickets",
    });
  }
  const policies = pendingPolicies(state, user);
  if (policies > 0 && hasPermission(state, user, "policies.view")) {
    items.push({
      id: "policies",
      title: "Policies to acknowledge",
      count: policies,
      priority: "normal",
      status: "Awaiting you",
      action: "Review policies",
      href: "/policies",
    });
  }
  return items;
}

function ownPending(state: AppState, user: Employee): { total: number; href: string } {
  const leave = state.leaveRequests.filter((item) => item.employeeId === user.id && item.status === "pending").length;
  const fixes = state.regularizations.filter((item) => item.employeeId === user.id && item.status === "pending").length;
  const expenses = state.expenses.filter((item) => item.employeeId === user.id && item.status === "pending").length;
  const ranked = [
    { count: leave, href: "/leave?tab=mine" },
    { count: fixes, href: "/attendance?tab=corrections" },
    { count: expenses, href: "/expenses?tab=mine" },
  ].sort((a, b) => b.count - a.count);
  return { total: leave + fixes + expenses, href: ranked[0]?.href ?? "/leave?tab=mine" };
}

export function pendingPolicies(state: AppState, user: Employee): number {
  return state.policies.filter((policy) => {
    if (policy.status !== "published" || !policyApplies(policy, user)) return false;
    const version = publishedVersion(policy);
    if (!version) return false;
    return !state.acknowledgements.some((item) => item.policyId === policy.id && item.employeeId === user.id && item.version === version.version);
  }).length;
}

export interface PresenceCounts {
  headcount: number;
  present: number;
  remote: number;
  onLeave: number;
  absent: number;
  exceptions: number;
}

export function presenceCounts(state: AppState, people: Employee[], punchDate: string, leaveDate: string): PresenceCounts {
  let present = 0;
  let remote = 0;
  let absent = 0;
  let exceptions = 0;
  people.forEach((person) => {
    const record = recordOn(state, person.id, punchDate);
    const status = record?.status;
    if (status === "present" || status === "late") present += 1;
    if (record?.workMode === "remote") remote += 1;
    const off = isNonWorking(punchDate, person.locationId, state.settings, state.holidays);
    const isAbsent = status === "absent" || (!record && !off);
    if (isAbsent) absent += 1;
    if (status === "late" || status === "incomplete" || isAbsent) exceptions += 1;
  });
  const onLeave = people.filter((person) => state.leaveRequests.some((item) => item.employeeId === person.id && item.status === "approved" && item.startDate <= leaveDate && item.endDate >= leaveDate)).length;
  return { headcount: people.length, present, remote, onLeave, absent, exceptions };
}

export function scopedPeople(state: AppState, user: Employee, scope: "company" | "team", departmentId: string, locationId: string): Employee[] {
  return state.employees.filter((person) => {
    if (person.status === "inactive") return false;
    if (scope === "team" && person.managerId !== user.id) return false;
    if (departmentId !== "all" && person.departmentId !== departmentId) return false;
    if (locationId !== "all" && person.locationId !== locationId) return false;
    return true;
  });
}

export function attendanceHref(tab: "team" | "company", date: string, departmentId: string, locationId: string, teamOnly: boolean): string {
  const params = new URLSearchParams({ tab, date });
  if (departmentId !== "all") params.set("department", departmentId);
  if (locationId !== "all") params.set("location", locationId);
  if (teamOnly && tab === "company") params.set("team", "1");
  return `/attendance?${params.toString()}`;
}

export interface QueueItem {
  id: string;
  kind: "leave" | "attendance" | "expense";
  employeeId: string;
  submittedAt: string;
  summary: string;
  href: string;
  canDecide: boolean;
  requestedIn?: string;
  requestedOut?: string;
}

export function approvalQueue(state: AppState, user: Employee): QueueItem[] {
  const items: QueueItem[] = [];
  state.leaveRequests.filter((item) => item.status === "pending" && (item.employeeId === user.id || canReview(state, user, item.employeeId, "leave"))).forEach((item) => {
    const type = state.settings.leaveTypes.find((entry) => entry.id === item.typeId)?.name ?? "Leave";
    items.push({
      id: item.id,
      kind: "leave",
      employeeId: item.employeeId,
      submittedAt: item.submittedAt,
      summary: `${type} · ${rangeLabel(item.startDate, item.endDate)}`,
      href: item.employeeId === user.id ? "/leave?tab=mine" : "/leave?tab=approvals",
      canDecide: canReview(state, user, item.employeeId, "leave"),
    });
  });
  state.regularizations.filter((item) => item.status === "pending" && (item.employeeId === user.id || canReview(state, user, item.employeeId, "attendance"))).forEach((item) => {
    items.push({
      id: item.id,
      kind: "attendance",
      employeeId: item.employeeId,
      submittedAt: item.submittedAt,
      summary: `Correction · ${rangeLabel(item.date, item.date)} · ${item.requestedIn}–${item.requestedOut}`,
      href: "/attendance?tab=corrections",
      canDecide: canReview(state, user, item.employeeId, "attendance"),
      requestedIn: item.requestedIn,
      requestedOut: item.requestedOut,
    });
  });
  state.expenses.filter((item) => item.status === "pending" && (item.employeeId === user.id || canReview(state, user, item.employeeId, "expense"))).forEach((item) => {
    const amount = ` · ${formatMoney(item.amount, state.settings.currency)}`;
    items.push({
      id: item.id,
      kind: "expense",
      employeeId: item.employeeId,
      submittedAt: item.submittedAt,
      summary: `${item.category}${amount} · ${rangeLabel(item.date, item.date)}`,
      href: item.employeeId === user.id ? "/expenses?tab=mine" : "/expenses?tab=approvals",
      canDecide: canReview(state, user, item.employeeId, "expense"),
    });
  });
  return items.sort((a, b) => Number(b.canDecide) - Number(a.canDecide) || b.submittedAt.localeCompare(a.submittedAt));
}

export interface PayrollBrief {
  periodLabel: string;
  run: PayrollRun | null;
  latest: PayrollRun | null;
  status: string | null;
  step: string;
  href: string;
  showMoney: boolean;
  payable: number | null;
  exceptions: number | null;
  employees: number | null;
}

export function payrollBrief(state: AppState, user: Employee): PayrollBrief | null {
  const manage = hasPermission(state, user, "payroll.manage");
  const oversee = manage || hasPermission(state, user, "settings.org");
  if (!oversee) return null;
  const period = currentPeriod(state.settings);
  const periodLabel = rangeLabel(period.start, period.end);
  const match = state.payrollRuns.find((item) => item.periodStart === period.start && item.periodEnd === period.end) ?? null;
  const latest = [...state.payrollRuns].sort((a, b) => b.periodStart.localeCompare(a.periodStart))[0] ?? null;
  const run = match ?? latest;
  const money = manage && run && run.lines.length > 0 ? runTotals(run) : null;
  return {
    periodLabel,
    run,
    latest: match ? null : latest,
    status: run ? run.status : null,
    step: payrollStep(run, manage),
    href: manage && run ? `/payroll/${run.id}` : manage ? "/payroll" : "/payroll",
    showMoney: Boolean(money),
    payable: money ? money.payable : null,
    exceptions: money ? money.exceptions : null,
    employees: money ? money.employees : null,
  };
}

function payrollStep(run: PayrollRun | null, manage: boolean): string {
  if (!run) return manage ? "No run exists for the current period. Create a draft when inputs are ready." : "No run exists for the current period. A payroll administrator creates it.";
  if (run.status === "draft") return manage ? "Next step: review inputs, then send the run for review." : "The run is still a draft. Amounts stay with payroll administrators.";
  if (run.status === "in_review") return manage ? "Next step: confirm the inputs, then finalize. Finalizing asks for confirmation." : "The run is in review. Finalizing is limited to payroll administrators.";
  if (run.status === "finalized") return manage ? "Next step: mark the run paid when disbursement is done." : "The run is finalized. Amounts stay with payroll administrators.";
  return "This run is marked paid.";
}

export interface ActivityItem {
  id: string;
  actor: string;
  action: string;
  at: string;
  href: string | null;
}

export function recentActivity(state: AppState, user: Employee): { source: "audit" | "notifications"; items: ActivityItem[] } {
  if (hasPermission(state, user, "audit.view")) {
    const items = state.audits
      .filter((item) => {
        if (item.scope === "payroll" && !hasPermission(state, user, "payroll.manage") && !hasPermission(state, user, "reports.payroll")) return false;
        if (item.scope === "insurance" && !hasPermission(state, user, "insurance.manage") && item.actorId !== user.id) return false;
        return true;
      })
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 6)
      .map((item) => ({
        id: item.id,
        actor: actorName(state, item.actorId),
        action: item.summary,
        at: item.at,
        href: activityHref(item.area, user, state),
      }));
    return { source: "audit", items };
  }
  const items = state.notifications
    .filter((item) => item.userId === user.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 6)
    .map((item) => ({
      id: item.id,
      actor: "You",
      action: item.title,
      at: item.createdAt,
      href: item.href || null,
    }));
  return { source: "notifications", items };
}

function actorName(state: AppState, id: string): string {
  const employee = state.employees.find((item) => item.id === id);
  if (employee) return fullName(employee);
  return state.accounts.find((item) => item.id === id)?.displayName || "Someone";
}

function activityHref(area: string, user: Employee, state: AppState): string | null {
  if (area === "attendance" && hasPermission(state, user, "attendance.self")) return "/attendance";
  if (area === "leave" && hasPermission(state, user, "leave.self")) return "/leave";
  if (area === "expenses" && hasPermission(state, user, "expenses.self")) return "/expenses";
  if (area === "tickets" && hasPermission(state, user, "tickets.self")) return "/tickets";
  if (area === "assets" && (hasPermission(state, user, "assets.self") || hasPermission(state, user, "assets.manage"))) return "/assets";
  if (area === "policies" && hasPermission(state, user, "policies.view")) return "/policies";
  if (area === "payroll" && (hasPermission(state, user, "payroll.manage") || hasPermission(state, user, "payroll.self"))) return "/payroll";
  if (area === "people" && hasPermission(state, user, "directory.view")) return "/people";
  if (area === "users" && hasPermission(state, user, "users.manage")) return "/users";
  if (area === "settings" && (hasPermission(state, user, "settings.org") || hasPermission(state, user, "settings.roles") || hasPermission(state, user, "audit.view"))) return "/settings";
  if (area === "insurance" && hasPermission(state, user, "insurance.self")) return "/expenses?tab=insurance";
  return null;
}

export interface Shortcut {
  id: string;
  label: string;
  href: string;
}

export function shortcuts(state: AppState, user: Employee): Shortcut[] {
  const kind = overviewKind(user.role);
  const payroll = payrollBrief(state, user);
  const catalog: Record<string, Shortcut & { allow: boolean }> = {
    clock: { id: "clock", label: "Clock in or out", href: "/attendance?tab=mine", allow: hasPermission(state, user, "attendance.self") },
    leave: { id: "leave", label: "Request leave", href: "/leave?tab=mine", allow: hasPermission(state, user, "leave.self") },
    expense: { id: "expense", label: "Submit expense", href: "/expenses?tab=mine", allow: hasPermission(state, user, "expenses.self") },
    ticket: { id: "ticket", label: "New ticket", href: "/tickets?new=1", allow: hasPermission(state, user, "tickets.self") },
    payslip: { id: "payslip", label: "View payslip", href: "/payroll", allow: hasPermission(state, user, "payroll.self") },
    assets: { id: "assets", label: "View my assets", href: "/assets", allow: hasPermission(state, user, "assets.self") },
    reviewLeave: { id: "reviewLeave", label: "Review leave", href: "/leave?tab=approvals", allow: hasPermission(state, user, "leave.approve") },
    reviewFix: { id: "reviewFix", label: "Review attendance corrections", href: "/attendance?tab=corrections", allow: hasPermission(state, user, "attendance.review") },
    teamAttendance: { id: "teamAttendance", label: "View team attendance", href: "/attendance?tab=team", allow: hasPermission(state, user, "attendance.team") },
    addEmployee: { id: "addEmployee", label: "Add employee", href: "/people?add=1", allow: hasPermission(state, user, "people.manage") },
    policies: { id: "policies", label: "Manage policies", href: "/policies", allow: hasPermission(state, user, "policies.manage") },
    org: { id: "org", label: "Organization chart", href: "/people/org", allow: hasPermission(state, user, "directory.view") },
    payrollRun: { id: "payrollRun", label: "Open payroll run", href: payroll?.href ?? "/payroll", allow: hasPermission(state, user, "payroll.manage") },
    payrollInputs: { id: "payrollInputs", label: "Review payroll inputs", href: payroll?.run ? `/payroll/${payroll.run.id}` : "/payroll", allow: hasPermission(state, user, "payroll.manage") },
    payrollHistory: { id: "payrollHistory", label: "View payroll history", href: "/payroll", allow: hasPermission(state, user, "payroll.manage") },
    users: { id: "users", label: "Manage users", href: "/users", allow: hasPermission(state, user, "users.manage") },
    roles: { id: "roles", label: "Roles and permissions", href: "/settings?tab=roles", allow: hasPermission(state, user, "settings.roles") },
    settings: { id: "settings", label: "Organization settings", href: "/settings?tab=org", allow: hasPermission(state, user, "settings.org") },
  };
  const order: Record<OverviewKind, string[]> = {
    employee: ["clock", "leave", "expense", "ticket", "payslip", "assets"],
    manager: ["reviewLeave", "reviewFix", "teamAttendance", "clock", "leave"],
    hr: ["addEmployee", "reviewFix", "policies", "org", "reviewLeave"],
    payroll: ["payrollRun", "payrollInputs", "payrollHistory"],
    admin: ["users", "roles", "settings", "addEmployee", "policies", "payrollRun"],
  };
  const seen = new Set<string>();
  return order[kind].filter((id) => {
    const item = catalog[id];
    if (!item?.allow || seen.has(item.href + item.label)) return false;
    seen.add(item.href + item.label);
    return true;
  }).map((id) => ({ id: catalog[id].id, label: catalog[id].label, href: catalog[id].href }));
}

export interface DayLine {
  id: string;
  title: string;
  detail: string;
  href: string;
}

export interface DayAttendanceBrief {
  title: string;
  href: string;
  scope: "company" | "team" | "self";
  counts?: PresenceCounts;
  status?: string;
  detail: string;
}

/** Compact attendance snapshot for the Overview calendar day panel. */
export function dayAttendanceBrief(state: AppState, user: Employee, date: string): DayAttendanceBrief | null {
  if (hasPermission(state, user, "attendance.company")) {
    const counts = presenceCounts(state, scopedPeople(state, user, "company", "all", "all"), date, date);
    return {
      title: "Workforce attendance",
      href: attendanceHref("company", date, "all", "all", false),
      scope: "company",
      counts,
      detail: `${counts.present} present · ${counts.remote} remote · ${counts.onLeave} on leave · ${counts.absent} absent`,
    };
  }
  if (hasPermission(state, user, "attendance.team")) {
    const counts = presenceCounts(state, scopedPeople(state, user, "team", "all", "all"), date, date);
    return {
      title: "Team attendance",
      href: attendanceHref("team", date, "all", "all", false),
      scope: "team",
      counts,
      detail: `${counts.present} present · ${counts.remote} remote · ${counts.onLeave} on leave · ${counts.absent} absent`,
    };
  }
  if (hasPermission(state, user, "attendance.self")) {
    const record = recordOn(state, user.id, date);
    const where = record?.workMode ? labelFor(record.workMode) : "No work location recorded";
    return {
      title: "Your attendance",
      href: "/attendance?tab=mine",
      scope: "self",
      status: record?.status ?? "incomplete",
      detail: record ? `${labelFor(record.status)} · ${where}` : `No punch · ${where}`,
    };
  }
  return null;
}

export function dayBrief(state: AppState, user: Employee, date: string): DayLine[] {
  const lines: DayLine[] = [];
  const companyWide = hasPermission(state, user, "leave.manage") || user.role === "admin";
  state.holidays.forEach((holiday) => {
    if (!holidayMatchesDate(holiday, date)) return;
    const applies = holiday.locationId === "all" || holiday.locationId === user.locationId;
    if (!applies && !companyWide) return;
    const location = holiday.locationId === "all" ? "All offices" : state.locations.find((item) => item.id === holiday.locationId)?.name ?? "One office";
    lines.push({
      id: holiday.recurrence === "annual" ? `${holiday.id}_${date}` : holiday.id,
      title: holiday.name,
      detail: `Holiday${holiday.recurrence === "annual" ? " · Every year" : ""} · ${location}`,
      href: "/leave?tab=holidays",
    });
  });
  state.events.forEach((event) => {
    const eventEnd = event.endDate && event.endDate >= event.date ? event.endDate : event.date;
    if (date < event.date || date > eventEnd) return;
    const applies = event.locationId === "all" || event.locationId === user.locationId;
    if (!applies && !companyWide) return;
    const location = event.locationId === "all" ? "All offices" : state.locations.find((item) => item.id === event.locationId)?.name ?? "One office";
    lines.push({ id: event.id, title: event.title, detail: `${labelFor(event.kind)} · ${location}`, href: "/leave?tab=holidays" });
  });
  state.employees.forEach((person) => {
    if (person.status === "inactive" || !/^\d{4}-\d{2}-\d{2}$/.test(person.dateOfBirth)) return;
    if (person.dateOfBirth.slice(5) !== date.slice(5)) return;
    const seeHidden = hasPermission(state, user, "people.sensitive");
    if (!person.showBirthday && person.id !== user.id && !seeHidden) return;
    lines.push({
      id: `bday-${person.id}`,
      title: person.id === user.id ? "Your birthday" : `${fullName(person)}'s birthday`,
      detail: "Birthday",
      href: hasPermission(state, user, "directory.view") || person.id === user.id ? `/people/${person.id}` : "/leave?tab=holidays",
    });
  });
  state.leaveRequests.forEach((request) => {
    if (request.status !== "approved" || request.startDate > date || request.endDate < date) return;
    const own = request.employeeId === user.id;
    const team = state.employees.some((item) => item.id === request.employeeId && item.managerId === user.id);
    if (!own && !team && !companyWide) return;
    const person = state.employees.find((item) => item.id === request.employeeId);
    const type = state.settings.leaveTypes.find((item) => item.id === request.typeId)?.name ?? "Leave";
    lines.push({
      id: request.id,
      title: own ? `Your ${type}` : `${person ? fullName(person) : "Teammate"} · ${type}`,
      detail: "Approved leave",
      href: "/leave?tab=calendar",
    });
  });
  const attendance = dayAttendanceBrief(state, user, date);
  if (attendance) {
    lines.push({
      id: `att-${date}`,
      title: attendance.title,
      detail: attendance.detail,
      href: attendance.href,
    });
  }
  return lines;
}

export function leaveAvailable(state: AppState, userId: string): { total: number; hint: string } {
  const rows = leaveSummaries(state, userId).filter((item) => item.available !== null && item.typeId !== "unpaid");
  const total = rows.reduce((sum, item) => sum + (item.available ?? 0), 0);
  const hint = rows.length > 0 ? rows.slice(0, 3).map((item) => `${item.name} ${item.available}`).join(" · ") : "No capped leave types";
  return { total, hint };
}

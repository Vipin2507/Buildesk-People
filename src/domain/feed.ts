import { hasPermission } from "../lib/access";
import { fullName } from "../lib/format";
import { addDays, todayIso } from "./dates";
import { holidayOccurrencesInRange } from "./holidays";
import type { AppState, Employee } from "../types";

export interface FeedItem {
  id: string;
  date: string;
  title: string;
  detail: string;
  kind: "holiday" | "event" | "birthday" | "leave";
  href: string;
}

function nextBirthday(dateOfBirth: string, from: string): string {
  const monthDay = dateOfBirth.slice(5);
  const year = Number(from.slice(0, 4));
  const thisYear = `${year}-${monthDay}`;
  return thisYear < from ? `${year + 1}-${monthDay}` : thisYear;
}

export function upcomingFeed(state: AppState, viewer: Employee, withinDays = 28): FeedItem[] {
  const today = todayIso();
  const end = addDays(today, withinDays);
  const companyWide = hasPermission(state, viewer, "leave.manage") || viewer.role === "admin";
  const items: FeedItem[] = [];

  state.holidays.forEach((holiday) => {
    const applies = holiday.locationId === "all" || holiday.locationId === viewer.locationId;
    if (!applies && !companyWide) return;
    const location = holiday.locationId === "all" ? "All offices" : state.locations.find((item) => item.id === holiday.locationId)?.name ?? "One office";
    holidayOccurrencesInRange(holiday, today, end).forEach((date) => {
      items.push({
        id: holiday.recurrence === "annual" ? `${holiday.id}_${date}` : holiday.id,
        date,
        title: holiday.name,
        detail: location,
        kind: "holiday",
        href: "/leave?tab=holidays",
      });
    });
  });

  state.events.forEach((event) => {
    const eventEnd = event.endDate && event.endDate >= event.date ? event.endDate : event.date;
    if (eventEnd < today || event.date > end) return;
    const applies = event.locationId === "all" || event.locationId === viewer.locationId;
    if (!applies && !companyWide) return;
    const location = event.locationId === "all" ? "All offices" : state.locations.find((item) => item.id === event.locationId)?.name ?? "One office";
    const startInWindow = event.date < today ? today : event.date;
    items.push({
      id: event.id,
      date: startInWindow,
      title: event.title,
      detail: `${event.kind === "festival" ? "Festival" : "Event"} · ${location}`,
      kind: "event",
      href: "/leave?tab=holidays",
    });
  });

  const seeHidden = hasPermission(state, viewer, "people.sensitive");
  state.employees.forEach((person) => {
    if (person.status === "inactive" || !/^\d{4}-\d{2}-\d{2}$/.test(person.dateOfBirth)) return;
    if (!person.showBirthday && person.id !== viewer.id && !seeHidden) return;
    const date = nextBirthday(person.dateOfBirth, today);
    if (date > end) return;
    const hidden = !person.showBirthday && person.id !== viewer.id;
    items.push({
      id: `bday_${person.id}_${date}`,
      date,
      title: person.id === viewer.id ? "Your birthday" : `${fullName(person)}'s birthday`,
      detail: hidden ? "Hidden from the company feed" : person.jobTitle,
      kind: "birthday",
      href: `/people/${person.id}`,
    });
  });

  state.leaveRequests.forEach((request) => {
    if (request.status !== "approved" || request.endDate < today || request.startDate > end) return;
    const own = request.employeeId === viewer.id;
    const team = state.employees.find((item) => item.id === request.employeeId)?.managerId === viewer.id;
    if (!own && !team && !companyWide) return;
    const person = state.employees.find((item) => item.id === request.employeeId);
    const type = state.settings.leaveTypes.find((item) => item.id === request.typeId);
    items.push({
      id: request.id,
      date: request.startDate < today ? today : request.startDate,
      title: own ? `Your ${type?.name ?? "leave"}` : `${person ? fullName(person) : "Teammate"} · ${type?.name ?? "Leave"}`,
      detail: "Approved leave",
      kind: "leave",
      href: "/leave?tab=calendar",
    });
  });

  return items.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}

export function navCounts(state: AppState, user: Employee | null): Record<string, number> {
  if (!user) return {};
  const pendingFixes = state.regularizations.filter((item) => item.status === "pending");
  const myFixes = pendingFixes.filter((item) => item.employeeId === user.id).length;
  const reviewFixes = pendingFixes.filter((item) => item.employeeId !== user.id && canReviewFix(state, user, item.employeeId)).length;
  const pendingLeave = state.leaveRequests.filter((item) => item.status === "pending");
  const myLeave = pendingLeave.filter((item) => item.employeeId === user.id).length;
  const reviewLeave = pendingLeave.filter((item) => canReviewLeave(state, user, item.employeeId)).length;
  const pendingExpenses = state.expenses.filter((item) => item.status === "pending");
  const myExpenses = pendingExpenses.filter((item) => item.employeeId === user.id).length;
  const reviewExpenses = pendingExpenses.filter((item) => canReviewExpense(state, user, item.employeeId)).length;
  const payable = hasPermission(state, user, "expenses.pay")
    ? state.expenses.filter((item) => item.status === "approved").length
    : 0;
  const tickets = state.tickets.filter((item) => item.status !== "resolved");
  const myTickets = tickets.filter((item) => item.employeeId === user.id).length;
  const manageTickets = tickets.filter((item) => item.employeeId !== user.id && canManage(state, user, item.category, item.assigneeId)).length;
  const payroll = hasPermission(state, user, "payroll.manage")
    ? state.payrollRuns.filter((item) => item.status === "draft" || item.status === "in_review").length
    : 0;
  return {
    "/attendance": myFixes + reviewFixes,
    "/leave": myLeave + reviewLeave,
    "/expenses": myExpenses + reviewExpenses + payable,
    "/tickets": myTickets + manageTickets,
    "/payroll": payroll,
  };
}

function canReviewFix(state: AppState, user: Employee, targetId: string): boolean {
  return hasPermission(state, user, "attendance.review") && (user.role === "hr" || user.role === "admin" || state.employees.find((item) => item.id === targetId)?.managerId === user.id);
}

function canReviewLeave(state: AppState, user: Employee, targetId: string): boolean {
  return hasPermission(state, user, "leave.approve") && user.id !== targetId && (user.role === "hr" || user.role === "admin" || state.employees.find((item) => item.id === targetId)?.managerId === user.id);
}

function canReviewExpense(state: AppState, user: Employee, targetId: string): boolean {
  return hasPermission(state, user, "expenses.review") && user.id !== targetId && (user.role === "hr" || user.role === "payroll" || user.role === "admin" || state.employees.find((item) => item.id === targetId)?.managerId === user.id);
}

function canManage(state: AppState, user: Employee, category: string, assigneeId: string | null): boolean {
  if (!hasPermission(state, user, "tickets.manage")) return false;
  if (user.role === "payroll") return category === "Payroll" || assigneeId === user.id;
  return user.role === "hr" || user.role === "admin" || assigneeId === user.id;
}

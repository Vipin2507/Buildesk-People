import { canReview, canSeeBirthday, hasPermission } from "../lib/access";
import { fullName } from "../lib/format";
import { addDays, eachDate, isoDate, parseISODate } from "./dates";
import type { AppState, Employee } from "../types";

export type CalendarItemKind = "holiday" | "festival" | "event" | "birthday" | "leave" | "leave_pending";

export interface CalendarItem {
  id: string;
  date: string;
  endDate?: string;
  title: string;
  detail: string;
  kind: CalendarItemKind;
  href?: string;
  employeeId?: string;
  locationId?: string;
  departmentId?: string;
  /** Never include private leave reasons here. */
  status?: "approved" | "pending";
}

export type CalendarViewMode = "month" | "week" | "agenda";

export interface CalendarFilters {
  kinds: CalendarItemKind[];
  departmentId: string;
  locationId: string;
  status: "all" | "approved" | "pending";
  employeeId: string;
}

export const EMPTY_CALENDAR_FILTERS: CalendarFilters = {
  kinds: [],
  departmentId: "all",
  locationId: "all",
  status: "all",
  employeeId: "all",
};

export const CALENDAR_LEGEND: Array<{ kind: CalendarItemKind; label: string }> = [
  { kind: "leave", label: "Approved leave" },
  { kind: "leave_pending", label: "Pending leave" },
  { kind: "holiday", label: "Company holiday" },
  { kind: "festival", label: "Festival / national holiday" },
  { kind: "event", label: "Company event" },
  { kind: "birthday", label: "Birthday" },
];

function locationLabel(state: AppState, locationId: string): string {
  if (locationId === "all") return "All offices";
  return state.locations.find((item) => item.id === locationId)?.name ?? "One office";
}

function nextBirthdayOnOrAfter(dateOfBirth: string, from: string, through: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) return [];
  const monthDay = dateOfBirth.slice(5);
  const startYear = Number(from.slice(0, 4));
  const endYear = Number(through.slice(0, 4));
  const dates: string[] = [];
  for (let year = startYear; year <= endYear + 1; year += 1) {
    const date = `${year}-${monthDay}`;
    if (date >= from && date <= through) dates.push(date);
  }
  return dates;
}

function canSeePersonLeave(state: AppState, viewer: Employee, employeeId: string, status: "approved" | "pending"): boolean {
  if (employeeId === viewer.id) return true;
  if (status === "pending") return canReview(state, viewer, employeeId, "leave");
  if (hasPermission(state, viewer, "leave.manage") || viewer.role === "admin") return true;
  if (hasPermission(state, viewer, "leave.team")) {
    return state.employees.some((item) => item.id === employeeId && item.managerId === viewer.id);
  }
  return false;
}

/** Build role-filtered calendar items for a date window (inclusive). Dates are local YYYY-MM-DD. */
export function buildCalendarItems(state: AppState, viewer: Employee, rangeStart: string, rangeEnd: string): CalendarItem[] {
  const companyWide = hasPermission(state, viewer, "leave.manage") || viewer.role === "admin";
  const sensitive = hasPermission(state, viewer, "people.sensitive");
  const items: CalendarItem[] = [];

  state.holidays.forEach((holiday) => {
    if (holiday.date < rangeStart || holiday.date > rangeEnd) return;
    const applies = holiday.locationId === "all" || holiday.locationId === viewer.locationId;
    if (!applies && !companyWide) return;
    items.push({
      id: holiday.id,
      date: holiday.date,
      title: holiday.name,
      detail: `Holiday · ${locationLabel(state, holiday.locationId)}`,
      kind: "holiday",
      href: "/leave?tab=holidays",
      locationId: holiday.locationId,
    });
  });

  state.events.forEach((event) => {
    const endDate = event.endDate && event.endDate >= event.date ? event.endDate : event.date;
    if (endDate < rangeStart || event.date > rangeEnd) return;
    const applies = event.locationId === "all" || event.locationId === viewer.locationId;
    if (!applies && !companyWide) return;
    const festival = event.kind === "festival";
    const spanStart = event.date < rangeStart ? rangeStart : event.date;
    const spanEnd = endDate > rangeEnd ? rangeEnd : endDate;
    eachDate(spanStart, spanEnd).forEach((date) => {
      items.push({
        id: `${event.id}_${date}`,
        date,
        endDate: endDate !== event.date ? endDate : undefined,
        title: event.title,
        detail: `${festival ? "Festival" : "Company event"} · All day · ${locationLabel(state, event.locationId)}${event.description ? ` · ${event.description}` : ""}`,
        kind: festival ? "festival" : "event",
        href: "/leave?tab=holidays",
        locationId: event.locationId,
      });
    });
  });

  state.employees.forEach((person) => {
    if (person.status === "inactive") return;
    if (!canSeeBirthday(viewer, person, sensitive)) return;
    nextBirthdayOnOrAfter(person.dateOfBirth, rangeStart, rangeEnd).forEach((date) => {
      items.push({
        id: `bday_${person.id}_${date}`,
        date,
        title: person.id === viewer.id ? "Your birthday" : `${fullName(person)}'s birthday`,
        detail: person.jobTitle || "Birthday",
        kind: "birthday",
        href: hasPermission(state, viewer, "directory.view") || person.id === viewer.id ? `/people/${person.id}` : undefined,
        employeeId: person.id,
        departmentId: person.departmentId,
        locationId: person.locationId,
      });
    });
  });

  state.leaveRequests.forEach((request) => {
    if (request.status !== "approved" && request.status !== "pending") return;
    if (request.endDate < rangeStart || request.startDate > rangeEnd) return;
    if (!canSeePersonLeave(state, viewer, request.employeeId, request.status)) return;
    const person = state.employees.find((item) => item.id === request.employeeId);
    const type = state.settings.leaveTypes.find((item) => item.id === request.typeId)?.name ?? "Leave";
    const own = request.employeeId === viewer.id;
    const title = own ? `Your ${type}` : `${person ? fullName(person) : "Teammate"} · ${type}`;
    const spanStart = request.startDate < rangeStart ? rangeStart : request.startDate;
    const spanEnd = request.endDate > rangeEnd ? rangeEnd : request.endDate;
    eachDate(spanStart, spanEnd).forEach((date) => {
      items.push({
        id: `${request.id}_${date}`,
        date,
        endDate: request.endDate,
        title,
        detail: request.status === "approved" ? "Approved leave" : "Pending leave",
        kind: request.status === "approved" ? "leave" : "leave_pending",
        href: request.status === "pending" && canReview(state, viewer, request.employeeId, "leave")
          ? "/leave?tab=approvals"
          : own
            ? "/leave?tab=mine"
            : "/leave?tab=calendar",
        employeeId: request.employeeId,
        departmentId: person?.departmentId,
        locationId: person?.locationId,
        status: request.status === "pending" ? "pending" : "approved",
      });
    });
  });

  return items.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}

export function filterCalendarItems(items: CalendarItem[], filters: CalendarFilters): CalendarItem[] {
  return items.filter((item) => {
    if (filters.kinds.length > 0 && !filters.kinds.includes(item.kind)) return false;
    if (filters.departmentId !== "all" && item.departmentId && item.departmentId !== filters.departmentId) return false;
    if (filters.locationId !== "all") {
      if (item.locationId && item.locationId !== "all" && item.locationId !== filters.locationId) return false;
    }
    if (filters.employeeId !== "all" && item.employeeId && item.employeeId !== filters.employeeId) return false;
    if (filters.status === "approved" && item.kind === "leave_pending") return false;
    if (filters.status === "pending" && item.kind === "leave") return false;
    return true;
  });
}

export function itemsOnDate(items: CalendarItem[], date: string): CalendarItem[] {
  return items.filter((item) => item.date === date);
}

export function monthCursor(iso: string): string {
  return iso.slice(0, 7);
}

export function addMonthCursor(cursor: string, delta: number): string {
  const date = parseISODate(`${cursor}-01`);
  date.setMonth(date.getMonth() + delta);
  return isoDate(date).slice(0, 7);
}

export function monthRange(cursor: string): { start: string; end: string } {
  const [year, month] = cursor.split("-").map(Number);
  const last = new Date(year, month, 0).getDate();
  return {
    start: `${cursor}-01`,
    end: `${cursor}-${String(last).padStart(2, "0")}`,
  };
}

/** Sunday-start week containing the given local date. */
export function weekRange(iso: string): { start: string; end: string; days: string[] } {
  const date = parseISODate(iso);
  const start = addDays(iso, -date.getDay());
  const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));
  return { start, end: days[6], days };
}

export function visibleKindsInItems(items: CalendarItem[]): CalendarItemKind[] {
  return CALENDAR_LEGEND.map((item) => item.kind).filter((kind) => items.some((entry) => entry.kind === kind));
}

export function filtersActive(filters: CalendarFilters): boolean {
  return filters.kinds.length > 0
    || filters.departmentId !== "all"
    || filters.locationId !== "all"
    || filters.status !== "all"
    || filters.employeeId !== "all";
}

/** Expand window so month cells near edges still get multi-day leave context. */
export function paddedMonthRange(cursor: string): { start: string; end: string } {
  const { start, end } = monthRange(cursor);
  return { start: addDays(start, -6), end: addDays(end, 6) };
}

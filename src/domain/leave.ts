import { addDays, eachDate, todayIso, weekday } from "./dates";
import type {
  AppState,
  AttendanceRecord,
  CompOffGrant,
  Employee,
  Holiday,
  LeaveRequest,
  LeaveType,
  OrgSettings,
  PartialDay,
} from "../types";
import { formatDate, plural } from "../lib/format";

export interface LeaveSummary {
  typeId: string;
  name: string;
  paid: boolean;
  entitled: number | null;
  used: number;
  pending: number;
  available: number | null;
  nextExpiry: string | null;
}

export function isWeeklyOff(iso: string, weeklyOff: number[]): boolean {
  return weeklyOff.includes(weekday(iso));
}

export function isHoliday(iso: string, locationId: string, holidays: Holiday[]): boolean {
  return holidays.some((item) => item.date === iso && (item.locationId === "all" || item.locationId === locationId));
}

export function isNonWorking(iso: string, locationId: string, settings: OrgSettings, holidays: Holiday[]): boolean {
  return isWeeklyOff(iso, settings.weeklyOff) || isHoliday(iso, locationId, holidays);
}

export function holidaysFor(iso: string, locationId: string, holidays: Holiday[]): Holiday[] {
  return holidays.filter((item) => item.date === iso && (item.locationId === "all" || item.locationId === locationId));
}

export function workingDaysFor(employee: Employee, start: string, end: string, state: AppState): string[] {
  return eachDate(start, end).filter(
    (iso) => !isNonWorking(iso, employee.locationId, state.settings, state.holidays),
  );
}

function roundDay(value: number): number {
  return Math.round(value * 2) / 2;
}

function requestYear(request: LeaveRequest): number {
  return Number(request.startDate.slice(0, 4));
}

export function leaveSummaries(state: AppState, employeeId: string, year = Number(todayIso().slice(0, 4))): LeaveSummary[] {
  const today = todayIso();
  const requests = state.leaveRequests.filter((item) => item.employeeId === employeeId && requestYear(item) === year);
  return state.settings.leaveTypes.map((type) => {
    const mine = requests.filter((item) => item.typeId === type.id);
    const used = mine.filter((item) => item.status === "approved").reduce((sum, item) => sum + item.days, 0);
    const pending = mine.filter((item) => item.status === "pending").reduce((sum, item) => sum + item.days, 0);
    if (type.id === "comp-off") {
      const grants = state.compOff.filter((item) => item.employeeId === employeeId);
      const availableGrants = grants.filter((item) => item.status === "available" && item.expiresOn >= today);
      const grantDays = availableGrants.reduce((sum, item) => sum + item.days, 0);
      const expiries = availableGrants.map((item) => item.expiresOn).sort();
      return {
        typeId: type.id,
        name: type.name,
        paid: type.paid,
        entitled: null,
        used: grants.filter((item) => item.status === "used").reduce((sum, item) => sum + item.days, 0),
        pending,
        available: roundDay(Math.max(0, grantDays - pending)),
        nextExpiry: expiries[0] ?? null,
      };
    }
    return {
      typeId: type.id,
      name: type.name,
      paid: type.paid,
      entitled: type.annual,
      used,
      pending,
      available: type.annual === null ? null : roundDay(type.annual - used - pending),
      nextExpiry: null,
    };
  });
}

export interface LeaveDraft {
  employeeId: string;
  typeId: string;
  startDate: string;
  endDate: string;
  partial: PartialDay;
  reason: string;
}

export function validateLeave(state: AppState, draft: LeaveDraft): { ok: true; days: string[]; count: number } | { ok: false; message: string } {
  const employee = state.employees.find((item) => item.id === draft.employeeId);
  const type = state.settings.leaveTypes.find((item) => item.id === draft.typeId);
  if (!employee) return { ok: false, message: "Choose an employee." };
  if (!type) return { ok: false, message: "Choose a leave type." };
  if (!draft.startDate || !draft.endDate) return { ok: false, message: "Choose a start and end date." };
  if (draft.endDate < draft.startDate) return { ok: false, message: "The end date is before the start date." };
  if (draft.reason.trim().length < 8) {
    return { ok: false, message: "Add a short reason (at least 8 characters) so your reviewer has context." };
  }
  if (draft.partial !== "none") {
    if (draft.startDate !== draft.endDate) {
      return { ok: false, message: "A half day can only be requested for a single date." };
    }
    if (state.settings.halfDayPolicy?.allowEmployeeRequest === false) {
      return { ok: false, message: "Half-day leave requests are turned off in company settings." };
    }
    if (!type.allowHalfDay) {
      return { ok: false, message: `${type.name} does not allow a half day. Request a full day or choose another type.` };
    }
  }
  const days = workingDaysFor(employee, draft.startDate, draft.endDate, state);
  if (days.length === 0) {
    return {
      ok: false,
      message: "This range does not include a working day at your location. Weekends and location holidays are not counted as leave.",
    };
  }
  const count = draft.partial === "none" ? days.length : 0.5;
  const overlap = state.leaveRequests.find((item) => {
    if (item.employeeId !== employee.id) return false;
    if (item.status === "rejected") return false;
    return item.startDate <= draft.endDate && item.endDate >= draft.startDate;
  });
  if (overlap) {
    const overlapType = state.settings.leaveTypes.find((item) => item.id === overlap.typeId);
    return {
      ok: false,
      message: `These dates overlap a ${overlap.status} ${overlapType?.name ?? "leave"} request from ${formatDate(overlap.startDate)} to ${formatDate(overlap.endDate)}.`,
    };
  }
  const summary = leaveSummaries(state, employee.id).find((item) => item.typeId === type.id);
  if (summary && summary.available !== null && count > summary.available + 0.001) {
    const entitled = summary.entitled === null ? "no fixed entitlement" : `${summary.entitled} entitled`;
    return {
      ok: false,
      message: `This request needs ${plural(count, "day")}, but only ${plural(summary.available, "day")} of ${type.name.toLowerCase()} ${summary.available === 1 ? "is" : "are"} available. You have ${entitled}, ${summary.used} used, and ${summary.pending} already pending.`,
    };
  }
  return { ok: true, days, count };
}

export function leaveTypeOnDate(state: AppState, employeeId: string, iso: string): LeaveType | null {
  const request = state.leaveRequests.find(
    (item) =>
      item.employeeId === employeeId &&
      item.status === "approved" &&
      item.startDate <= iso &&
      item.endDate >= iso,
  );
  if (!request) return null;
  return state.settings.leaveTypes.find((item) => item.id === request.typeId) ?? null;
}

export function projectLeaveAttendance(state: AppState, request: LeaveRequest): AttendanceRecord[] {
  const employee = state.employees.find((item) => item.id === request.employeeId);
  if (!employee) return state.attendance;
  const days = workingDaysFor(employee, request.startDate, request.endDate, state);
  const next = state.attendance.map((item) => ({ ...item }));
  days.forEach((iso) => {
    const index = next.findIndex((item) => item.employeeId === request.employeeId && item.date === iso);
    if (index >= 0) {
      const current = next[index];
      next[index] = {
        ...current,
        status: "leave",
        source: "leave",
        note: current.clockIn
          ? `Approved leave. Previous punches retained (${request.id}).`
          : `Approved ${request.typeId} leave (${request.id}).`,
      };
    } else {
      next.push({
        id: `att_${request.employeeId}_${iso}`,
        employeeId: request.employeeId,
        date: iso,
        clockIn: null,
        clockOut: null,
        workMode: null,
        status: "leave",
        source: "leave",
        note: `Approved ${request.typeId} leave (${request.id}).`,
      });
    }
  });
  return next;
}

export function consumeCompOff(grants: CompOffGrant[], employeeId: string, days: number, requestId: string, today: string, newId: () => string): CompOffGrant[] | null {
  const next = grants.map((item) => ({ ...item }));
  let remaining = days;
  const pool = next
    .filter((item) => item.employeeId === employeeId && item.status === "available" && item.expiresOn >= today)
    .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn));
  pool.forEach((grant) => {
    if (remaining <= 0.001) return;
    if (grant.days <= remaining + 0.001) {
      grant.status = "used";
      grant.usedOn = today;
      grant.leaveRequestId = requestId;
      remaining = roundDay(remaining - grant.days);
    } else {
      grant.days = roundDay(grant.days - remaining);
      next.push({
        id: newId(),
        employeeId,
        days: remaining,
        earnedOn: grant.earnedOn,
        expiresOn: grant.expiresOn,
        reason: grant.reason,
        status: "used",
        usedOn: today,
        leaveRequestId: requestId,
      });
      remaining = 0;
    }
  });
  return remaining > 0.001 ? null : next;
}

export function upcomingLeave(state: AppState, employeeId: string, from: string, to: string): LeaveRequest[] {
  return state.leaveRequests.filter(
    (item) => item.employeeId === employeeId && item.status === "approved" && item.endDate >= from && item.startDate <= to,
  );
}

export function defaultCompOffExpiry(earnedOn: string): string {
  return addDays(earnedOn, 90);
}

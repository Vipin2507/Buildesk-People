import { hhmm, minutesOf, todayIso, weekday } from "./dates";
import { isHoliday, isNonWorking, isWeeklyOff } from "./leave";
import type { AppState, AttendanceRecord, AttendanceStatus, Employee, WorkMode } from "../types";

export function derivePunchStatus(
  state: AppState,
  employee: Employee,
  date: string,
  clockIn: string | null,
  clockOut: string | null,
): AttendanceStatus {
  if (!clockIn && !clockOut) return "absent";
  if (!clockIn || !clockOut) {
    if (!clockIn || date < todayIso()) return "incomplete";
  }
  if (isNonWorking(date, employee.locationId, state.settings, state.holidays)) return "present";
  const arrived = minutesOf(hhmm(clockIn) ?? "00:00");
  const threshold = minutesOf(state.settings.workStart) + state.settings.graceMinutes;
  return arrived > threshold ? "late" : "present";
}

/** Open punches from earlier days become missed punches. Today's open punch stays in progress. */
export function normalizeAttendance(state: AppState): AppState {
  const today = todayIso();
  let changed = false;
  const attendance = state.attendance.map((record) => {
    if (record.date < today && record.clockIn && !record.clockOut && record.status !== "leave" && record.status !== "holiday") {
      changed = true;
      return { ...record, status: "incomplete" as const, note: record.note || "Clock-out was not recorded." };
    }
    return record;
  });
  return changed ? { ...state, attendance } : state;
}

export function recordOn(state: AppState, employeeId: string, date: string): AttendanceRecord | null {
  return state.attendance.find((item) => item.employeeId === employeeId && item.date === date) ?? null;
}

export function todayRecord(state: AppState, employeeId: string): AttendanceRecord | null {
  return recordOn(state, employeeId, todayIso());
}

export function officeClosedToday(state: AppState, locationId: string): "weekend" | "holiday" | null {
  const today = todayIso();
  const day = weekday(today);
  if (state.settings.weeklyOff.includes(day)) return "weekend";
  if (isNonWorking(today, locationId, state.settings, state.holidays) && !state.settings.weeklyOff.includes(day)) {
    return "holiday";
  }
  return null;
}

export function teamOnDate(state: AppState, managerId: string, date: string) {
  const people = state.employees.filter((item) => item.managerId === managerId && item.status !== "inactive");
  return people.map((person) => ({
    person,
    record: recordOn(state, person.id, date),
  }));
}

export function companyOnDate(state: AppState, date: string) {
  return state.employees
    .filter((item) => item.status !== "inactive")
    .map((person) => ({ person, record: recordOn(state, person.id, date) }));
}

export interface DayFlags {
  present: boolean;
  remote: boolean;
  onLeave: boolean;
  absent: boolean;
  exception: boolean;
  off: boolean;
  weeklyOff: boolean;
  holiday: boolean;
}

/** Roster status for one person on one date. Approved leave is not counted as absent. A missing punch on a weekly off or location holiday is not absent, and late is not derived for those days. */
export function dayFlags(state: AppState, person: Employee, date: string, record: AttendanceRecord | null): DayFlags {
  const weeklyOff = isWeeklyOff(date, state.settings.weeklyOff);
  const holiday = isHoliday(date, person.locationId, state.holidays);
  const off = weeklyOff || holiday;
  const onLeave = record?.status === "leave" || state.leaveRequests.some((item) => item.employeeId === person.id && item.status === "approved" && item.startDate <= date && item.endDate >= date);
  const status = record?.status;
  const absent = !onLeave && (status === "absent" || (!record && !off));
  return {
    present: status === "present" || status === "late",
    remote: record?.workMode === "remote",
    onLeave,
    absent,
    exception: status === "late" || status === "incomplete" || absent,
    off,
    weeklyOff,
    holiday,
  };
}

export function modeLabel(mode: WorkMode | null): string {
  if (mode === "office") return "Office";
  if (mode === "remote") return "Remote";
  if (mode === "client") return "Client site";
  return "Not recorded";
}

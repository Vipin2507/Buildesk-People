import { canManageHrMeeting, canManageTicket, canReview, defaultAssignee, hasPermission } from "../lib/access";
import { DEFAULT_ROLE_PERMISSIONS } from "../lib/access";
import { derivePunchStatus, recordOn } from "../domain/attendance";
import { acceptPunchLocation, applyLocationRetention, locationAuditPhrase } from "../domain/location";
import { addDays, nowIso, todayIso, uid, wallNow } from "../domain/dates";
import { normalizeHoliday } from "../domain/holidays";
import {
  formatMeetingSlot,
  hrMeetingTopics,
  isHrMeetingTicket,
  normalizeMicrosoft365,
  validateMeetingSlot,
} from "../domain/hr-meeting";
import { consumeCompOff, defaultCompOffExpiry, projectLeaveAttendance, validateLeave } from "../domain/leave";
import { snapshotPayslipRecord, validatePayslipData, buildPayslipDto, PAYSLIP_TEMPLATE_VERSION } from "../domain/payslip";
import { createsCycle } from "../domain/org";
import { ensureAutomation, normalizeAutomationConfig } from "../domain/automation";
import { createMasterValue, defaultMasters, mastersInUse } from "../domain/masters";
import type { MasterKind } from "../types";
import { applyAdjustments, buildPayrollLines, computePayable, currentPeriod, normalizeLine, periodForMonth, periodWarnings } from "../domain/payroll";
import type { AutomationConfig, AutomationEndpoint, AutomationRule, AutomationSettings, WahaConfig } from "../types/automation";
import { isValidEmail, normalizeEmail } from "../lib/auth";
import { formatDate, formatTime, fullName, rangeLabel } from "../lib/format";
import { avatarColorAt } from "../lib/palette";
import { sessionEmployee } from "../lib/session";
import type {
  AppNotification,
  AppState,
  Asset,
  AssetCondition,
  AssetType,
  DocumentSensitivity,
  EmployeeDocument,
  Policy,
  PolicyAudience,
  PolicyVersion,
  AuditArea,
  AuditScope,
  CompanyEvent,
  Employee,
  EmploymentStatus,
  EmploymentType,
  ExpenseClaim,
  HistoryEvent,
  Holiday,
  HrMeetingDetails,
  HrMeetingSlot,
  LeaveType,
  Microsoft365Config,
  NotificationKind,
  PartialDay,
  PayrollLine,
  PayrollRun,
  PayrollStatus,
  Payslip,
  Permission,
  RequestStatus,
  Result,
  Role,
  Ticket,
  UserAccount,
  TicketPriority,
  TicketStatus,
  WorkMode,
} from "../types";

export type ToastTone = "success" | "error" | "info";

export interface Outcome {
  state: AppState;
  result: Result;
  toast?: string;
  tone?: ToastTone;
}

export interface EmployeeDraft {
  id?: string;
  firstName: string;
  lastName: string;
  email: string;
  jobTitle: string;
  departmentId: string;
  managerId: string | null;
  locationId: string;
  employmentType: EmploymentType;
  status: EmploymentStatus;
  joiningDate: string;
  phone: string;
  personalEmail: string;
  address: string;
  emergencyName: string;
  emergencyRelationship?: string;
  emergencyPhone: string;
  emergencySecondaryName?: string;
  emergencySecondaryRelationship?: string;
  emergencySecondaryPhone?: string;
  dateOfBirth: string;
  showBirthday: boolean;
  role?: Role;
  monthlyGross?: number;
}

export interface ProfileDraft {
  phone: string;
  personalEmail: string;
  address: string;
  emergencyName: string;
  emergencyRelationship: string;
  emergencyPhone: string;
  emergencySecondaryName: string;
  emergencySecondaryRelationship: string;
  emergencySecondaryPhone: string;
  showBirthday: boolean;
}

export interface InsuranceDraft {
  employeeId: string;
  plan: string;
  policyNumber: string;
  coverage: string;
  renewalDate: string;
  notes: string;
  dependents: { name: string; relationship: string; dateOfBirth: string }[];
}

function user(state: AppState): Employee | null {
  return sessionEmployee(state);
}

function person(state: AppState, id: string | null): Employee | null {
  if (!id) return null;
  return state.employees.find((item) => item.id === id) ?? null;
}

function name(state: AppState, id: string | null): string {
  const found = person(state, id);
  if (found) return fullName(found);
  const account = id ? state.accounts.find((item) => item.id === id) : undefined;
  return account?.displayName || account?.email || "Someone";
}

function requireOwnRecord(state: AppState, actor: Employee): Outcome | null {
  if (state.employees.some((item) => item.id === actor.id)) return null;
  return fail(state, "This login is not linked to an employee record. Personal attendance, leave, expenses, and profile changes stay on the employee profile.", true);
}

function ok(state: AppState, toast?: string, id?: string): Outcome {
  return { state, result: { ok: true, id }, toast, tone: "success" };
}

function fail(state: AppState, message: string, announce = false): Outcome {
  return { state, result: { ok: false, message }, toast: announce ? message : undefined, tone: "error" };
}

function hist(actorId: string, action: string, comment: string): HistoryEvent {
  return { id: uid("hist"), at: nowIso(), actorId, action, comment };
}

function pushAudit(state: AppState, actorId: string, area: AuditArea, summary: string, scope: AuditScope = "general"): AppState {
  return {
    ...state,
    audits: [{ id: uid("aud"), at: nowIso(), actorId, area, summary, scope }, ...state.audits].slice(0, 400),
  };
}

function pushNotes(state: AppState, notes: Array<Omit<AppNotification, "id" | "read" | "createdAt">>): AppState {
  const created = notes.map((item) => ({ ...item, id: uid("ntf"), read: false, createdAt: nowIso() }));
  return { ...state, notifications: [...created, ...state.notifications].slice(0, 500) };
}

function hrIds(state: AppState): string[] {
  return state.employees.filter((item) => item.role === "hr" && item.status !== "inactive").map((item) => item.id);
}

function approverIds(state: AppState, employee: Employee, topic: "leave" | "attendance" | "expense"): string[] {
  const manager = person(state, employee.managerId);
  if (manager && canReview(state, manager, employee.id, topic)) return [manager.id];
  return hrIds(state);
}

function requireUser(state: AppState, permission?: Permission): Employee | Outcome {
  const actor = user(state);
  if (!actor) return fail(state, "Sign in to continue.", true);
  if (permission && !hasPermission(state, actor, permission)) return fail(state, "You don't have permission to do that.", true);
  return actor;
}

function isEmployee(value: Employee | Outcome): value is Employee {
  return "employeeCode" in value;
}

function punchLocation(state: AppState, raw: unknown) {
  const required = state.settings.attendanceLocationRequired === true;
  const parsed = acceptPunchLocation(raw, required);
  if (!parsed.ok) return parsed;
  const location = parsed.location.status === "captured" ? { ...parsed.location, capturedAt: wallNow() } : parsed.location;
  return { ok: true as const, location };
}

export function clockIn(state: AppState, mode: WorkMode, rawLocation: unknown): Outcome {
  const actor = requireUser(state, "attendance.self");
  if (!isEmployee(actor)) return actor;
  const unlinked = requireOwnRecord(state, actor);
  if (unlinked) return unlinked;
  if (actor.status === "inactive") return fail(state, "Inactive employees can't record attendance.", true);
  if (mode !== "office" && mode !== "remote" && mode !== "client") return fail(state, "Choose Office, Remote, or Client site.");
  const today = todayIso();
  const existing = recordOn(state, actor.id, today);
  if (existing?.status === "leave") return fail(state, "You're on approved leave today. Ask your reviewer if this day should change.", true);
  if (existing?.clockIn && !existing.clockOut) return fail(state, "You're already clocked in. Clock out when you finish.", true);
  if (existing?.clockIn && existing.clockOut) {
    return fail(state, "Today's attendance is already complete. Submit a correction if a time is wrong.", true);
  }
  const parsed = punchLocation(state, rawLocation);
  if (!parsed.ok) return fail(state, parsed.message, true);
  const stamp = wallNow();
  const status = derivePunchStatus(state, actor, today, stamp, null);
  const next = {
    id: existing?.id ?? `att_${actor.id}_${today}`,
    employeeId: actor.id,
    date: today,
    clockIn: stamp,
    clockOut: null,
    workMode: mode,
    status,
    source: "punch" as const,
    note: "",
    clockInLocation: parsed.location,
    clockOutLocation: null,
  };
  const attendance = existing
    ? state.attendance.map((item) => (item.id === existing.id ? next : item))
    : [...state.attendance, next];
  const where = mode === "office" ? "Office" : mode === "remote" ? "Remote" : "Client site";
  return ok(
    pushAudit({ ...state, attendance }, actor.id, "attendance", `Clocked in (${where}). ${locationAuditPhrase(parsed.location)}`),
    `Clocked in at ${formatTime(stamp)} · ${where}.`,
  );
}

export function clockOut(state: AppState, rawLocation: unknown): Outcome {
  const actor = requireUser(state, "attendance.self");
  if (!isEmployee(actor)) return actor;
  const unlinked = requireOwnRecord(state, actor);
  if (unlinked) return unlinked;
  const today = todayIso();
  const existing = recordOn(state, actor.id, today);
  if (!existing?.clockIn) return fail(state, "Clock in before you clock out.", true);
  if (existing.clockOut) return fail(state, "You're already clocked out for today.", true);
  const parsed = punchLocation(state, rawLocation);
  if (!parsed.ok) return fail(state, parsed.message, true);
  const stamp = wallNow();
  if (stamp.slice(11, 16) <= (existing.clockIn.slice(11, 16) || "00:00")) {
    return fail(state, "Clock-out time must be after clock-in. Submit a correction if the clock-in time is wrong.", true);
  }
  const status = derivePunchStatus(state, actor, today, existing.clockIn, stamp);
  const attendance = state.attendance.map((item) =>
    item.id === existing.id ? { ...item, clockOut: stamp, status, source: "punch" as const, clockOutLocation: parsed.location } : item,
  );
  return ok(
    pushAudit({ ...state, attendance }, actor.id, "attendance", `Clocked out. ${locationAuditPhrase(parsed.location)}`),
    `Clocked out at ${formatTime(stamp)}.`,
  );
}

export function rememberPlaceLabel(state: AppState, recordId: string, which: "in" | "out", placeLabel: string): Outcome {
  const actor = user(state);
  if (!actor) return fail(state, "Sign in to continue.", true);
  const label = placeLabel.replace(/\s+/g, " ").trim();
  if (label.length < 3 || label.length > 180) return fail(state, "The address could not be saved.");
  const record = state.attendance.find((item) => item.id === recordId);
  if (!record) return fail(state, "That attendance record could not be found.", true);
  const allowed = record.employeeId === actor.id
    || hasPermission(state, actor, "attendance.company")
    || (hasPermission(state, actor, "attendance.team") && state.employees.some((item) => item.id === record.employeeId && item.managerId === actor.id));
  if (!allowed) return fail(state, "You don't have access to this attendance location.", true);
  const current = which === "in" ? record.clockInLocation : record.clockOutLocation;
  if (!current || current.status !== "captured" || current.latitude == null || current.longitude == null) {
    return fail(state, "This punch has no device position to describe.");
  }
  if (current.placeLabel === label) return ok(state);
  const nextFix = { ...current, placeLabel: label };
  const attendance = state.attendance.map((item) => item.id === record.id
    ? { ...item, ...(which === "in" ? { clockInLocation: nextFix } : { clockOutLocation: nextFix }) }
    : item);
  const regularizations = state.regularizations.map((request) => {
    if (request.employeeId !== record.employeeId || request.date !== record.date) return request;
    if (which === "in" && request.originalClockInLocation?.status === "captured" && !request.originalClockInLocation.placeLabel) {
      return { ...request, originalClockInLocation: { ...request.originalClockInLocation, placeLabel: label } };
    }
    if (which === "out" && request.originalClockOutLocation?.status === "captured" && !request.originalClockOutLocation.placeLabel) {
      return { ...request, originalClockOutLocation: { ...request.originalClockOutLocation, placeLabel: label } };
    }
    return request;
  });
  return ok(
    pushAudit({ ...state, attendance, regularizations }, actor.id, "attendance", `Looked up the written address for an attendance punch on ${formatDate(record.date)}.`),
  );
}

export function submitRegularization(
  state: AppState,
  input: { date: string; requestedIn: string; requestedOut: string; reason: string; attachmentName: string },
): Outcome {
  const actor = requireUser(state, "attendance.self");
  if (!isEmployee(actor)) return actor;
  const unlinked = requireOwnRecord(state, actor);
  if (unlinked) return unlinked;
  if (!input.date) return fail(state, "Choose the date to correct.");
  if (input.date > todayIso()) return fail(state, "You can only correct a date that has already started.");
  if (!input.requestedIn || !input.requestedOut) return fail(state, "Enter both a clock-in and a clock-out time.");
  if (input.requestedOut <= input.requestedIn) return fail(state, "Clock-out must be after clock-in.");
  if (input.reason.trim().length < 8) return fail(state, "Add a short reason (at least 8 characters) for the correction.");
  if (state.regularizations.some((item) => item.employeeId === actor.id && item.date === input.date && item.status === "pending")) {
    return fail(state, "You already have a pending correction for this date.");
  }
  const existing = recordOn(state, actor.id, input.date);
  const request = {
    id: uid("reg"),
    employeeId: actor.id,
    date: input.date,
    requestedIn: input.requestedIn,
    requestedOut: input.requestedOut,
    reason: input.reason.trim(),
    attachmentName: input.attachmentName,
    status: "pending" as const,
    originalIn: existing?.clockIn ?? null,
    originalOut: existing?.clockOut ?? null,
    appliedIn: null,
    appliedOut: null,
    reviewerId: null,
    reviewComment: "",
    reviewedAt: null,
    submittedAt: nowIso(),
    history: [hist(actor.id, "Submitted", input.reason.trim())],
    originalClockInLocation: existing?.clockInLocation ?? null,
    originalClockOutLocation: existing?.clockOutLocation ?? null,
  };
  const notes = approverIds(state, actor, "attendance").map((userId) => ({
    userId,
    title: "Attendance correction waiting",
    body: `${fullName(actor)} asked to correct ${formatDate(input.date)}.`,
    href: "/attendance?tab=corrections",
    kind: "attendance" as const,
  }));
  const next = pushNotes(
    pushAudit({ ...state, regularizations: [request, ...state.regularizations] }, actor.id, "attendance", `Submitted an attendance correction for ${formatDate(input.date)}.`),
    notes,
  );
  return ok(next, "Correction submitted. Your reviewer will see the original and requested times.");
}

export function decideRegularization(
  state: AppState,
  id: string,
  decision: Extract<RequestStatus, "approved" | "rejected">,
  comment: string,
  times?: { requestedIn: string; requestedOut: string },
): Outcome {
  const actor = requireUser(state, "attendance.review");
  if (!isEmployee(actor)) return actor;
  const request = state.regularizations.find((item) => item.id === id);
  if (!request || request.status !== "pending") return fail(state, "This correction is no longer pending.", true);
  if (!canReview(state, actor, request.employeeId, "attendance")) return fail(state, "This correction is outside your review scope.", true);
  if (decision === "rejected" && comment.trim().length < 3) return fail(state, "Add a short note so the employee understands the decision.");
  const appliedIn = times?.requestedIn || request.requestedIn;
  const appliedOut = times?.requestedOut || request.requestedOut;
  if (decision === "approved" && appliedOut <= appliedIn) return fail(state, "Clock-out must be after clock-in.");
  const employee = person(state, request.employeeId);
  if (!employee) return fail(state, "That employee could not be found.", true);
  let attendance = state.attendance;
  let appliedNote = "";
  if (decision === "approved") {
    const clockIn = `${request.date}T${appliedIn}`;
    const clockOut = `${request.date}T${appliedOut}`;
    const status = derivePunchStatus(state, employee, request.date, clockIn, clockOut);
    const existing = recordOn(state, employee.id, request.date);
    const updated = {
      id: existing?.id ?? `att_${employee.id}_${request.date}`,
      employeeId: employee.id,
      date: request.date,
      clockIn,
      clockOut,
      workMode: existing?.workMode ?? "office",
      status,
      source: "regularization" as const,
      note: `Corrected from request ${request.id}. Earlier punches stay on this request. Device location from the original punch is unchanged.`,
      clockInLocation: existing?.clockInLocation ?? null,
      clockOutLocation: existing?.clockOutLocation ?? null,
    };
    attendance = existing ? state.attendance.map((item) => (item.id === existing.id ? updated : item)) : [...state.attendance, updated];
    appliedNote = times && (times.requestedIn !== request.requestedIn || times.requestedOut !== request.requestedOut) ? "Approved with edited times." : "Approved.";
  }
  const reviewedAt = nowIso();
  const regularizations = state.regularizations.map((item) =>
    item.id === id
      ? {
          ...item,
          status: decision,
          reviewerId: actor.id,
          reviewComment: comment.trim(),
          reviewedAt,
          appliedIn: decision === "approved" ? appliedIn : null,
          appliedOut: decision === "approved" ? appliedOut : null,
          history: [...item.history, hist(actor.id, decision === "approved" ? "Approved" : "Rejected", comment.trim() || appliedNote)],
        }
      : item,
  );
  const next = pushNotes(pushAudit({ ...state, attendance, regularizations }, actor.id, "attendance", `${decision === "approved" ? "Approved" : "Rejected"} an attendance correction for ${name(state, request.employeeId)}.`), [
    {
      userId: request.employeeId,
      title: decision === "approved" ? "Attendance correction approved" : "Attendance correction rejected",
      body: `${fullName(actor)} ${decision} the correction for ${formatDate(request.date)}.`,
      href: "/attendance?tab=corrections",
      kind: "attendance" as NotificationKind,
    },
  ]);
  return ok(next, decision === "approved" ? "Correction approved. Attendance now shows the reviewed times." : "Correction rejected. Attendance was not changed.");
}

export function submitLeave(
  state: AppState,
  input: { typeId: string; startDate: string; endDate: string; partial: PartialDay; reason: string; attachmentName: string },
): Outcome {
  const actor = requireUser(state, "leave.self");
  if (!isEmployee(actor)) return actor;
  const unlinked = requireOwnRecord(state, actor);
  if (unlinked) return unlinked;
  const check = validateLeave(state, { ...input, employeeId: actor.id });
  if (!check.ok) return fail(state, check.message);
  const request = {
    id: uid("lv"),
    employeeId: actor.id,
    typeId: input.typeId,
    startDate: input.startDate,
    endDate: input.endDate,
    partial: input.partial,
    reason: input.reason.trim(),
    attachmentName: input.attachmentName,
    status: "pending" as const,
    days: check.count,
    reviewerId: null,
    reviewComment: "",
    submittedAt: nowIso(),
    reviewedAt: null,
    history: [hist(actor.id, "Submitted", input.reason.trim())],
  };
  const typeName = state.settings.leaveTypes.find((item) => item.id === input.typeId)?.name ?? "Leave";
  const next = pushNotes(pushAudit({ ...state, leaveRequests: [request, ...state.leaveRequests] }, actor.id, "leave", `Submitted ${typeName.toLowerCase()} for ${rangeLabel(input.startDate, input.endDate)}.`), approverIds(state, actor, "leave").map((userId) => ({
    userId,
    title: "Leave waiting for you",
    body: `${fullName(actor)} requested ${typeName.toLowerCase()} (${check.count} day${check.count === 1 ? "" : "s"}).`,
    href: "/leave?tab=approvals",
    kind: "leave" as const,
  })));
  return ok(next, "Leave request submitted.");
}

export function decideLeave(state: AppState, id: string, decision: Extract<RequestStatus, "approved" | "rejected">, comment: string): Outcome {
  const actor = requireUser(state, "leave.approve");
  if (!isEmployee(actor)) return actor;
  const request = state.leaveRequests.find((item) => item.id === id);
  if (!request || request.status !== "pending") return fail(state, "This leave request is no longer pending.", true);
  if (!canReview(state, actor, request.employeeId, "leave")) return fail(state, "This request is outside your review scope.", true);
  if (decision === "rejected" && comment.trim().length < 3) return fail(state, "Add a short note so the employee understands the decision.");
  let compOff = state.compOff;
  let attendance = state.attendance;
  if (decision === "approved" && request.typeId === "comp-off") {
    const consumed = consumeCompOff(state.compOff, request.employeeId, request.days, request.id, todayIso(), () => uid("coff"));
    if (!consumed) return fail(state, "The comp-off balance is no longer enough for this request.");
    compOff = consumed;
  }
  if (decision === "approved") attendance = projectLeaveAttendance(state, { ...request, status: "approved" });
  const leaveRequests = state.leaveRequests.map((item) =>
    item.id === id
      ? { ...item, status: decision, reviewerId: actor.id, reviewComment: comment.trim(), reviewedAt: nowIso(), history: [...item.history, hist(actor.id, decision === "approved" ? "Approved" : "Rejected", comment.trim())] }
      : item,
  );
  const typeName = state.settings.leaveTypes.find((item) => item.id === request.typeId)?.name ?? "Leave";
  const next = pushNotes(
    pushAudit({ ...state, leaveRequests, attendance, compOff }, actor.id, "leave", `${decision === "approved" ? "Approved" : "Rejected"} ${typeName.toLowerCase()} for ${name(state, request.employeeId)}.`),
    [{ userId: request.employeeId, title: decision === "approved" ? "Leave approved" : "Leave rejected", body: `${fullName(actor)} ${decision} your ${typeName.toLowerCase()} request.`, href: "/leave?tab=mine", kind: "leave" }],
  );
  return ok(next, decision === "approved" ? "Leave approved." : "Leave rejected.");
}

export function grantCompOff(state: AppState, input: { employeeId: string; days: number; earnedOn: string; expiresOn: string; reason: string }): Outcome {
  const actor = requireUser(state, "leave.manage");
  if (!isEmployee(actor)) return actor;
  if (!person(state, input.employeeId)) return fail(state, "Choose an employee.");
  if (!(input.days > 0) || input.days > 5) return fail(state, "Enter comp-off between half a day and 5 days.");
  if (!input.earnedOn || input.earnedOn > todayIso()) return fail(state, "The earned date can't be in the future.");
  const expiresOn = input.expiresOn || defaultCompOffExpiry(input.earnedOn);
  if (expiresOn <= input.earnedOn) return fail(state, "Expiry must be after the earned date.");
  if (input.reason.trim().length < 8) return fail(state, "Add a short reason for the comp-off.");
  const grant = {
    id: uid("coff"),
    employeeId: input.employeeId,
    days: input.days,
    earnedOn: input.earnedOn,
    expiresOn,
    reason: input.reason.trim(),
    status: "available" as const,
    usedOn: null,
    leaveRequestId: null,
  };
  const next = pushNotes(pushAudit({ ...state, compOff: [grant, ...state.compOff] }, actor.id, "leave", `Granted comp-off to ${name(state, input.employeeId)}.`), [
    { userId: input.employeeId, title: "Comp-off added", body: `${input.days} day${input.days === 1 ? "" : "s"} of comp-off ${input.days === 1 ? "is" : "are"} available until ${formatDate(expiresOn)}.`, href: "/leave?tab=compoff", kind: "leave" },
  ]);
  return ok(next, "Comp-off granted.");
}

export function saveHoliday(state: AppState, input: Holiday): Outcome {
  const actor = requireUser(state, "leave.manage");
  if (!isEmployee(actor)) return actor;
  if (input.name.trim().length < 3 || !input.date) return fail(state, "Add a holiday name and date.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return fail(state, "Pick a valid holiday date.");
  const holiday = normalizeHoliday({
    ...input,
    id: input.id || uid("hol"),
    name: input.name.trim(),
    recurrence: input.recurrence === "annual" ? "annual" : "once",
  });
  const duplicate = state.holidays.find((item) =>
    item.id !== holiday.id
    && item.name.toLowerCase() === holiday.name.toLowerCase()
    && item.date === holiday.date
    && item.locationId === holiday.locationId
    && (item.recurrence ?? "once") === holiday.recurrence,
  );
  if (duplicate) return fail(state, "That holiday already exists for this date and location.");
  const holidays = state.holidays.some((item) => item.id === holiday.id)
    ? state.holidays.map((item) => (item.id === holiday.id ? holiday : item))
    : [...state.holidays, holiday];
  return ok(pushAudit({ ...state, holidays }, actor.id, "leave", `Saved the holiday ${holiday.name}.`), "Holiday saved.");
}

export function deleteHoliday(state: AppState, id: string): Outcome {
  const actor = requireUser(state, "leave.manage");
  if (!isEmployee(actor)) return actor;
  const holiday = state.holidays.find((item) => item.id === id);
  if (!holiday) return fail(state, "That holiday was not found.", true);
  return ok(pushAudit({ ...state, holidays: state.holidays.filter((item) => item.id !== id) }, actor.id, "leave", `Removed the holiday ${holiday.name}.`), "Holiday removed.");
}

export function saveEvent(state: AppState, input: CompanyEvent): Outcome {
  const actor = requireUser(state, "leave.manage");
  if (!isEmployee(actor)) return actor;
  if (input.title.trim().length < 3 || !input.date) return fail(state, "Add an event title and date.");
  const endDate = input.endDate && input.endDate.trim() ? input.endDate.trim() : input.date;
  if (endDate < input.date) return fail(state, "End date must be on or after the start date.");
  const title = input.title.trim();
  const description = input.description.trim();
  const kind = input.kind === "festival" ? "festival" : "event";
  const duplicate = state.events.find((item) =>
    item.id !== input.id
    && item.title.toLowerCase() === title.toLowerCase()
    && item.date === input.date
    && (item.endDate || item.date) === endDate
    && item.locationId === input.locationId
    && item.kind === kind,
  );
  if (duplicate) return fail(state, "An event with the same title, dates, location, and type already exists.");
  const event: CompanyEvent = {
    id: input.id || uid("evt"),
    title,
    date: input.date,
    endDate: endDate === input.date ? undefined : endDate,
    locationId: input.locationId,
    description,
    kind,
  };
  const events = state.events.some((item) => item.id === event.id) ? state.events.map((item) => (item.id === event.id ? event : item)) : [...state.events, event];
  return ok(pushAudit({ ...state, events }, actor.id, "settings", `Saved the ${kind === "festival" ? "festival" : "event"} ${event.title}.`), "Event saved.");
}

export function deleteEvent(state: AppState, id: string): Outcome {
  const actor = requireUser(state, "leave.manage");
  if (!isEmployee(actor)) return actor;
  const event = state.events.find((item) => item.id === id);
  if (!event) return fail(state, "That event was not found.", true);
  return ok(pushAudit({ ...state, events: state.events.filter((item) => item.id !== id) }, actor.id, "settings", `Removed the event ${event.title}.`), "Event removed.");
}

export function submitExpense(
  state: AppState,
  input: { category: string; amount: number; date: string; description: string; receiptName: string },
): Outcome {
  const actor = requireUser(state, "expenses.self");
  if (!isEmployee(actor)) return actor;
  const unlinked = requireOwnRecord(state, actor);
  if (unlinked) return unlinked;
  if (!state.settings.expenseCategories.includes(input.category)) return fail(state, "Choose an expense category.");
  if (!(input.amount > 0)) return fail(state, "Enter an amount greater than zero.");
  if (!input.date || input.date > todayIso()) return fail(state, "Expense date can't be in the future.");
  if (input.description.trim().length < 8) return fail(state, "Add a short description (at least 8 characters).");
  const claim: ExpenseClaim = {
    id: uid("exp"),
    employeeId: actor.id,
    category: input.category,
    amount: Math.round(input.amount),
    date: input.date,
    description: input.description.trim(),
    receiptName: input.receiptName,
    status: "pending",
    payrollRunId: null,
    submittedAt: nowIso(),
    history: [hist(actor.id, "Submitted", input.description.trim())],
  };
  const next = pushNotes(pushAudit({ ...state, expenses: [claim, ...state.expenses] }, actor.id, "expenses", `Submitted a ${input.category.toLowerCase()} expense.`), approverIds(state, actor, "expense").map((userId) => ({
    userId,
    title: "Expense waiting for you",
    body: `${fullName(actor)} submitted a ${input.category.toLowerCase()} claim.`,
    href: "/expenses?tab=approvals",
    kind: "expense" as const,
  })));
  return ok(next, "Expense submitted.");
}

export function decideExpense(state: AppState, id: string, decision: Extract<RequestStatus, "approved" | "rejected">, comment: string): Outcome {
  const actor = requireUser(state, "expenses.review");
  if (!isEmployee(actor)) return actor;
  const claim = state.expenses.find((item) => item.id === id);
  if (!claim || claim.status !== "pending") return fail(state, "This expense is no longer pending.", true);
  if (!canReview(state, actor, claim.employeeId, "expense")) return fail(state, "This expense is outside your review scope.", true);
  if (decision === "rejected" && comment.trim().length < 3) return fail(state, "Add a short note so the employee understands the decision.");
  const expenses = state.expenses.map((item) =>
    item.id === id ? { ...item, status: decision, history: [...item.history, hist(actor.id, decision === "approved" ? "Approved" : "Rejected", comment.trim())] } : item,
  );
  const notes: Array<Omit<AppNotification, "id" | "read" | "createdAt">> = [
    { userId: claim.employeeId, title: decision === "approved" ? "Expense approved" : "Expense rejected", body: `${fullName(actor)} ${decision} your ${claim.category.toLowerCase()} claim.`, href: "/expenses?tab=mine", kind: "expense" },
  ];
  if (decision === "approved") {
    state.employees.filter((item) => item.role === "payroll" && item.status !== "inactive").forEach((item) => {
      notes.push({ userId: item.id, title: "Expense ready to reimburse", body: `${name(state, claim.employeeId)}'s ${claim.category.toLowerCase()} claim was approved.`, href: "/expenses?tab=pay", kind: "expense" });
    });
  }
  return ok(pushNotes(pushAudit({ ...state, expenses }, actor.id, "expenses", `${decision === "approved" ? "Approved" : "Rejected"} an expense for ${name(state, claim.employeeId)}.`), notes), decision === "approved" ? "Expense approved." : "Expense rejected.");
}

export function markExpensePaid(state: AppState, id: string): Outcome {
  const actor = requireUser(state, "expenses.pay");
  if (!isEmployee(actor)) return actor;
  const claim = state.expenses.find((item) => item.id === id);
  if (!claim || claim.status !== "approved") return fail(state, "Only an approved expense can be marked paid.", true);
  const expenses = state.expenses.map((item) =>
    item.id === id ? { ...item, status: "paid" as const, history: [...item.history, hist(actor.id, "Paid", "Marked paid outside a payroll run.")] } : item,
  );
  const next = pushNotes(pushAudit({ ...state, expenses }, actor.id, "expenses", `Marked an expense paid for ${name(state, claim.employeeId)}.`), [
    { userId: claim.employeeId, title: "Expense reimbursed", body: `Your ${claim.category.toLowerCase()} claim was marked paid.`, href: "/expenses?tab=mine", kind: "expense" },
  ]);
  return ok(next, "Expense marked paid.");
}

export function saveInsurance(state: AppState, input: InsuranceDraft): Outcome {
  const actor = requireUser(state, "insurance.manage");
  if (!isEmployee(actor)) return actor;
  if (!person(state, input.employeeId)) return fail(state, "Choose an employee.");
  if (input.plan.trim().length < 3) return fail(state, "Add the plan name.");
  if (input.policyNumber.trim().length < 3) return fail(state, "Add the policy number.");
  if (input.coverage.trim().length < 8) return fail(state, "Describe the coverage in a short sentence.");
  if (!input.renewalDate) return fail(state, "Add the renewal date.");
  for (const dependent of input.dependents) {
    if (!dependent.name.trim() || !dependent.relationship.trim() || !dependent.dateOfBirth) {
      return fail(state, "Each dependent needs a name, relationship, and date of birth.");
    }
  }
  const existing = state.insurance.find((item) => item.employeeId === input.employeeId);
  const record = {
    id: existing?.id ?? uid("ins"),
    employeeId: input.employeeId,
    plan: input.plan.trim(),
    policyNumber: input.policyNumber.trim(),
    coverage: input.coverage.trim(),
    renewalDate: input.renewalDate,
    notes: input.notes.trim(),
    dependents: input.dependents.map((item) => ({ id: uid("dep"), name: item.name.trim(), relationship: item.relationship.trim(), dateOfBirth: item.dateOfBirth })),
  };
  const insurance = existing ? state.insurance.map((item) => (item.employeeId === input.employeeId ? record : item)) : [...state.insurance, record];
  const next = pushNotes(pushAudit({ ...state, insurance }, actor.id, "insurance", `Updated insurance enrollment for ${name(state, input.employeeId)}.`, "insurance"), [
    { userId: input.employeeId, title: "Insurance record updated", body: "HR updated your insurance enrollment. Only you and HR can view it.", href: "/expenses?tab=insurance", kind: "event" },
  ]);
  return ok(next, "Insurance record saved.");
}

export type CreateTicketInput = {
  subject: string;
  description: string;
  category: string;
  priority: TicketPriority;
  attachmentName: string;
  kind?: "support" | "hr_meeting";
  meeting?: {
    requestType: "teams" | "phone";
    topic: string;
    preferred: HrMeetingSlot;
    alternative?: HrMeetingSlot | null;
    contactNote?: string;
  };
};

export function createTicket(state: AppState, input: CreateTicketInput): Outcome {
  const actor = requireUser(state, "tickets.self");
  if (!isEmployee(actor)) return actor;
  const unlinked = requireOwnRecord(state, actor);
  if (unlinked) return unlinked;
  const kind = input.kind === "hr_meeting" ? "hr_meeting" : "support";
  if (kind === "support" && !state.settings.ticketCategories.includes(input.category)) return fail(state, "Choose a category.");
  if (input.subject.trim().length < 5) return fail(state, "Add a subject of at least 5 characters.");
  if (input.description.trim().length < 10) return fail(state, "Describe the request in at least a sentence.");

  let meeting: HrMeetingDetails | null = null;
  if (kind === "hr_meeting") {
    if (!input.meeting) return fail(state, "Add meeting preference details.");
    const topics = hrMeetingTopics(state);
    if (!topics.includes(input.meeting.topic)) return fail(state, "Choose a meeting topic.");
    const preferredError = validateMeetingSlot(input.meeting.preferred, "preferred");
    if (preferredError) return fail(state, preferredError);
    if (input.meeting.alternative) {
      const altError = validateMeetingSlot(input.meeting.alternative, "alternative");
      if (altError) return fail(state, altError);
    }
    const ms = normalizeMicrosoft365(state.microsoft365);
    meeting = {
      requestType: input.meeting.requestType === "phone" ? "phone" : "teams",
      topic: input.meeting.topic,
      preferred: input.meeting.preferred,
      alternative: input.meeting.alternative ?? null,
      confirmed: null,
      originalPreferred: input.meeting.preferred,
      contactNote: (input.meeting.contactNote || "").trim(),
      meetingStatus: "awaiting_hr",
      organizerEmail: ms.defaultOrganizerEmail || null,
      organizerEmployeeId: null,
      graphEventId: null,
      joinUrl: null,
      webLink: null,
      calendarSyncStatus: "idle",
      syncAttemptCount: 0,
      lastSyncError: null,
      lastSyncedAt: null,
      idempotencyKey: uid("meet"),
      hrResponse: "",
      pendingSyncAction: null,
    };
  }

  const count = state.tickets.length + 2401;
  const id = uid("tck");
  const category = kind === "hr_meeting" ? "HR" : input.category;
  const assigneeId = defaultAssignee(state, category);
  const ticket: Ticket = {
    id,
    number: `TCK-${count}`,
    employeeId: actor.id,
    subject: input.subject.trim(),
    description: input.description.trim(),
    category,
    priority: input.priority,
    status: "open",
    assigneeId,
    attachmentName: input.attachmentName,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    history: [hist(actor.id, "Opened", kind === "hr_meeting" ? "HR meeting request submitted. The preferred time is not confirmed until HR approves it." : input.description.trim())],
    kind,
    meeting,
  };
  const hrManagers = kind === "hr_meeting"
    ? state.employees.filter((item) => item.status === "active" && canManageHrMeeting(state, item) && item.id !== actor.id)
    : [];
  const notes = kind === "hr_meeting"
    ? hrManagers.map((item) => ({
        userId: item.id,
        title: "New HR meeting request",
        body: `${fullName(actor)} requested an HR ${meeting?.requestType === "phone" ? "call" : "Teams meeting"} (${meeting?.topic}). Preferred time is not confirmed yet.`,
        href: `/tickets/meetings?focus=${id}`,
        kind: "ticket" as const,
      }))
    : assigneeId
      ? [{ userId: assigneeId, title: "New ticket", body: `${fullName(actor)} opened “${ticket.subject}”.`, href: `/tickets/${id}`, kind: "ticket" as const }]
      : [];
  return ok(pushNotes(pushAudit({ ...state, tickets: [ticket, ...state.tickets] }, actor.id, "tickets", `Opened ticket ${ticket.number}.`), notes), kind === "hr_meeting" ? "HR meeting request submitted." : "Ticket created.", id);
}

function resolveOrganizerEmail(state: AppState, requested: string | null | undefined): { ok: true; email: string } | { ok: false; message: string } {
  const ms = normalizeMicrosoft365(state.microsoft365);
  const email = (requested || ms.defaultOrganizerEmail || "").trim().toLowerCase();
  if (!email) return { ok: false, message: "Configure an HR organizer mailbox in Settings → Integrations." };
  if (ms.allowedOrganizerEmails.length && !ms.allowedOrganizerEmails.includes(email)) {
    return { ok: false, message: "That organizer mailbox is not on the approved HR list." };
  }
  return { ok: true, email };
}

function patchMeetingTicket(ticket: Ticket, meeting: HrMeetingDetails, history: HistoryEvent, ticketStatus?: TicketStatus): Ticket {
  return {
    ...ticket,
    status: ticketStatus ?? ticket.status,
    meeting,
    updatedAt: nowIso(),
    history: [...ticket.history, history],
  };
}

export function approveHrMeeting(
  state: AppState,
  id: string,
  input: { organizerEmail?: string; slot?: HrMeetingSlot | null; response?: string } = {},
): Outcome {
  const actor = requireUser(state, "meetings.manage");
  if (!isEmployee(actor)) return actor;
  if (!canManageHrMeeting(state, actor)) return fail(state, "Only authorized HR can approve meeting requests.", true);
  const ticket = state.tickets.find((item) => item.id === id);
  if (!ticket || !isHrMeetingTicket(ticket) || !ticket.meeting) return fail(state, "That HR meeting request was not found.", true);
  const meeting = ticket.meeting;
  if (meeting.meetingStatus === "rejected" || meeting.meetingStatus === "cancelled") {
    return fail(state, "This request is closed.");
  }
  if (meeting.meetingStatus === "scheduled" && meeting.calendarSyncStatus === "synced") {
    return fail(state, "This meeting is already scheduled. Use reschedule to change the time.");
  }
  const slot = input.slot ?? meeting.preferred;
  const slotError = validateMeetingSlot(slot, "confirmed");
  if (slotError) return fail(state, slotError);
  const organizer = resolveOrganizerEmail(state, input.organizerEmail ?? meeting.organizerEmail);
  if (!organizer.ok) return fail(state, organizer.message);
  const response = (input.response || "").trim();
  const nextMeeting: HrMeetingDetails = {
    ...meeting,
    confirmed: slot,
    organizerEmail: organizer.email,
    organizerEmployeeId: actor.id,
    meetingStatus: "approved_sync_pending",
    calendarSyncStatus: "pending",
    pendingSyncAction: meeting.graphEventId ? "update" : "create",
    hrResponse: response || meeting.hrResponse,
    lastSyncError: null,
    joinUrl: meeting.graphEventId ? meeting.joinUrl : null,
  };
  const tickets = state.tickets.map((item) =>
    item.id === id
      ? patchMeetingTicket(
          item,
          nextMeeting,
          hist(actor.id, "Approved", `Approved for ${formatMeetingSlot(slot)}. Calendar sync pending.${response ? ` Note: ${response}` : ""}`),
          "in_progress",
        )
      : item,
  );
  const notes = [{
    userId: ticket.employeeId,
    title: "HR meeting approved",
    body: `Your request was approved for ${formatMeetingSlot(slot)}. Calendar sync is pending — the meeting is not confirmed in Teams until sync succeeds.`,
    href: `/tickets/${id}`,
    kind: "ticket" as const,
  }];
  return ok(pushNotes(pushAudit({ ...state, tickets }, actor.id, "tickets", `Approved HR meeting ${ticket.number}.`), notes), "Approved. Calendar sync queued.");
}

export function rescheduleHrMeeting(
  state: AppState,
  id: string,
  input: { slot: HrMeetingSlot; response?: string; organizerEmail?: string },
): Outcome {
  const actor = requireUser(state, "meetings.manage");
  if (!isEmployee(actor)) return actor;
  if (!canManageHrMeeting(state, actor)) return fail(state, "Only authorized HR can reschedule meetings.", true);
  const ticket = state.tickets.find((item) => item.id === id);
  if (!ticket || !isHrMeetingTicket(ticket) || !ticket.meeting) return fail(state, "That HR meeting request was not found.", true);
  const meeting = ticket.meeting;
  if (meeting.meetingStatus === "rejected" || meeting.meetingStatus === "cancelled") {
    return fail(state, "This request is closed.");
  }
  const slotError = validateMeetingSlot(input.slot, "reschedule");
  if (slotError) return fail(state, slotError);
  const organizer = resolveOrganizerEmail(state, input.organizerEmail ?? meeting.organizerEmail);
  if (!organizer.ok) return fail(state, organizer.message);
  const response = (input.response || "").trim();
  if (!response) return fail(state, "Add a short note explaining the new time.");
  const nextMeeting: HrMeetingDetails = {
    ...meeting,
    confirmed: input.slot,
    preferred: meeting.preferred,
    originalPreferred: meeting.originalPreferred || meeting.preferred,
    organizerEmail: organizer.email,
    organizerEmployeeId: actor.id,
    meetingStatus: "rescheduled_sync_pending",
    calendarSyncStatus: "pending",
    pendingSyncAction: meeting.graphEventId ? "update" : "create",
    hrResponse: response,
    lastSyncError: null,
  };
  const tickets = state.tickets.map((item) =>
    item.id === id
      ? patchMeetingTicket(
          item,
          nextMeeting,
          hist(actor.id, "Rescheduled", `New time ${formatMeetingSlot(input.slot)}. Original preferred ${formatMeetingSlot(meeting.originalPreferred || meeting.preferred)}. ${response}`),
          "in_progress",
        )
      : item,
  );
  const notes = [{
    userId: ticket.employeeId,
    title: "HR meeting rescheduled",
    body: `HR proposed ${formatMeetingSlot(input.slot)}. Calendar sync is pending.`,
    href: `/tickets/${id}`,
    kind: "ticket" as const,
  }];
  return ok(pushNotes(pushAudit({ ...state, tickets }, actor.id, "tickets", `Rescheduled HR meeting ${ticket.number}.`), notes), "Rescheduled. Calendar sync queued.");
}

export function rejectHrMeeting(state: AppState, id: string, response: string): Outcome {
  const actor = requireUser(state, "meetings.manage");
  if (!isEmployee(actor)) return actor;
  if (!canManageHrMeeting(state, actor)) return fail(state, "Only authorized HR can reject meeting requests.", true);
  const ticket = state.tickets.find((item) => item.id === id);
  if (!ticket || !isHrMeetingTicket(ticket) || !ticket.meeting) return fail(state, "That HR meeting request was not found.", true);
  const meeting = ticket.meeting;
  if (meeting.meetingStatus === "scheduled" && meeting.graphEventId) {
    return fail(state, "Cancel the scheduled meeting instead of rejecting it.");
  }
  const note = response.trim();
  if (note.length < 5) return fail(state, "Add a response for the employee (at least a short sentence).");
  const nextMeeting: HrMeetingDetails = {
    ...meeting,
    meetingStatus: "rejected",
    calendarSyncStatus: meeting.calendarSyncStatus === "synced" ? meeting.calendarSyncStatus : "idle",
    pendingSyncAction: null,
    confirmed: null,
    joinUrl: null,
    hrResponse: note,
    lastSyncError: null,
  };
  const tickets = state.tickets.map((item) =>
    item.id === id ? patchMeetingTicket(item, nextMeeting, hist(actor.id, "Rejected", note), "resolved") : item,
  );
  const notes = [{
    userId: ticket.employeeId,
    title: "HR meeting request declined",
    body: note,
    href: `/tickets/${id}`,
    kind: "ticket" as const,
  }];
  return ok(pushNotes(pushAudit({ ...state, tickets }, actor.id, "tickets", `Rejected HR meeting ${ticket.number}.`), notes), "Request rejected.");
}

export function cancelHrMeeting(state: AppState, id: string, reason: string): Outcome {
  const actor = requireUser(state);
  if (!isEmployee(actor)) return actor;
  const ticket = state.tickets.find((item) => item.id === id);
  if (!ticket || !isHrMeetingTicket(ticket) || !ticket.meeting) return fail(state, "That HR meeting request was not found.", true);
  const meeting = ticket.meeting;
  const owner = ticket.employeeId === actor.id;
  const hr = canManageHrMeeting(state, actor);
  if (!owner && !hr) return fail(state, "You can't cancel this meeting.", true);
  if (meeting.meetingStatus === "cancelled" || meeting.meetingStatus === "rejected") {
    return fail(state, "This request is already closed.");
  }
  const note = reason.trim();
  if (note.length < 5) return fail(state, "Add a cancellation reason.");
  const needsSync = Boolean(meeting.graphEventId);
  const nextMeeting: HrMeetingDetails = {
    ...meeting,
    meetingStatus: "cancelled",
    calendarSyncStatus: needsSync ? "pending" : "cancelled",
    pendingSyncAction: needsSync ? "cancel" : null,
    hrResponse: note,
    joinUrl: needsSync ? meeting.joinUrl : null,
    lastSyncError: null,
  };
  const tickets = state.tickets.map((item) =>
    item.id === id
      ? patchMeetingTicket(item, nextMeeting, hist(actor.id, "Cancelled", note), "resolved")
      : item,
  );
  const notifyIds = owner
    ? state.employees.filter((item) => canManageHrMeeting(state, item) && item.id !== actor.id).map((item) => item.id)
    : [ticket.employeeId];
  const notes = notifyIds.map((userId) => ({
    userId,
    title: "HR meeting cancelled",
    body: note,
    href: `/tickets/${id}`,
    kind: "ticket" as const,
  }));
  return ok(
    pushNotes(pushAudit({ ...state, tickets }, actor.id, "tickets", `Cancelled HR meeting ${ticket.number}.`), notes),
    needsSync ? "Cancelled. Calendar sync queued." : "Meeting request cancelled.",
  );
}

export function retryHrMeetingSync(state: AppState, id: string): Outcome {
  const actor = requireUser(state, "meetings.manage");
  if (!isEmployee(actor)) return actor;
  if (!canManageHrMeeting(state, actor)) return fail(state, "Only authorized HR can retry calendar sync.", true);
  const ticket = state.tickets.find((item) => item.id === id);
  if (!ticket || !isHrMeetingTicket(ticket) || !ticket.meeting) return fail(state, "That HR meeting request was not found.", true);
  const meeting = ticket.meeting;
  if (meeting.meetingStatus === "rejected") return fail(state, "Rejected requests do not sync to the calendar.");
  let pending: HrMeetingDetails["pendingSyncAction"] = meeting.pendingSyncAction;
  let meetingStatus = meeting.meetingStatus;
  if (meeting.meetingStatus === "cancelled") {
    pending = meeting.graphEventId ? "cancel" : null;
  } else if (meeting.confirmed) {
    pending = meeting.graphEventId ? "update" : "create";
    meetingStatus = meeting.graphEventId ? "rescheduled_sync_pending" : "approved_sync_pending";
  } else {
    return fail(state, "Approve or reschedule before syncing the calendar.");
  }
  if (!pending) return fail(state, "Nothing to sync for this request.");
  const nextMeeting: HrMeetingDetails = {
    ...meeting,
    meetingStatus,
    calendarSyncStatus: "pending",
    pendingSyncAction: pending,
    lastSyncError: null,
  };
  const tickets = state.tickets.map((item) =>
    item.id === id ? patchMeetingTicket(item, nextMeeting, hist(actor.id, "Sync retry", "Calendar synchronization queued again.")) : item,
  );
  return ok(pushNotes(pushAudit({ ...state, tickets }, actor.id, "tickets", `Retried calendar sync for ${ticket.number}.`), []), "Calendar sync queued.");
}

export function requestHrMeetingChange(state: AppState, id: string, note: string): Outcome {
  const actor = requireUser(state, "tickets.self");
  if (!isEmployee(actor)) return actor;
  const ticket = state.tickets.find((item) => item.id === id);
  if (!ticket || !isHrMeetingTicket(ticket) || !ticket.meeting) return fail(state, "That HR meeting request was not found.", true);
  if (ticket.employeeId !== actor.id) return fail(state, "Only the requester can ask for a change.", true);
  const meeting = ticket.meeting;
  if (meeting.meetingStatus === "rejected" || meeting.meetingStatus === "cancelled") {
    return fail(state, "This request is closed.");
  }
  const body = note.trim();
  if (body.length < 5) return fail(state, "Describe the change you need.");
  const tickets = state.tickets.map((item) =>
    item.id === id
      ? {
          ...item,
          status: "waiting" as const,
          updatedAt: nowIso(),
          history: [...item.history, hist(actor.id, "Change requested", body)],
          meeting: { ...meeting, hrResponse: meeting.hrResponse },
        }
      : item,
  );
  const notes = state.employees
    .filter((item) => canManageHrMeeting(state, item))
    .map((item) => ({
      userId: item.id,
      title: "HR meeting change requested",
      body: `${fullName(actor)} asked to change ${ticket.number}.`,
      href: `/tickets/meetings?focus=${id}`,
      kind: "ticket" as const,
    }));
  return ok(pushNotes({ ...state, tickets }, notes), "Change request sent to HR.");
}

export function saveMicrosoft365(state: AppState, patch: Partial<Microsoft365Config>): Outcome {
  const actor = requireUser(state, "settings.org");
  if (!isEmployee(actor)) return actor;
  const current = normalizeMicrosoft365(state.microsoft365);
  const allowed = Array.isArray(patch.allowedOrganizerEmails)
    ? patch.allowedOrganizerEmails.map((item) => String(item).trim().toLowerCase()).filter(Boolean)
    : current.allowedOrganizerEmails;
  const defaultOrganizer = patch.defaultOrganizerEmail !== undefined
    ? String(patch.defaultOrganizerEmail).trim().toLowerCase()
    : current.defaultOrganizerEmail;
  const next = normalizeMicrosoft365({
    ...current,
    enabled: patch.enabled !== undefined ? Boolean(patch.enabled) : current.enabled,
    tenantId: patch.tenantId !== undefined ? String(patch.tenantId).trim() : current.tenantId,
    clientId: patch.clientId !== undefined ? String(patch.clientId).trim() : current.clientId,
    defaultOrganizerEmail: defaultOrganizer,
    allowedOrganizerEmails: allowed.length ? allowed : (defaultOrganizer ? [defaultOrganizer] : []),
    demoMode: patch.demoMode !== undefined ? Boolean(patch.demoMode) : current.demoMode,
    lastHealthCheck: current.lastHealthCheck,
  });
  return ok(
    pushAudit({ ...state, microsoft365: next }, actor.id, "settings", "Updated Microsoft 365 / Teams calendar settings."),
    "Microsoft 365 settings saved.",
  );
}

export function recordMicrosoft365Health(
  state: AppState,
  check: { ok: boolean; message: string },
): Outcome {
  const actor = requireUser(state, "settings.org");
  if (!isEmployee(actor)) return actor;
  const current = normalizeMicrosoft365(state.microsoft365);
  return ok({
    ...state,
    microsoft365: {
      ...current,
      lastHealthCheck: { ok: check.ok, at: nowIso(), message: check.message },
    },
  });
}

export function addTicketComment(state: AppState, id: string, body: string): Outcome {
  const actor = requireUser(state);
  if (!isEmployee(actor)) return actor;
  const ticket = state.tickets.find((item) => item.id === id);
  if (!ticket) return fail(state, "That ticket was not found.", true);
  const owner = ticket.employeeId === actor.id;
  if (!owner && !canManageTicket(state, actor, ticket)) return fail(state, "You can't comment on this ticket.", true);
  if (body.trim().length < 2) return fail(state, "Write a comment before sending.");
  let status = ticket.status;
  if (owner && ticket.status === "waiting") status = "in_progress";
  const tickets = state.tickets.map((item) =>
    item.id === id
      ? { ...item, status, updatedAt: nowIso(), history: [...item.history, hist(actor.id, owner && ticket.status === "waiting" ? "Replied" : "Comment", body.trim())] }
      : item,
  );
  const target = owner ? ticket.assigneeId : ticket.employeeId;
  const notes = target && target !== actor.id ? [{ userId: target, title: "Ticket updated", body: `${fullName(actor)} commented on ${ticket.number}.`, href: `/tickets/${id}`, kind: "ticket" as const }] : [];
  return ok(pushNotes({ ...state, tickets }, notes), "Comment added.");
}

export function updateTicket(state: AppState, id: string, patch: { status?: TicketStatus; assigneeId?: string | null; priority?: TicketPriority }): Outcome {
  const actor = requireUser(state);
  if (!isEmployee(actor)) return actor;
  const ticket = state.tickets.find((item) => item.id === id);
  if (!ticket) return fail(state, "That ticket was not found.", true);
  if (!canManageTicket(state, actor, ticket)) return fail(state, "You can't update this ticket.", true);
  const status = patch.status ?? ticket.status;
  const assigneeId = patch.assigneeId === undefined ? ticket.assigneeId : patch.assigneeId;
  const priority = patch.priority ?? ticket.priority;
  const events = [...ticket.history];
  if (status !== ticket.status) events.push(hist(actor.id, "Status", `Status set to ${status.replaceAll("_", " ")}.`));
  if (assigneeId !== ticket.assigneeId) events.push(hist(actor.id, "Assigned", assigneeId ? `Assigned to ${name(state, assigneeId)}.` : "Unassigned."));
  if (priority !== ticket.priority) events.push(hist(actor.id, "Priority", `Priority set to ${priority}.`));
  const tickets = state.tickets.map((item) => (item.id === id ? { ...item, status, assigneeId, priority, updatedAt: nowIso(), history: events } : item));
  const notes: Array<Omit<AppNotification, "id" | "read" | "createdAt">> = [];
  if (status !== ticket.status) notes.push({ userId: ticket.employeeId, title: "Ticket status changed", body: `${ticket.number} is now ${status.replaceAll("_", " ")}.`, href: `/tickets/${id}`, kind: "ticket" });
  if (assigneeId && assigneeId !== ticket.assigneeId && assigneeId !== actor.id) notes.push({ userId: assigneeId, title: "Ticket assigned to you", body: ticket.subject, href: `/tickets/${id}`, kind: "ticket" });
  return ok(pushNotes(pushAudit({ ...state, tickets }, actor.id, "tickets", `Updated ticket ${ticket.number}.`), notes), "Ticket updated.");
}

export function reopenTicket(state: AppState, id: string): Outcome {
  const actor = requireUser(state);
  if (!isEmployee(actor)) return actor;
  const ticket = state.tickets.find((item) => item.id === id);
  if (!ticket || ticket.employeeId !== actor.id) return fail(state, "Only the requester can reopen this ticket.", true);
  if (ticket.status !== "resolved") return fail(state, "Only a resolved ticket can be reopened.", true);
  const tickets = state.tickets.map((item) => (item.id === id ? { ...item, status: "open" as const, updatedAt: nowIso(), history: [...item.history, hist(actor.id, "Reopened", "Reopened by the requester.")] } : item));
  const notes = ticket.assigneeId ? [{ userId: ticket.assigneeId, title: "Ticket reopened", body: `${ticket.number} was reopened.`, href: `/tickets/${id}`, kind: "ticket" as const }] : [];
  return ok(pushNotes({ ...state, tickets }, notes), "Ticket reopened.");
}

export interface AssetDraft {
  id?: string;
  brand: string;
  model: string;
  type: AssetType;
  serial: string;
  locationId: string;
  remarks: string;
  condition: AssetCondition;
  assignedTo: string | null;
}

export function saveAsset(state: AppState, input: AssetDraft): Outcome {
  const actor = requireUser(state, "assets.manage");
  if (!isEmployee(actor)) return actor;
  const brand = input.brand.trim();
  const model = input.model.trim();
  if (brand.length < 2) return fail(state, "Enter the brand. For a laptop, this is the laptop brand.");
  if (model.length < 1) return fail(state, "Enter the model.");
  if (!state.locations.some((item) => item.id === input.locationId)) return fail(state, "Choose a location.");
  const serial = input.serial.trim();
  if (serial && state.assets.some((item) => item.serial.toLowerCase() === serial.toLowerCase() && item.id !== input.id)) {
    return fail(state, "Another asset already uses this serial number.");
  }
  const assignee = input.assignedTo ? person(state, input.assignedTo) : null;
  if (input.assignedTo && (!assignee || assignee.status === "inactive")) return fail(state, "Choose an active employee, or set the asset to not assigned.");
  const name = `${brand} ${model}`.trim();
  const existing = input.id ? state.assets.find((item) => item.id === input.id) : undefined;
  if (input.id && !existing) return fail(state, "That asset was not found.", true);
  if (existing && existing.status === "retired") return fail(state, "A retired asset stays in the register as history. Add a new asset instead.");
  if (existing && existing.status === "repair" && assignee) return fail(state, "Return this asset from repair before assigning it.");

  if (!existing) {
    const tag = nextAssetTag(state, input.type);
    const asset: Asset = {
      id: uid("ast"),
      tag,
      name,
      type: input.type,
      brand,
      model,
      serial,
      locationId: input.locationId,
      remarks: input.remarks.trim(),
      status: assignee ? "assigned" : "available",
      condition: input.condition,
      assignedTo: assignee?.id ?? null,
      assignedAt: assignee ? todayIso() : null,
      returnedAt: null,
      acknowledged: false,
      history: [hist(actor.id, "Added to register", `${name} added to the register.${assignee ? ` Assigned to ${fullName(assignee)}.` : " Not assigned."}`)],
    };
    const notes = assignee ? [{ userId: assignee.id, title: "Asset assigned to you", body: `${asset.name} (${asset.tag}) needs your acknowledgement.`, href: `/assets/${asset.id}`, kind: "asset" as const }] : [];
    return ok(pushNotes(pushAudit({ ...state, assets: [asset, ...state.assets] }, actor.id, "assets", `Added asset ${tag}.`), notes), assignee ? "Asset added and assigned." : "Asset added to unassigned inventory.", asset.id);
  }

  const history = [...existing.history];
  let status = existing.status;
  let assignedTo = existing.assignedTo;
  let assignedAt = existing.assignedAt;
  let returnedAt = existing.returnedAt;
  let acknowledged = existing.acknowledged;
  const previous = existing.assignedTo ? person(state, existing.assignedTo) : null;
  if ((assignee?.id ?? null) !== existing.assignedTo) {
    if (assignee) {
      status = "assigned";
      assignedTo = assignee.id;
      assignedAt = todayIso();
      returnedAt = null;
      acknowledged = false;
      history.push(hist(actor.id, previous ? "Assignment changed" : "Assigned", previous ? `Assignment changed from ${fullName(previous)} to ${fullName(assignee)}.` : `Assigned to ${fullName(assignee)}.`));
    } else {
      status = "available";
      assignedTo = null;
      assignedAt = null;
      returnedAt = todayIso();
      acknowledged = false;
      history.push(hist(actor.id, "Assignment cleared", previous ? `Returned from ${fullName(previous)}. The asset is not assigned.` : "Marked not assigned."));
    }
  }
  history.push(hist(actor.id, "Edited", "Asset details updated."));
  const assets = state.assets.map((item) =>
    item.id === existing.id
      ? { ...item, name, type: input.type, brand, model, serial, locationId: input.locationId, remarks: input.remarks.trim(), condition: input.condition, status, assignedTo, assignedAt, returnedAt, acknowledged, history }
      : item,
  );
  const notes = assignee && assignee.id !== existing.assignedTo
    ? [{ userId: assignee.id, title: "Asset assigned to you", body: `${name} (${existing.tag}) needs your acknowledgement.`, href: `/assets/${existing.id}`, kind: "asset" as const }]
    : [];
  return ok(pushNotes(pushAudit({ ...state, assets }, actor.id, "assets", `Updated asset ${existing.tag}.`), notes), "Asset updated.", existing.id);
}

function nextAssetTag(state: AppState, type: AssetType): string {
  const prefix = type === "laptop" ? "LT" : type === "phone" ? "PH" : type === "monitor" ? "MN" : type === "access_card" ? "AC" : "OT";
  const numbers = state.assets.map((item) => Number(item.tag.replace(/\D/g, ""))).filter((item) => !Number.isNaN(item));
  return `BE-${prefix}-${Math.max(100, ...numbers, 0) + 1}`;
}

export function assignAsset(state: AppState, id: string, employeeId: string): Outcome {
  const actor = requireUser(state, "assets.manage");
  if (!isEmployee(actor)) return actor;
  const asset = state.assets.find((item) => item.id === id);
  const employee = person(state, employeeId);
  if (!asset || !employee) return fail(state, "Choose an available asset and an active employee.", true);
  if (asset.status !== "available") return fail(state, "Only an available asset can be assigned.", true);
  if (employee.status === "inactive") return fail(state, "Inactive employees can't receive assets.", true);
  const assets = state.assets.map((item) =>
    item.id === id
      ? { ...item, status: "assigned" as const, assignedTo: employeeId, assignedAt: todayIso(), returnedAt: null, acknowledged: false, history: [...item.history, hist(actor.id, "Assigned", `Assigned to ${fullName(employee)}.`)] }
      : item,
  );
  const next = pushNotes(pushAudit({ ...state, assets }, actor.id, "assets", `Assigned ${asset.tag} to ${fullName(employee)}.`), [
    { userId: employeeId, title: "Asset assigned to you", body: `${asset.name} (${asset.tag}) needs your acknowledgement.`, href: "/assets?tab=mine", kind: "asset" },
  ]);
  return ok(next, "Asset assigned. The employee has been asked to acknowledge it.");
}

export function acknowledgeAsset(state: AppState, id: string): Outcome {
  const actor = requireUser(state, "assets.self");
  if (!isEmployee(actor)) return actor;
  const unlinked = requireOwnRecord(state, actor);
  if (unlinked) return unlinked;
  const asset = state.assets.find((item) => item.id === id);
  if (!asset || asset.assignedTo !== actor.id) return fail(state, "This asset is not assigned to you.", true);
  if (asset.acknowledged) return fail(state, "You already acknowledged this asset.", true);
  const assets = state.assets.map((item) => (item.id === id ? { ...item, acknowledged: true, history: [...item.history, hist(actor.id, "Acknowledged", "Receipt acknowledged.")] } : item));
  return ok(pushAudit({ ...state, assets }, actor.id, "assets", `Acknowledged asset ${asset.tag}.`), "Asset acknowledged.");
}

export function transitionAsset(state: AppState, id: string, action: "return" | "repair" | "retire" | "transfer", comment: string, transferTo?: string): Outcome {
  const actor = requireUser(state, "assets.manage");
  if (!isEmployee(actor)) return actor;
  const asset = state.assets.find((item) => item.id === id);
  if (!asset) return fail(state, "That asset was not found.", true);
  if (comment.trim().length < 3) return fail(state, "Add a short note for the asset history.");
  if (action === "transfer") {
    const employee = person(state, transferTo ?? null);
    if (!employee || employee.status === "inactive") return fail(state, "Choose an active employee to transfer this asset to.");
    if (asset.status !== "assigned") return fail(state, "Only an assigned asset can be transferred.");
    const assets = state.assets.map((item) =>
      item.id === id
        ? { ...item, assignedTo: employee.id, assignedAt: todayIso(), acknowledged: false, history: [...item.history, hist(actor.id, "Transferred", `Transferred to ${fullName(employee)}. ${comment.trim()}`)] }
        : item,
    );
    return ok(pushNotes(pushAudit({ ...state, assets }, actor.id, "assets", `Transferred ${asset.tag} to ${fullName(employee)}.`), [
      { userId: employee.id, title: "Asset transferred to you", body: `${asset.name} needs your acknowledgement.`, href: "/assets?tab=mine", kind: "asset" },
    ]), "Asset transferred.");
  }
  if (action === "return" && asset.status !== "assigned") return fail(state, "Only an assigned asset can be returned.");
  if (action === "repair" && asset.status === "retired") return fail(state, "A retired asset can't be sent for repair.");
  if (action === "retire" && asset.status === "retired") return fail(state, "This asset is already retired.");
  const status = action === "return" ? "available" : action === "repair" ? "repair" : "retired";
  const label = action === "return" ? "Returned" : action === "repair" ? "Sent for repair" : "Retired";
  const assets = state.assets.map((item) =>
    item.id === id
      ? { ...item, status: status as Asset["status"], assignedTo: null, assignedAt: null, returnedAt: action === "retire" ? item.returnedAt ?? todayIso() : todayIso(), acknowledged: false, history: [...item.history, hist(actor.id, label, comment.trim())] }
      : item,
  );
  return ok(pushAudit({ ...state, assets }, actor.id, "assets", `${label} asset ${asset.tag}.`), `${label}.`);
}

export function saveEmployee(state: AppState, draft: EmployeeDraft): Outcome {
  const actor = requireUser(state, "people.manage");
  if (!isEmployee(actor)) return actor;
  if (draft.firstName.trim().length < 2 || draft.lastName.trim().length < 1) return fail(state, "Enter the employee's first and last name.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) return fail(state, "Enter a valid work email.");
  if (state.employees.some((item) => item.email.toLowerCase() === draft.email.trim().toLowerCase() && item.id !== draft.id)) {
    return fail(state, "Another employee already uses this email.");
  }
  if (!draft.jobTitle.trim() || !draft.departmentId || !draft.locationId || !draft.joiningDate) return fail(state, "Job title, department, location, and joining date are required.");
  if (!draft.dateOfBirth || draft.dateOfBirth > todayIso()) return fail(state, "Enter a valid date of birth. Birthday visibility can be turned off.");
  if (draft.managerId && !person(state, draft.managerId)) return fail(state, "Choose a valid manager.");
  if (draft.id && createsCycle(state.employees, draft.id, draft.managerId)) return fail(state, "That reporting line would make this person their own manager. Choose someone else.");
  if (draft.id && draft.id === draft.managerId) return fail(state, "An employee can't report to themselves.");
  const existing = draft.id ? person(state, draft.id) : null;
  if (draft.id && !existing) return fail(state, "That employee was not found.");
  if (existing && draft.status === "inactive" && existing.id === actor.id) return fail(state, "You can't deactivate your own record.");
  const numbers = state.employees.map((item) => Number(item.employeeCode.replace(/\D/g, ""))).filter((item) => !Number.isNaN(item));
  const role = hasPermission(state, actor, "settings.roles") && draft.role ? draft.role : existing?.role ?? "employee";
  const saved: Employee = {
    id: existing?.id ?? uid("emp"),
    employeeCode: existing?.employeeCode ?? `BE-${Math.max(1000, ...numbers) + 1}`,
    firstName: draft.firstName.trim(),
    lastName: draft.lastName.trim(),
    email: draft.email.trim().toLowerCase(),
    role,
    jobTitle: draft.jobTitle.trim(),
    departmentId: draft.departmentId,
    managerId: draft.managerId,
    locationId: draft.locationId,
    employmentType: draft.employmentType,
    status: draft.status,
    joiningDate: draft.joiningDate,
    phone: draft.phone.trim(),
    personalEmail: draft.personalEmail.trim(),
    address: draft.address.trim(),
    emergencyName: draft.emergencyName.trim(),
    emergencyRelationship: (draft.emergencyRelationship ?? existing?.emergencyRelationship ?? "").trim(),
    emergencyPhone: draft.emergencyPhone.trim(),
    emergencySecondaryName: (draft.emergencySecondaryName ?? existing?.emergencySecondaryName ?? "").trim(),
    emergencySecondaryRelationship: (draft.emergencySecondaryRelationship ?? existing?.emergencySecondaryRelationship ?? "").trim(),
    emergencySecondaryPhone: (draft.emergencySecondaryPhone ?? existing?.emergencySecondaryPhone ?? "").trim(),
    dateOfBirth: draft.dateOfBirth,
    showBirthday: draft.showBirthday,
    monthlyGross: draft.monthlyGross !== undefined && hasPermission(state, actor, "people.compensation") ? draft.monthlyGross : existing?.monthlyGross ?? 0,
    avatarColor: existing?.avatarColor ?? avatarColorAt(state.employees.length),
    photoUpdatedAt: existing?.photoUpdatedAt ?? null,
  };
  const employees = existing ? state.employees.map((item) => (item.id === saved.id ? saved : item)) : [...state.employees, saved];
  const verb = !existing ? "Added" : draft.status === "inactive" && existing.status !== "inactive" ? "Deactivated" : "Updated";
  const linked = state.accounts.some((item) => item.employeeId === saved.id);
  const sameEmail = state.accounts.find((item) => item.email === saved.email);
  let accounts = state.accounts;
  let loginNote = "";
  if (hasPermission(state, actor, "users.manage") && !linked && !sameEmail) {
    const stamp = nowIso();
    accounts = [{
      id: uid("usr"),
      email: saved.email,
      displayName: fullName(saved),
      role: saved.role,
      status: "invited",
      departmentId: saved.departmentId,
      employeeId: saved.id,
      createdAt: stamp,
      updatedAt: stamp,
      invitedAt: stamp,
      activatedAt: null,
      suspendedAt: null,
      deactivatedAt: null,
      passwordHash: null,
    }, ...state.accounts];
    loginNote = ` ${saved.email} can sign in and choose a password. No email is sent.`;
  }
  const summary = `${verb} the employee record for ${fullName(saved)}.${loginNote}`;
  return ok(pushAudit({ ...state, employees, accounts }, actor.id, "people", summary), `${verb} ${fullName(saved)}.${loginNote}`, saved.id);
}

export function deleteEmployee(state: AppState, id: string): Outcome {
  const actor = requireUser(state, "people.manage");
  if (!isEmployee(actor)) return actor;
  const employee = person(state, id);
  if (!employee) return fail(state, "That employee was not found.", true);
  if (employee.id === actor.id) return fail(state, "You can't delete your own record.", true);
  if (state.employees.some((item) => item.managerId === employee.id)) {
    return fail(state, "Choose a new manager for the people who report to this employee before deleting them.", true);
  }
  const reasons: string[] = [];
  if (state.attendance.some((item) => item.employeeId === id) || state.regularizations.some((item) => item.employeeId === id)) reasons.push("attendance");
  if (state.leaveRequests.some((item) => item.employeeId === id) || state.compOff.some((item) => item.employeeId === id)) reasons.push("leave");
  if (state.expenses.some((item) => item.employeeId === id) || state.insurance.some((item) => item.employeeId === id)) reasons.push("expenses");
  if (state.tickets.some((item) => item.employeeId === id || item.assigneeId === id)) reasons.push("tickets");
  if (state.assets.some((item) => item.assignedTo === id)) reasons.push("assigned assets");
  if (state.documents.some((item) => item.employeeId === id)) reasons.push("documents");
  if (state.acknowledgements.some((item) => item.employeeId === id)) reasons.push("policy acknowledgements");
  if (state.payslips.some((item) => item.employeeId === id) || state.payrollRuns.some((run) => run.lines.some((line) => line.employeeId === id))) reasons.push("payroll");
  if (reasons.length > 0) {
    return fail(state, `${fullName(employee)} has ${reasons.join(", ")} on record. Set their status to Inactive instead of deleting them.`, true);
  }
  const account = state.accounts.find((item) => item.employeeId === id || item.email === employee.email);
  if (account && blocksLastAdmin(state, account, account.role, "deactivated")) {
    return fail(state, "The last active System admin can't be deleted.", true);
  }
  const next: AppState = {
    ...state,
    employees: state.employees.filter((item) => item.id !== id),
    accounts: account ? state.accounts.filter((item) => item.id !== account.id) : state.accounts,
    notifications: state.notifications.filter((item) => item.userId !== id && item.userId !== account?.id),
    currentUserId: state.currentUserId === account?.id ? null : state.currentUserId,
  };
  const login = account ? " and their login" : "";
  return ok(pushAudit(next, actor.id, "people", `Deleted the employee record for ${fullName(employee)}${login}.`), `${fullName(employee)} was removed from the directory.`);
}

export function updateCompensation(state: AppState, employeeId: string, monthlyGross: number): Outcome {
  const actor = requireUser(state, "people.compensation");
  if (!isEmployee(actor)) return actor;
  if (!person(state, employeeId)) return fail(state, "That employee was not found.", true);
  if (monthlyGross < 0 || Number.isNaN(monthlyGross)) return fail(state, "Enter a monthly gross of zero or more.");
  const employees = state.employees.map((item) => (item.id === employeeId ? { ...item, monthlyGross: Math.round(monthlyGross) } : item));
  return ok(pushAudit({ ...state, employees }, actor.id, "payroll", `Updated the monthly gross for ${name(state, employeeId)}.`, "payroll"), "Compensation updated. Refresh open payroll runs to pick it up.");
}

export function updateProfile(state: AppState, draft: ProfileDraft): Outcome {
  const actor = requireUser(state);
  if (!isEmployee(actor)) return actor;
  const unlinked = requireOwnRecord(state, actor);
  if (unlinked) return unlinked;
  if (draft.phone.trim().length < 6) return fail(state, "Enter a phone number.");
  const employees = state.employees.map((item) =>
    item.id === actor.id
      ? {
          ...item,
          phone: draft.phone.trim(),
          personalEmail: draft.personalEmail.trim(),
          address: draft.address.trim(),
          emergencyName: draft.emergencyName.trim(),
          emergencyRelationship: draft.emergencyRelationship.trim(),
          emergencyPhone: draft.emergencyPhone.trim(),
          emergencySecondaryName: draft.emergencySecondaryName.trim(),
          emergencySecondaryRelationship: draft.emergencySecondaryRelationship.trim(),
          emergencySecondaryPhone: draft.emergencySecondaryPhone.trim(),
          showBirthday: draft.showBirthday,
        }
      : item,
  );
  return ok(pushAudit({ ...state, employees }, actor.id, "people", "Updated own profile preferences."), "Profile saved.");
}

export function setEmployeePhoto(state: AppState, employeeId: string, photoUpdatedAt: string | null): Outcome {
  const actor = requireUser(state);
  if (!isEmployee(actor)) return actor;
  const employee = person(state, employeeId);
  if (!employee) return fail(state, "That employee was not found.", true);
  const self = actor.id === employeeId;
  if (!self && !hasPermission(state, actor, "people.manage")) return fail(state, "You don't have permission to change this photo.", true);
  if ((employee.photoUpdatedAt ?? null) === photoUpdatedAt) return ok(state);
  const employees = state.employees.map((item) => (item.id === employeeId ? { ...item, photoUpdatedAt } : item));
  const summary = photoUpdatedAt ? `Updated the profile photo for ${fullName(employee)}.` : `Removed the profile photo for ${fullName(employee)}.`;
  return ok(pushAudit({ ...state, employees }, actor.id, "people", summary), photoUpdatedAt ? "Profile photo saved." : "Profile photo removed.");
}

export function createPayrollRun(state: AppState, year: number, monthIndex: number): Outcome {
  const actor = requireUser(state, "payroll.manage");
  if (!isEmployee(actor)) return actor;
  const period = periodForMonth(year, monthIndex, state.settings);
  if (state.payrollRuns.some((item) => item.periodStart === period.start && item.periodEnd === period.end && item.status !== "failed")) {
    return fail(state, "A payroll run already exists for this period.");
  }
  const built = buildPayrollLines(state, period.start, period.end);
  const run: PayrollRun = {
    id: uid("pay"),
    periodStart: period.start,
    periodEnd: period.end,
    excludedDates: period.excluded,
    status: "draft",
    createdAt: nowIso(),
    createdBy: actor.id,
    updatedAt: nowIso(),
    finalizedAt: null,
    finalizedBy: null,
    paidAt: null,
    warnings: [...periodWarnings(period.excluded, state.settings), ...built.warnings],
    lines: built.lines,
    calculatedAt: null,
    verifiedAt: null,
    verifiedBy: null,
    verifyNote: "",
    paymentReference: null,
    paymentNote: null,
    recalcRequired: false,
    importHistory: [],
  };
  return ok(pushAudit({ ...state, payrollRuns: [run, ...state.payrollRuns] }, actor.id, "payroll", `Created a draft payroll run for ${rangeLabel(period.start, period.end)}.`, "payroll"), "Draft payroll run created.", run.id);
}

export function refreshPayrollRun(state: AppState, runId: string): Outcome {
  const actor = requireUser(state, "payroll.manage");
  if (!isEmployee(actor)) return actor;
  const run = state.payrollRuns.find((item) => item.id === runId);
  if (!run) return fail(state, "That payroll run was not found.", true);
  if (run.status === "finalized" || run.status === "paid") return fail(state, "Finalized payroll is locked. Refresh is available only before approval.", true);
  const built = buildPayrollLines(state, run.periodStart, run.periodEnd, run.id);
  const lines = applyAdjustments(built.lines, run.lines).map((line) => normalizeLine(line, state.settings));
  const payrollRuns = state.payrollRuns.map((item) =>
    item.id === runId
      ? {
          ...item,
          lines,
          warnings: [...periodWarnings(item.excludedDates, state.settings), ...built.warnings],
          updatedAt: nowIso(),
          status: item.status === "calculated" || item.status === "verified" || item.status === "in_review" ? "draft" : item.status,
          recalcRequired: false,
          calculatedAt: null,
          verifiedAt: null,
          verifiedBy: null,
        }
      : item,
  );
  return ok(pushAudit({ ...state, payrollRuns }, actor.id, "payroll", `Refreshed payroll inputs for ${rangeLabel(run.periodStart, run.periodEnd)}.`, "payroll"), "Inputs refreshed from attendance, leave, and approved expenses.");
}

export function calculatePayrollRun(state: AppState, runId: string): Outcome {
  const actor = requireUser(state, "payroll.manage");
  if (!isEmployee(actor)) return actor;
  const run = state.payrollRuns.find((item) => item.id === runId);
  if (!run) return fail(state, "That payroll run was not found.", true);
  if (run.status === "finalized" || run.status === "paid") return fail(state, "This run is locked.", true);
  const built = buildPayrollLines(state, run.periodStart, run.periodEnd, run.id);
  const lines = applyAdjustments(built.lines, run.lines).map((line) => normalizeLine({ ...line, needsRecalc: false }, state.settings));
  const at = nowIso();
  const payrollRuns = state.payrollRuns.map((item) =>
    item.id === runId
      ? {
          ...item,
          status: "calculated" as const,
          lines,
          warnings: [...periodWarnings(item.excludedDates, state.settings), ...built.warnings],
          updatedAt: at,
          calculatedAt: at,
          recalcRequired: false,
        }
      : item,
  );
  return ok(pushAudit({ ...state, payrollRuns }, actor.id, "payroll", `Calculated payroll for ${rangeLabel(run.periodStart, run.periodEnd)}.`, "payroll"), "Payroll calculated. Review employee rows before verification.");
}

export function verifyPayrollRun(state: AppState, runId: string, note: string): Outcome {
  const actor = requireUser(state, "payroll.manage");
  if (!isEmployee(actor)) return actor;
  const run = state.payrollRuns.find((item) => item.id === runId);
  if (!run) return fail(state, "That payroll run was not found.", true);
  if (!(run.status === "calculated" || run.status === "in_review")) return fail(state, "Verify after the run is calculated or in review.", true);
  if (run.recalcRequired) return fail(state, "Recalculate this run before verifying. Inputs changed after the last calculation.", true);
  const at = nowIso();
  const payrollRuns = state.payrollRuns.map((item) =>
    item.id === runId ? { ...item, status: "verified" as const, verifiedAt: at, verifiedBy: actor.id, verifyNote: note.trim(), updatedAt: at } : item,
  );
  return ok(pushAudit({ ...state, payrollRuns }, actor.id, "payroll", `Verified payroll for ${rangeLabel(run.periodStart, run.periodEnd)}.`, "payroll"), "Payroll verified.");
}

export type PayrollLinePatch = {
  adjustment?: number;
  adjustmentReason?: string;
  overtime?: number;
  extras?: number;
  arrears?: number;
  pf?: number;
  esic?: number;
  penalties?: number;
  loan?: number;
  otherDeductions?: number;
};

export function updatePayrollLine(state: AppState, runId: string, employeeId: string, adjustment: number, reason: string, patch: PayrollLinePatch = {}): Outcome {
  const actor = requireUser(state, "payroll.manage");
  if (!isEmployee(actor)) return actor;
  const run = state.payrollRuns.find((item) => item.id === runId);
  if (!run) return fail(state, "That payroll run was not found.", true);
  if (run.status === "finalized" || run.status === "paid") return fail(state, "This run is locked.", true);
  if (Number.isNaN(adjustment)) return fail(state, "Enter a valid adjustment amount.");
  if (adjustment !== 0 && reason.trim().length < 8) return fail(state, "Add a short reason for the manual adjustment.");
  const moneyFields = ["overtime", "extras", "arrears", "pf", "esic", "penalties", "loan", "otherDeductions"] as const;
  for (const key of moneyFields) {
    const value = patch[key];
    if (value !== undefined && (Number.isNaN(value) || value < 0)) return fail(state, `Enter a valid ${key} amount.`);
  }
  const payrollRuns = state.payrollRuns.map((item) =>
    item.id !== runId
      ? item
      : {
          ...item,
          updatedAt: nowIso(),
          recalcRequired: item.status === "calculated" || item.status === "verified" || item.status === "in_review",
          status: item.status === "verified" ? "in_review" as const : item.status,
          lines: item.lines.map((line) => {
            if (line.employeeId !== employeeId) return line;
            const next = {
              ...line,
              adjustment: Math.round(adjustment),
              adjustmentReason: reason.trim(),
              overtime: patch.overtime ?? line.overtime ?? 0,
              extras: patch.extras ?? line.extras ?? 0,
              arrears: patch.arrears ?? line.arrears ?? 0,
              pf: patch.pf ?? line.pf ?? 0,
              esic: patch.esic ?? line.esic ?? 0,
              penalties: patch.penalties ?? line.penalties ?? 0,
              loan: patch.loan ?? line.loan ?? 0,
              otherDeductions: patch.otherDeductions ?? line.otherDeductions ?? 0,
              needsRecalc: true,
              sources: {
                ...line.sources,
                adjustment: "manual" as const,
                overtime: "manual" as const,
                extras: "manual" as const,
                arrears: "manual" as const,
                pf: "manual" as const,
                esic: "manual" as const,
                penalties: "manual" as const,
                loan: "manual" as const,
                otherDeductions: "manual" as const,
              },
            };
            const money = computePayable(next);
            return normalizeLine({ ...next, grossEarnings: money.grossEarnings, totalDeductions: money.totalDeductions, payable: money.payable }, state.settings);
          }),
        },
  );
  return ok(pushAudit({ ...state, payrollRuns }, actor.id, "payroll", `Updated payroll inputs for ${name(state, employeeId)}.`, "payroll"), "Employee payroll line saved.");
}

export function importPayrollLines(state: AppState, runId: string, lines: PayrollLine[], fileName: string, warningCount: number): Outcome {
  const actor = requireUser(state, "payroll.manage");
  if (!isEmployee(actor)) return actor;
  const run = state.payrollRuns.find((item) => item.id === runId);
  if (!run) return fail(state, "That payroll run was not found.", true);
  if (run.status === "finalized" || run.status === "paid") return fail(state, "Cannot import into a finalized payroll run.", true);
  const at = nowIso();
  const history = {
    id: uid("pimp"),
    at,
    actorId: actor.id,
    fileName: fileName.trim() || "payroll-import.csv",
    rowCount: lines.length,
    warningCount,
    summary: `Imported spreadsheet values into ${rangeLabel(run.periodStart, run.periodEnd)}.`,
  };
  const payrollRuns = state.payrollRuns.map((item) =>
    item.id === runId
      ? {
          ...item,
          lines: lines.map((line) => normalizeLine(line, state.settings)),
          updatedAt: at,
          recalcRequired: true,
          status: item.status === "verified" || item.status === "calculated" ? "draft" as const : item.status,
          importHistory: [history, ...(item.importHistory ?? [])],
        }
      : item,
  );
  return ok(pushAudit({ ...state, payrollRuns }, actor.id, "payroll", `Imported payroll sheet “${history.fileName}” for ${rangeLabel(run.periodStart, run.periodEnd)}.`, "payroll"), "Import saved. Recalculate before verification.");
}

export function advancePayroll(
  state: AppState,
  runId: string,
  status: Extract<PayrollStatus, "in_review" | "finalized" | "paid">,
  payment?: { reference?: string; note?: string },
): Outcome {
  const actor = requireUser(state, "payroll.manage");
  if (!isEmployee(actor)) return actor;
  const run = state.payrollRuns.find((item) => item.id === runId);
  if (!run) return fail(state, "That payroll run was not found.", true);
  const allowed =
    ((run.status === "draft" || run.status === "calculated" || run.status === "verified") && status === "in_review") ||
    ((run.status === "in_review" || run.status === "verified" || run.status === "calculated") && status === "finalized") ||
    (run.status === "finalized" && status === "paid");
  if (!allowed) return fail(state, "That status change isn't available for this run.", true);
  if (status === "finalized" && run.recalcRequired) return fail(state, "Recalculate and verify this run before approval.", true);
  if (status === "paid" && !(payment?.reference ?? run.paymentReference)?.trim()) {
    return fail(state, "Add a payment reference or batch id before marking the run paid.");
  }
  const at = nowIso();
  let expenses = state.expenses;
  let payslips = state.payslips;
  if (status === "finalized") {
    const included = new Set(
      state.expenses
        .filter((item) => item.status === "approved" && !item.payrollRunId && item.date >= run.periodStart && item.date <= run.periodEnd)
        .map((item) => item.id),
    );
    expenses = state.expenses.map((item) =>
      included.has(item.id)
        ? { ...item, status: "paid" as const, payrollRunId: run.id, history: [...item.history, hist(actor.id, "Paid", `Included in payroll ${rangeLabel(run.periodStart, run.periodEnd)}.`)] }
        : item,
    );
    payslips = [
      ...run.lines.map((line) => {
        const existing = state.payslips.find((item) => item.runId === run.id && item.employeeId === line.employeeId && item.status !== "superseded");
        return snapshotPayslipRecord(run, line, at, state, existing ? { ...existing, published: false, publishedAt: null, status: "ready" } : null);
      }),
      ...state.payslips.filter((item) => item.runId !== run.id),
    ];
  }
  const payrollRuns = state.payrollRuns.map((item) =>
    item.id === runId
      ? {
          ...item,
          status,
          updatedAt: at,
          finalizedAt: status === "finalized" ? at : item.finalizedAt,
          finalizedBy: status === "finalized" ? actor.id : item.finalizedBy,
          paidAt: status === "paid" ? at : item.paidAt,
          paymentReference: status === "paid" ? (payment?.reference ?? item.paymentReference ?? "").trim() : item.paymentReference,
          paymentNote: status === "paid" ? (payment?.note ?? item.paymentNote ?? "").trim() : item.paymentNote,
        }
      : item,
  );
  const summary =
    status === "in_review"
      ? `Sent payroll for ${rangeLabel(run.periodStart, run.periodEnd)} to review.`
      : status === "finalized"
        ? `Approved payroll for ${rangeLabel(run.periodStart, run.periodEnd)}. Payslip records are ready to generate.`
        : `Marked payroll paid for ${rangeLabel(run.periodStart, run.periodEnd)}${payment?.reference ? ` (ref ${payment.reference})` : ""}.`;
  const notes: Array<Omit<AppNotification, "id" | "read" | "createdAt">> =
    status === "in_review"
      ? []
      : status === "paid"
        ? run.lines.map((line) => ({
            userId: line.employeeId,
            title: "Payroll marked paid",
            body: `Payroll for ${rangeLabel(run.periodStart, run.periodEnd)} was marked paid.`,
            href: "/payroll",
            kind: "payroll" as const,
          }))
        : [];
  const toast = status === "in_review" ? "Run sent for review." : status === "finalized" ? "Payroll approved. Generate and publish payslips next." : "Payroll marked paid.";
  return ok(pushNotes(pushAudit({ ...state, payrollRuns, expenses, payslips }, actor.id, "payroll", summary, "payroll"), notes), toast);
}

export function generatePayslip(
  state: AppState,
  input: { runId: string; employeeId: string; documentKey: string; version: number },
): Outcome {
  const actor = requireUser(state, "payroll.manage");
  if (!isEmployee(actor)) return actor;
  const run = state.payrollRuns.find((item) => item.id === input.runId);
  if (!run) return fail(state, "That payroll run was not found.", true);
  if (run.status !== "finalized" && run.status !== "paid") {
    return fail(state, "Approve the payroll run before generating an official payslip.");
  }
  const built = buildPayslipDto(state, run, input.employeeId, { official: true });
  if (!built.ok) return fail(state, built.message);
  const existing = state.payslips.find((item) => item.runId === run.id && item.employeeId === input.employeeId && item.status !== "superseded");
  const at = nowIso();
  const next = snapshotPayslipRecord(run, built.line, at, state, existing ?? null);
  const slip: Payslip = {
    ...next,
    status: "generated",
    version: input.version,
    generatedAt: at,
    generatedBy: actor.id,
    documentKey: input.documentKey,
    templateVersion: built.dto.templateVersion || PAYSLIP_TEMPLATE_VERSION,
    published: false,
    publishedAt: null,
    publishedBy: null,
  };
  const others = state.payslips.filter((item) => !(item.runId === run.id && item.employeeId === input.employeeId && item.status !== "superseded"));
  return ok(
    pushAudit({ ...state, payslips: [...others, slip] }, actor.id, "payroll", `Generated payslip v${slip.version} for ${built.person.employeeCode} (${rangeLabel(run.periodStart, run.periodEnd)}).`, "payroll"),
    "Payslip PDF generated.",
  );
}

export function publishPayslip(state: AppState, slipId: string): Outcome {
  const actor = requireUser(state, "payroll.manage");
  if (!isEmployee(actor)) return actor;
  const slip = state.payslips.find((item) => item.id === slipId);
  if (!slip) return fail(state, "That payslip was not found.", true);
  if (slip.status === "superseded") return fail(state, "That payslip version was superseded.");
  if (slip.status !== "generated" && slip.status !== "published") {
    return fail(state, "Generate the payslip PDF before publishing it to the employee.");
  }
  if (!slip.documentKey) return fail(state, "Generate the payslip PDF before publishing.");
  const run = state.payrollRuns.find((item) => item.id === slip.runId);
  if (!run || (run.status !== "finalized" && run.status !== "paid")) {
    return fail(state, "Only approved payroll can be published as an official payslip.");
  }
  const person = state.employees.find((item) => item.id === slip.employeeId);
  if (!person) return fail(state, "That employee was not found.", true);
  const line = run.lines.find((item) => item.employeeId === slip.employeeId);
  if (!line) return fail(state, "That employee is not on the approved run.");
  const validation = validatePayslipData(state, run, person, line);
  if (!validation.ok) return fail(state, `Cannot publish. Fix: ${validation.missing.join("; ")}.`);

  const conflict = state.payslips.find(
    (item) =>
      item.id !== slip.id
      && item.employeeId === slip.employeeId
      && item.periodStart === slip.periodStart
      && item.periodEnd === slip.periodEnd
      && item.published
      && item.status !== "superseded",
  );
  const at = nowIso();
  const payslips = state.payslips.map((item) => {
    if (conflict && item.id === conflict.id) {
      return { ...item, published: false, status: "superseded" as const };
    }
    if (item.id === slip.id) {
      return {
        ...item,
        status: "published" as const,
        published: true,
        publishedAt: at,
        publishedBy: actor.id,
      };
    }
    return item;
  });
  const notes: Array<Omit<AppNotification, "id" | "read" | "createdAt">> = [{
    userId: slip.employeeId,
    title: "Payslip published",
    body: `Your payslip for ${rangeLabel(slip.periodStart, slip.periodEnd)} is available to download.`,
    href: "/payroll",
    kind: "payroll",
  }];
  return ok(
    pushNotes(
      pushAudit({ ...state, payslips }, actor.id, "payroll", `Published payslip for ${person.employeeCode} (${rangeLabel(slip.periodStart, slip.periodEnd)}).`, "payroll"),
      notes,
    ),
    "Payslip published to the employee.",
  );
}

export function recordPayslipDownload(state: AppState, slipId: string): Outcome {
  const actor = user(state);
  if (!actor) return fail(state, "Sign in to continue.", true);
  const slip = state.payslips.find((item) => item.id === slipId);
  if (!slip) return fail(state, "That payslip was not found.", true);
  const manage = hasPermission(state, actor, "payroll.manage");
  if (!manage && !(slip.employeeId === actor.id && slip.published && hasPermission(state, actor, "payroll.self"))) {
    return fail(state, "You don't have access to that payslip.", true);
  }
  const code = state.employees.find((item) => item.id === slip.employeeId)?.employeeCode ?? slip.employeeId;
  return ok(
    pushAudit(state, actor.id, "payroll", `Downloaded payslip for ${code} (${rangeLabel(slip.periodStart, slip.periodEnd)}).`, "payroll"),
  );
}

export function markNotification(state: AppState, id: string, read = true): AppState {
  return { ...state, notifications: state.notifications.map((item) => (item.id === id ? { ...item, read } : item)) };
}

export function markAllNotifications(state: AppState, userId: string): AppState {
  return { ...state, notifications: state.notifications.map((item) => (item.userId === userId ? { ...item, read: true } : item)) };
}

export function updateSettings(state: AppState, patch: Partial<AppState["settings"]>): Outcome {
  const actor = user(state);
  if (!actor) return fail(state, "Sign in to continue.", true);
  const next = { ...state.settings, ...patch, rolePermissions: state.settings.rolePermissions, leaveTypes: patch.leaveTypes ?? state.settings.leaveTypes };
  if (patch.orgName !== undefined && patch.orgName.trim().length < 2) return fail(state, "Enter the organization name.");
  if (patch.currency !== undefined && !/^[A-Z]{3}$/.test(patch.currency)) return fail(state, "Use a three-letter currency code such as INR.");
  if (patch.workStart !== undefined && !/^\d{2}:\d{2}$/.test(patch.workStart)) return fail(state, "Enter the workday start as HH:MM.");
  if (patch.workEnd !== undefined && patch.workEnd !== "" && !/^\d{2}:\d{2}$/.test(patch.workEnd)) {
    return fail(state, "Enter the workday end as HH:MM, or leave it blank.");
  }
  {
    const start = patch.workStart ?? state.settings.workStart;
    const end = patch.workEnd !== undefined ? patch.workEnd : (state.settings.workEnd ?? "");
    if (start && end && /^\d{2}:\d{2}$/.test(start) && /^\d{2}:\d{2}$/.test(end)) {
      const startMin = Number(start.slice(0, 2)) * 60 + Number(start.slice(3));
      const endMin = Number(end.slice(0, 2)) * 60 + Number(end.slice(3));
      if (endMin <= startMin) return fail(state, "Workday end must be after workday start.");
    }
  }
  if (patch.graceMinutes !== undefined && (patch.graceMinutes < 0 || patch.graceMinutes > 180)) return fail(state, "Grace minutes must be between 0 and 180.");
  if (patch.weeklyOff !== undefined) {
    const days = [...new Set(patch.weeklyOff)].filter((day) => day >= 0 && day <= 6);
    if (days.length >= 7) return fail(state, "Keep at least one working day in the week.");
    next.weeklyOff = days;
  }
  if (patch.attendanceLocationRequired !== undefined && typeof patch.attendanceLocationRequired !== "boolean") {
    return fail(state, "Choose whether a punch location is required.");
  }
  if (patch.locationRetentionDays !== undefined && patch.locationRetentionDays !== null) {
    if (!Number.isInteger(patch.locationRetentionDays) || patch.locationRetentionDays < 1) {
      return fail(state, "Enter a whole number of days for location retention, or leave it blank.");
    }
  }
  if ((patch.attendanceLocationRequired !== undefined || patch.locationRetentionDays !== undefined) && !hasPermission(state, actor, "settings.org") && !hasPermission(state, actor, "settings.payroll")) {
    return fail(state, "You don't have permission to change these settings.", true);
  }
  if (
    patch.payrollStartDay !== undefined ||
    patch.payrollEndDay !== undefined ||
    patch.financialYearStartMonth !== undefined ||
    patch.payrollDailyWageDivisor !== undefined ||
    patch.payrollRounding !== undefined
  ) {
    if (!hasPermission(state, actor, "settings.payroll")) return fail(state, "Only a payroll administrator can change payroll settings.", true);
  }
  if (patch.payrollStartDay !== undefined || patch.payrollEndDay !== undefined) {
    const start = patch.payrollStartDay ?? next.payrollStartDay;
    const end = patch.payrollEndDay ?? next.payrollEndDay;
    if (start < 1 || end < 1 || start > 31 || end > 31 || start > end) return fail(state, "Payroll period days must run from an earlier day to a later day, between 1 and 31.");
  }
  if (patch.financialYearStartMonth !== undefined) {
    const month = patch.financialYearStartMonth;
    if (!Number.isInteger(month) || month < 1 || month > 12) return fail(state, "Financial year start month must be between 1 and 12.");
  }
  if (patch.payrollDailyWageDivisor !== undefined && patch.payrollDailyWageDivisor !== null) {
    if (!(patch.payrollDailyWageDivisor > 0)) return fail(state, "Daily wage divisor must be a positive number, or left blank when not configured.");
  }
  if (patch.payrollDailyWageDivisor === null) next.payrollDailyWageDivisor = null;
  if (patch.timezone !== undefined) {
    if (!hasPermission(state, actor, "settings.org")) return fail(state, "You don't have permission to change these settings.", true);
    if (patch.timezone.trim().length < 3) return fail(state, "Enter a timezone label such as Asia/Kolkata.");
    next.timezone = patch.timezone.trim();
  }
  if (patch.halfDayPolicy !== undefined) {
    if (!hasPermission(state, actor, "settings.org") && !hasPermission(state, actor, "leave.manage")) {
      return fail(state, "You don't have permission to change half-day settings.", true);
    }
    const hours = patch.halfDayPolicy.thresholdHours;
    if (hours !== null && (!(hours > 0) || hours > 12)) return fail(state, "Half-day threshold hours must be blank or between 0 and 12.");
    next.halfDayPolicy = {
      thresholdHours: hours,
      allowEmployeeRequest: patch.halfDayPolicy.allowEmployeeRequest !== false,
      effectiveDate: patch.halfDayPolicy.effectiveDate || null,
      note: patch.halfDayPolicy.note?.trim() || state.settings.halfDayPolicy?.note || "",
    };
  }
  if (patch.notificationPrefs !== undefined) {
    if (!hasPermission(state, actor, "settings.org")) return fail(state, "You don't have permission to change notification preferences.", true);
    next.notificationPrefs = {
      birthdays: patch.notificationPrefs.birthdays !== false,
      events: patch.notificationPrefs.events !== false,
      approvals: patch.notificationPrefs.approvals !== false,
      attendance: patch.notificationPrefs.attendance !== false,
    };
  }
  if ((patch.orgName || patch.workStart || patch.workEnd || patch.graceMinutes || patch.weeklyOff || patch.currency) && !hasPermission(state, actor, "settings.org") && !hasPermission(state, actor, "settings.payroll")) {
    return fail(state, "You don't have permission to change these settings.", true);
  }
  next.orgName = (patch.orgName ?? next.orgName).trim();
  if (patch.locationRetentionDays === null) next.locationRetentionDays = null;
  const retained = applyLocationRetention({ ...state, settings: next });
  return ok(pushAudit(retained.state, actor.id, "settings", "Updated organization settings."), "Settings saved.");
}

export function updateLeaveType(state: AppState, input: LeaveType): Outcome {
  const actor = requireUser(state, "leave.manage");
  if (!isEmployee(actor)) return actor;
  if (!state.settings.leaveTypes.some((item) => item.id === input.id)) return fail(state, "That leave type was not found.");
  if (input.name.trim().length < 3) return fail(state, "Enter a leave type name.");
  if (input.annual !== null && (Number.isNaN(input.annual) || input.annual < 0)) return fail(state, "Annual entitlement can't be negative. Leave it empty for no cap.");
  const leaveTypes = state.settings.leaveTypes.map((item) => (item.id === input.id ? { ...input, name: input.name.trim(), active: input.active !== false } : item));
  return ok(pushAudit({ ...state, settings: { ...state.settings, leaveTypes } }, actor.id, "leave", `Updated the leave type ${input.name.trim()}.`), "Leave type saved.");
}

export function addLeaveType(state: AppState, input: Omit<LeaveType, "id"> & { id?: string }): Outcome {
  const actor = requireUser(state, "leave.manage");
  if (!isEmployee(actor)) return actor;
  const name = input.name.trim();
  if (name.length < 3) return fail(state, "Enter a leave type name.");
  if (input.annual !== null && (Number.isNaN(input.annual) || input.annual < 0)) return fail(state, "Annual entitlement can't be negative. Leave it empty for no cap.");
  if (state.settings.leaveTypes.some((item) => item.name.toLowerCase() === name.toLowerCase())) return fail(state, "That leave type already exists.");
  const leaveType: LeaveType = {
    id: input.id?.trim() || uid("leave"),
    name,
    paid: Boolean(input.paid),
    annual: input.annual,
    allowHalfDay: Boolean(input.allowHalfDay),
    active: true,
  };
  return ok(pushAudit({ ...state, settings: { ...state.settings, leaveTypes: [...state.settings.leaveTypes, leaveType] } }, actor.id, "leave", `Added the leave type ${name}.`), "Leave type added.");
}

export function setLeaveTypeActive(state: AppState, id: string, active: boolean): Outcome {
  const actor = requireUser(state, "leave.manage");
  if (!isEmployee(actor)) return actor;
  const current = state.settings.leaveTypes.find((item) => item.id === id);
  if (!current) return fail(state, "That leave type was not found.");
  if (!active && state.leaveRequests.some((item) => item.typeId === id && item.status === "pending")) {
    return fail(state, "Resolve pending requests for this leave type before archiving it.");
  }
  if (!active && state.settings.leaveTypes.filter((item) => item.active !== false).length <= 1) {
    return fail(state, "Keep at least one active leave type.");
  }
  const leaveTypes = state.settings.leaveTypes.map((item) => (item.id === id ? { ...item, active } : item));
  return ok(pushAudit({ ...state, settings: { ...state.settings, leaveTypes } }, actor.id, "leave", `${active ? "Restored" : "Archived"} the leave type ${current.name}.`), active ? "Leave type restored." : "Leave type archived.");
}

export function addDepartment(state: AppState, nameValue: string): Outcome {
  const actor = requireUser(state, "settings.org");
  if (!isEmployee(actor)) return actor;
  const clean = nameValue.trim();
  if (clean.length < 2) return fail(state, "Enter a department name.");
  if (state.departments.some((item) => item.name.toLowerCase() === clean.toLowerCase() && item.active !== false)) {
    return fail(state, "That department already exists.");
  }
  return ok(pushAudit({ ...state, departments: [...state.departments, { id: uid("dep"), name: clean, active: true }] }, actor.id, "settings", `Added the ${clean} department.`), "Department added.");
}

export function deleteDepartment(state: AppState, id: string): Outcome {
  const actor = requireUser(state, "settings.org");
  if (!isEmployee(actor)) return actor;
  const department = state.departments.find((item) => item.id === id);
  if (!department) return fail(state, "That department was not found.");
  if (state.employees.some((item) => item.departmentId === id)) {
    const departments = state.departments.map((item) => (item.id === id ? { ...item, active: false } : item));
    return ok(pushAudit({ ...state, departments }, actor.id, "settings", `Archived the ${department.name} department because employees still reference it.`), "Department archived.");
  }
  return ok(pushAudit({ ...state, departments: state.departments.filter((item) => item.id !== id) }, actor.id, "settings", `Removed the ${department.name} department.`), "Department removed.");
}

export function restoreDepartment(state: AppState, id: string): Outcome {
  const actor = requireUser(state, "settings.org");
  if (!isEmployee(actor)) return actor;
  const department = state.departments.find((item) => item.id === id);
  if (!department) return fail(state, "That department was not found.");
  const departments = state.departments.map((item) => (item.id === id ? { ...item, active: true } : item));
  return ok(pushAudit({ ...state, departments }, actor.id, "settings", `Restored the ${department.name} department.`), "Department restored.");
}

export function addLocation(state: AppState, input: { name: string; city: string; kind: "office" | "remote" | "client" }): Outcome {
  const actor = requireUser(state, "settings.org");
  if (!isEmployee(actor)) return actor;
  if (input.name.trim().length < 2 || input.city.trim().length < 2) return fail(state, "Enter a location name and city.");
  return ok(pushAudit({ ...state, locations: [...state.locations, { id: uid("loc"), name: input.name.trim(), city: input.city.trim(), kind: input.kind, active: true }] }, actor.id, "settings", `Added the location ${input.name.trim()}.`), "Location added.");
}

export function deleteLocation(state: AppState, id: string): Outcome {
  const actor = requireUser(state, "settings.org");
  if (!isEmployee(actor)) return actor;
  const location = state.locations.find((item) => item.id === id);
  if (!location) return fail(state, "That location was not found.");
  if (state.employees.some((item) => item.locationId === id) || state.holidays.some((item) => item.locationId === id) || state.events.some((item) => item.locationId === id)) {
    const locations = state.locations.map((item) => (item.id === id ? { ...item, active: false } : item));
    return ok(pushAudit({ ...state, locations }, actor.id, "settings", `Archived the location ${location.name} because records still reference it.`), "Location archived.");
  }
  return ok(pushAudit({ ...state, locations: state.locations.filter((item) => item.id !== id) }, actor.id, "settings", `Removed the location ${location.name}.`), "Location removed.");
}

export function restoreLocation(state: AppState, id: string): Outcome {
  const actor = requireUser(state, "settings.org");
  if (!isEmployee(actor)) return actor;
  const location = state.locations.find((item) => item.id === id);
  if (!location) return fail(state, "That location was not found.");
  const locations = state.locations.map((item) => (item.id === id ? { ...item, active: true } : item));
  return ok(pushAudit({ ...state, locations }, actor.id, "settings", `Restored the location ${location.name}.`), "Location restored.");
}

export function addCategory(state: AppState, kind: "expense" | "ticket", nameValue: string): Outcome {
  const actor = requireUser(state, "settings.org");
  if (!isEmployee(actor)) return actor;
  const clean = nameValue.trim();
  if (clean.length < 2) return fail(state, "Enter a category name.");
  const key = kind === "expense" ? "expenseCategories" : "ticketCategories";
  if (state.settings[key].some((item) => item.toLowerCase() === clean.toLowerCase())) return fail(state, "That category already exists.");
  return ok(pushAudit({ ...state, settings: { ...state.settings, [key]: [...state.settings[key], clean] } }, actor.id, "settings", `Added the ${kind} category ${clean}.`), "Category added.");
}

export function removeCategory(state: AppState, kind: "expense" | "ticket", nameValue: string): Outcome {
  const actor = requireUser(state, "settings.org");
  if (!isEmployee(actor)) return actor;
  const key = kind === "expense" ? "expenseCategories" : "ticketCategories";
  if (state.settings[key].length <= 1) return fail(state, "Keep at least one category.");
  const used = kind === "expense" ? state.expenses.some((item) => item.category === nameValue) : state.tickets.some((item) => item.category === nameValue);
  if (used) return fail(state, "This category is used on existing records, so it stays available.");
  return ok(pushAudit({ ...state, settings: { ...state.settings, [key]: state.settings[key].filter((item) => item !== nameValue) } }, actor.id, "settings", `Removed the ${kind} category ${nameValue}.`), "Category removed.");
}

export function saveMasterValue(
  state: AppState,
  kind: MasterKind,
  input: { id?: string; name: string; code?: string; description?: string },
): Outcome {
  const actor = requireUser(state, "settings.org");
  if (!isEmployee(actor)) return actor;
  const name = input.name.trim();
  if (name.length < 2) return fail(state, "Enter a master value name.");
  const catalog = { ...(state.masters ?? defaultMasters()) };
  const list = [...(catalog[kind] ?? [])];
  const existing = input.id ? list.find((item) => item.id === input.id) : undefined;
  if (existing) {
    const next = {
      ...existing,
      name,
      code: input.code?.trim() || existing.code,
      description: input.description?.trim() ?? existing.description ?? "",
      updatedAt: nowIso(),
      updatedBy: actor.id,
    };
    catalog[kind] = list.map((item) => (item.id === existing.id ? next : item));
    return ok(pushAudit({ ...state, masters: catalog }, actor.id, "settings", `Updated master ${kind.replaceAll("_", " ")} “${name}”.`), "Master value saved.");
  }
  if (list.some((item) => item.name.toLowerCase() === name.toLowerCase() && item.active !== false)) {
    return fail(state, "That value already exists in this master list.");
  }
  const created = { ...createMasterValue(name, input.code, input.description), updatedBy: actor.id };
  catalog[kind] = [...list, created];
  return ok(pushAudit({ ...state, masters: catalog }, actor.id, "settings", `Added master ${kind.replaceAll("_", " ")} “${name}”.`), "Master value added.");
}

export function setMasterActive(state: AppState, kind: MasterKind, id: string, active: boolean): Outcome {
  const actor = requireUser(state, "settings.org");
  if (!isEmployee(actor)) return actor;
  const catalog = { ...(state.masters ?? defaultMasters()) };
  const list = [...(catalog[kind] ?? [])];
  const current = list.find((item) => item.id === id);
  if (!current) return fail(state, "That master value was not found.");
  if (!active) {
    const reason = mastersInUse(state, kind, current);
    if (reason) {
      catalog[kind] = list.map((item) => (item.id === id ? { ...item, active: false, updatedAt: nowIso(), updatedBy: actor.id } : item));
      return ok(pushAudit({ ...state, masters: catalog }, actor.id, "settings", `Archived master ${kind.replaceAll("_", " ")} “${current.name}”. ${reason}`), "Master value archived.");
    }
    if (list.filter((item) => item.active !== false).length <= 1) return fail(state, "Keep at least one active value in this list.");
  }
  catalog[kind] = list.map((item) => (item.id === id ? { ...item, active, updatedAt: nowIso(), updatedBy: actor.id } : item));
  return ok(pushAudit({ ...state, masters: catalog }, actor.id, "settings", `${active ? "Restored" : "Archived"} master ${kind.replaceAll("_", " ")} “${current.name}”.`), active ? "Master value restored." : "Master value archived.");
}

export function deleteMasterValue(state: AppState, kind: MasterKind, id: string): Outcome {
  const actor = requireUser(state, "settings.org");
  if (!isEmployee(actor)) return actor;
  const catalog = { ...(state.masters ?? defaultMasters()) };
  const list = [...(catalog[kind] ?? [])];
  const current = list.find((item) => item.id === id);
  if (!current) return fail(state, "That master value was not found.");
  const reason = mastersInUse(state, kind, current);
  if (reason) return fail(state, `${reason} Archive it instead of deleting.`);
  if (list.filter((item) => item.active !== false).length <= 1 && current.active !== false) {
    return fail(state, "Keep at least one active value in this list.");
  }
  catalog[kind] = list.filter((item) => item.id !== id);
  return ok(pushAudit({ ...state, masters: catalog }, actor.id, "settings", `Deleted master ${kind.replaceAll("_", " ")} “${current.name}”.`), "Master value deleted.");
}

export function setPermission(state: AppState, role: Role, permission: Permission, enabled: boolean): Outcome {
  const actor = requireUser(state, "settings.roles");
  if (!isEmployee(actor)) return actor;
  if ((role === "admin" || role === "hr") && (permission === "settings.roles" || permission === "users.manage") && !enabled) {
    return fail(state, "HR and System admin keep access to roles and user management so the workspace cannot be locked.");
  }
  const current = new Set(state.settings.rolePermissions[role] ?? []);
  if (enabled) current.add(permission);
  else current.delete(permission);
  const rolePermissions = { ...state.settings.rolePermissions, [role]: [...current] };
  return ok(pushAudit({ ...state, settings: { ...state.settings, rolePermissions } }, actor.id, "settings", `Updated ${role} permissions.`), "Permission updated.");
}

export function resetPermissions(state: AppState): Outcome {
  const actor = requireUser(state, "settings.roles");
  if (!isEmployee(actor)) return actor;
  return ok(pushAudit({ ...state, settings: { ...state.settings, rolePermissions: structuredClone(DEFAULT_ROLE_PERMISSIONS) } }, actor.id, "settings", "Restored the recommended role permissions."), "Recommended permissions restored.");
}

export function saveDocument(state: AppState, input: { employeeId: string; title: string; kind: string; sensitivity: DocumentSensitivity; fileName: string }): Outcome {
  const actor = requireUser(state, "documents.manage");
  if (!isEmployee(actor)) return actor;
  if (!person(state, input.employeeId)) return fail(state, "Choose an employee.");
  if (input.title.trim().length < 3) return fail(state, "Enter a document title.");
  if (!input.fileName.trim()) return fail(state, "Choose a file. The file name is stored with the record. The file itself is not uploaded.");
  const document: EmployeeDocument = {
    id: uid("doc"),
    employeeId: input.employeeId,
    title: input.title.trim(),
    kind: input.kind.trim() || "Employment",
    sensitivity: input.sensitivity,
    fileName: input.fileName.trim(),
    uploadedAt: nowIso(),
    uploadedBy: actor.id,
  };
  const notes = [{ userId: input.employeeId, title: "Document added to your profile", body: document.title, href: `/people/${input.employeeId}?tab=documents`, kind: "event" as const }];
  return ok(pushNotes(pushAudit({ ...state, documents: [document, ...state.documents] }, actor.id, "people", `Uploaded ${document.title} for ${name(state, input.employeeId)}.`), notes), "Document added.", document.id);
}

export interface PolicyDraft {
  id?: string;
  title: string;
  category: string;
  summary: string;
  content: string;
  version: string;
  effectiveDate: string;
  fileName: string;
  audience: PolicyAudience;
}

export function savePolicy(state: AppState, input: PolicyDraft): Outcome {
  const actor = requireUser(state, "policies.manage");
  if (!isEmployee(actor)) return actor;
  if (input.title.trim().length < 3) return fail(state, "Enter a policy title.");
  if (input.category.trim().length < 2) return fail(state, "Enter a category.");
  if (input.summary.trim().length < 8) return fail(state, "Add a short summary.");
  if (input.content.trim().length < 20) return fail(state, "Add the policy text employees will read.");
  if (!/^\d+\.\d+$/.test(input.version.trim())) return fail(state, "Use a version like 1.0.");
  if (!input.effectiveDate) return fail(state, "Choose an effective date.");
  const audienceError = validateAudience(state, input.audience);
  if (audienceError) return fail(state, audienceError);
  const version: PolicyVersion = {
    id: uid("pver"),
    version: input.version.trim(),
    summary: input.summary.trim(),
    content: input.content.trim(),
    fileName: input.fileName.trim() || `${input.title.trim().toLowerCase().replaceAll(/\s+/g, "-")}.txt`,
    effectiveDate: input.effectiveDate,
    publishedAt: null,
  };
  const existing = input.id ? state.policies.find((item) => item.id === input.id) : undefined;
  if (input.id && !existing) return fail(state, "That policy was not found.", true);
  if (existing?.versions.some((item) => item.version === version.version && item.publishedAt)) {
    return fail(state, "That version is already published. Choose a new version number.");
  }
  if (!existing) {
    const policy: Policy = { id: uid("pol"), title: input.title.trim(), category: input.category.trim(), status: "draft", audience: input.audience, versions: [version], updatedAt: nowIso() };
    return ok(pushAudit({ ...state, policies: [policy, ...state.policies] }, actor.id, "policies", `Created draft policy ${policy.title}.`), "Draft saved. Preview it before publishing.", policy.id);
  }
  if (existing.status === "archived") return fail(state, "An archived policy stays as history. Create a new policy instead.");
  const unpublished = existing.versions.find((item) => !item.publishedAt);
  const versions = unpublished
    ? existing.versions.map((item) => (item.id === unpublished.id ? { ...version, id: item.id } : item))
    : [...existing.versions, version];
  const policies = state.policies.map((item) => (item.id === existing.id ? { ...item, title: input.title.trim(), category: input.category.trim(), audience: input.audience, versions, updatedAt: nowIso() } : item));
  return ok(pushAudit({ ...state, policies }, actor.id, "policies", `Updated draft content for ${existing.title}.`), "Draft version saved.", existing.id);
}

export function publishPolicy(state: AppState, id: string): Outcome {
  const actor = requireUser(state, "policies.manage");
  if (!isEmployee(actor)) return actor;
  const policy = state.policies.find((item) => item.id === id);
  if (!policy) return fail(state, "That policy was not found.", true);
  if (policy.status === "archived") return fail(state, "Archived policies are not published again from this screen.");
  const pending = [...policy.versions].reverse().find((item) => !item.publishedAt);
  if (!pending && policy.status === "published") return fail(state, "This policy is already published. Save a new version before publishing again.");
  const target = pending ?? policy.versions[policy.versions.length - 1];
  const versions = policy.versions.map((item) => (item.id === target.id ? { ...item, publishedAt: nowIso() } : item));
  const policies = state.policies.map((item) => (item.id === id ? { ...item, status: "published" as const, versions, updatedAt: nowIso() } : item));
  const notes = state.accounts.filter((item) => item.status === "active").map((item) => ({
    userId: item.employeeId || item.id,
    title: "Policy published",
    body: `${policy.title} version ${target.version} is ready to read.`,
    href: `/policies/${policy.id}`,
    kind: "policy" as const,
  }));
  return ok(pushNotes(pushAudit({ ...state, policies }, actor.id, "policies", `Published ${policy.title} version ${target.version}.`), notes), "Policy published.", policy.id);
}

export function archivePolicy(state: AppState, id: string): Outcome {
  const actor = requireUser(state, "policies.manage");
  if (!isEmployee(actor)) return actor;
  const policy = state.policies.find((item) => item.id === id);
  if (!policy) return fail(state, "That policy was not found.", true);
  if (policy.status === "archived") return fail(state, "This policy is already archived.");
  const policies = state.policies.map((item) => (item.id === id ? { ...item, status: "archived" as const, updatedAt: nowIso() } : item));
  return ok(pushAudit({ ...state, policies }, actor.id, "policies", `Archived ${policy.title}.`), "Policy archived. Employees will see it as no longer current.");
}

export function acknowledgePolicy(state: AppState, id: string): Outcome {
  const actor = requireUser(state, "policies.view");
  if (!isEmployee(actor)) return actor;
  const unlinked = requireOwnRecord(state, actor);
  if (unlinked) return unlinked;
  if (!isEmployee(actor)) return actor;
  const policy = state.policies.find((item) => item.id === id);
  if (!policy || policy.status !== "published") return fail(state, "Only a published policy can be acknowledged.", true);
  const version = [...policy.versions].reverse().find((item) => item.publishedAt);
  if (!version) return fail(state, "This policy has no published version.", true);
  if (state.acknowledgements.some((item) => item.policyId === id && item.employeeId === actor.id && item.version === version.version)) {
    return fail(state, "You already acknowledged this version.");
  }
  const record = { id: uid("ack"), policyId: id, version: version.version, employeeId: actor.id, at: nowIso() };
  return ok(pushAudit({ ...state, acknowledgements: [record, ...state.acknowledgements] }, actor.id, "policies", `${fullName(actor)} acknowledged ${policy.title} version ${version.version}.`), "Acknowledgement recorded for this version.");
}

function validateAudience(state: AppState, audience: PolicyAudience): string | null {
  if (audience.kind === "all") return null;
  if (audience.kind === "location" && !state.locations.some((item) => item.id === audience.locationId)) return "Choose a location for this policy.";
  if (audience.kind === "department" && !state.departments.some((item) => item.id === audience.departmentId)) return "Choose a department for this policy.";
  return null;
}

export function currentPeriodLabel(state: AppState): string {
  const period = currentPeriod(state.settings);
  return rangeLabel(period.start, period.end);
}

const ROLE_RANK: Record<Role, number> = { employee: 1, manager: 2, payroll: 3, hr: 3, admin: 4 };

export function accessElevated(from: Role | null, to: Role): boolean {
  if (to === "admin") return from !== "admin";
  if (!from) return to === "hr" || to === "payroll";
  return ROLE_RANK[to] > ROLE_RANK[from];
}

export interface AccountDraft {
  email: string;
  displayName: string;
  role: Role;
  departmentId: string;
  employeeId: string;
}

function activeAdmins(state: AppState, exceptId?: string): UserAccount[] {
  return state.accounts.filter((item) => item.role === "admin" && item.status === "active" && item.id !== exceptId);
}

function blocksLastAdmin(state: AppState, account: UserAccount, nextRole: Role, nextStatus: UserAccount["status"]): boolean {
  if (account.role !== "admin" || account.status !== "active") return false;
  if (nextRole === "admin" && nextStatus === "active") return false;
  return activeAdmins(state, account.id).length === 0;
}

function saveAccounts(state: AppState, accounts: UserAccount[]): AppState {
  return { ...state, accounts };
}

export function saveAccount(state: AppState, input: AccountDraft & { id?: string }): Outcome {
  const actor = requireUser(state, "users.manage");
  if (!isEmployee(actor)) return actor;
  const email = normalizeEmail(input.email);
  const displayName = input.displayName.trim();
  if (!isValidEmail(email)) return fail(state, "Enter a valid email address.");
  const duplicate = state.accounts.find((item) => item.email === email && item.id !== input.id);
  if (duplicate) return fail(state, "An account already uses this email.");
  const employeeId = input.employeeId || null;
  if (employeeId && !state.employees.some((item) => item.id === employeeId)) return fail(state, "Choose an existing employee, or leave the profile unlinked.");
  if (employeeId && state.accounts.some((item) => item.employeeId === employeeId && item.id !== input.id)) {
    return fail(state, "That employee is already linked to another login account.");
  }
  const departmentId = input.departmentId || null;
  if (departmentId && !state.departments.some((item) => item.id === departmentId)) return fail(state, "Choose a department, or leave it blank.");
  const existing = input.id ? state.accounts.find((item) => item.id === input.id) : undefined;
  if (input.id && !existing) return fail(state, "That account is no longer available.", true);
  if (existing && existing.id === state.currentUserId && input.role !== existing.role) {
    return fail(state, "You can't change your own role.", true);
  }
  if (existing && blocksLastAdmin(state, existing, input.role, existing.status)) {
    return fail(state, "The last active System admin can't be demoted.", true);
  }
  const stamp = nowIso();
  const next: UserAccount = existing
    ? { ...existing, email, displayName: displayName || email, role: input.role, departmentId, employeeId, updatedAt: stamp }
    : {
        id: uid("usr"),
        email,
        displayName: displayName || email,
        role: input.role,
        status: "invited",
        departmentId,
        employeeId,
        createdAt: stamp,
        updatedAt: stamp,
        invitedAt: stamp,
        activatedAt: null,
        suspendedAt: null,
        deactivatedAt: null,
        passwordHash: null,
      };
  const accounts = existing ? state.accounts.map((item) => (item.id === existing.id ? next : item)) : [next, ...state.accounts];
  const summary = existing ? `Updated the login account ${email}. Role is ${input.role}.` : `Invited ${email} as ${input.role}. No email was sent.`;
  return ok(pushAudit(saveAccounts(state, accounts), actor.id, "users", summary), existing ? "Account updated." : "Invitation recorded. No email is sent from this workspace.");
}

function setAccountStatus(state: AppState, id: string, status: UserAccount["status"], summary: string, toast: string): Outcome {
  const actor = requireUser(state, "users.manage");
  if (!isEmployee(actor)) return actor;
  const account = state.accounts.find((item) => item.id === id);
  if (!account) return fail(state, "That account is no longer available.", true);
  if (account.id === state.currentUserId && status !== "active") return fail(state, "You can't suspend or deactivate your own login.", true);
  if (blocksLastAdmin(state, account, account.role, status)) return fail(state, "The last active System admin can't be suspended or deactivated.", true);
  const stamp = nowIso();
  const next: UserAccount = {
    ...account,
    status,
    updatedAt: stamp,
    activatedAt: status === "active" ? account.activatedAt ?? stamp : account.activatedAt,
    suspendedAt: status === "suspended" ? stamp : status === "active" ? null : account.suspendedAt,
    deactivatedAt: status === "deactivated" ? stamp : account.deactivatedAt,
  };
  const nextState = saveAccounts(state, state.accounts.map((item) => (item.id === id ? next : item)));
  return ok(pushAudit({ ...nextState, currentUserId: state.currentUserId === id && status !== "active" ? null : state.currentUserId }, actor.id, "users", summary), toast);
}

export function resendInvitation(state: AppState, id: string): Outcome {
  const actor = requireUser(state, "users.manage");
  if (!isEmployee(actor)) return actor;
  const account = state.accounts.find((item) => item.id === id);
  if (!account) return fail(state, "That account is no longer available.", true);
  if (account.status !== "invited") return fail(state, "Only a pending invitation can be resent.");
  const next = { ...account, invitedAt: nowIso(), updatedAt: nowIso() };
  return ok(
    pushAudit(saveAccounts(state, state.accounts.map((item) => (item.id === id ? next : item))), actor.id, "users", `Recorded another invitation for ${account.email}. No email was sent.`),
    "Invitation recorded again. No email is sent from this workspace.",
  );
}

export function suspendAccount(state: AppState, id: string): Outcome {
  const account = state.accounts.find((item) => item.id === id);
  if (account && account.status !== "active") return fail(state, "Only an active account can be suspended.");
  return setAccountStatus(state, id, "suspended", `Suspended ${account?.email ?? "an account"}.`, "Account suspended.");
}

export function reactivateAccount(state: AppState, id: string): Outcome {
  const account = state.accounts.find((item) => item.id === id);
  if (account && account.status !== "suspended") return fail(state, "Only a suspended account can be reactivated.");
  return setAccountStatus(state, id, "active", `Reactivated ${account?.email ?? "an account"}.`, "Account reactivated.");
}

export function deactivateAccount(state: AppState, id: string): Outcome {
  const account = state.accounts.find((item) => item.id === id);
  if (account && account.status === "deactivated") return fail(state, "This account is already deactivated.");
  return setAccountStatus(state, id, "deactivated", `Deactivated ${account?.email ?? "an account"}. Employee and payroll history was kept.`, "Account deactivated. Historical HR records were kept.");
}

export function deleteAccount(state: AppState, id: string): Outcome {
  const actor = requireUser(state, "users.manage");
  if (!isEmployee(actor)) return actor;
  const account = state.accounts.find((item) => item.id === id);
  if (!account) return fail(state, "That account is no longer available.", true);
  if (account.id === state.currentUserId) return fail(state, "You can't delete your own login.", true);
  if (blocksLastAdmin(state, account, account.role, "deactivated")) return fail(state, "The last active System admin can't be deleted.", true);
  if (account.employeeId) return fail(state, "This login is linked to an employee record. Deactivate it so payroll and history stay intact.", true);
  const referenced = state.audits.some((item) => item.actorId === id) || state.notifications.some((item) => item.userId === id);
  if (referenced) return fail(state, "This account appears in the audit history. Deactivate it instead of deleting it.", true);
  const next = { ...state, accounts: state.accounts.filter((item) => item.id !== id), currentUserId: state.currentUserId === id ? null : state.currentUserId };
  return ok(pushAudit(next, actor.id, "users", `Deleted the unlinked login account ${account.email}.`), "Login account deleted. No employee record was removed.");
}

export function acceptInvitation(state: AppState, id: string): Outcome {
  const account = state.accounts.find((item) => item.id === id);
  if (!account || account.status !== "invited") return fail(state, "This invitation is no longer pending.");
  const stamp = nowIso();
  const next = { ...account, status: "active" as const, activatedAt: stamp, updatedAt: stamp };
  const saved = saveAccounts(state, state.accounts.map((item) => (item.id === id ? next : item)));
  return ok(pushAudit({ ...saved, currentUserId: id }, id, "users", `${account.email} accepted the invitation.`), "Invitation accepted.");
}

/** Stores a hash that the server already computed. The plaintext password never reaches this function. */
export function setAccountPassword(state: AppState, accountId: string, passwordHash: string): Outcome {
  const account = state.accounts.find((item) => item.id === accountId);
  if (!account) return fail(state, "That account is no longer available.");
  if (!passwordHash) return fail(state, "Choose a password.");
  const next = { ...account, passwordHash, updatedAt: nowIso() };
  const saved = saveAccounts(state, state.accounts.map((item) => (item.id === accountId ? next : item)));
  return ok(pushAudit({ ...saved, currentUserId: null }, accountId, "users", `${account.email} set a password.`), "Password saved.");
}

export function saveAutomationSettings(state: AppState, settings: AutomationSettings, waha: WahaConfig, endpoints: AutomationEndpoint[]): Outcome {
  const actor = requireUser(state, "automation.manage");
  if (!isEmployee(actor)) return actor;
  const current = normalizeAutomationConfig(state.automation);
  if (settings.n8nWebhookBase && !/^https?:\/\//i.test(settings.n8nWebhookBase.trim()) && settings.n8nWebhookBase.trim().length > 0) {
    return fail(state, "n8n webhook base should start with http:// or https://.");
  }
  if (waha.apiUrl && !/^https?:\/\//i.test(waha.apiUrl.trim()) && waha.apiUrl.trim().length > 0) {
    return fail(state, "WAHA API URL should start with http:// or https://.");
  }
  const automation: AutomationConfig = {
    ...current,
    settings: {
      n8nWebhookBase: settings.n8nWebhookBase.trim(),
      automationsEnabled: Boolean(settings.automationsEnabled),
      emailCc: settings.emailCc?.trim() ?? "",
      emailFromAddress: settings.emailFromAddress?.trim() ?? "",
      emailFromName: settings.emailFromName?.trim() || "Buildesk People",
    },
    waha: {
      apiUrl: waha.apiUrl.trim(),
      apiKey: waha.apiKey,
      sessionName: waha.sessionName.trim() || "default",
      isEnabled: Boolean(waha.isEnabled),
      lastHealthCheck: current.waha.lastHealthCheck,
    },
    endpoints: endpoints.map((item) => ({
      ...item,
      label: item.label.trim() || item.channel,
      webhookUrl: item.webhookUrl.trim(),
      isEnabled: Boolean(item.isEnabled),
    })),
    updatedAt: nowIso(),
  };
  return ok(pushAudit({ ...state, automation }, actor.id, "automation", "Updated automation channels and settings."), "Automation settings saved.");
}

export function saveAutomationRule(state: AppState, draft: Omit<AutomationRule, "id" | "createdAt" | "updatedAt"> & { id?: string }): Outcome {
  const actor = requireUser(state, "automation.manage");
  if (!isEmployee(actor)) return actor;
  const current = normalizeAutomationConfig(state.automation);
  if (draft.name.trim().length < 3) return fail(state, "Give the rule a short name.");
  if (draft.templateBody.trim().length < 3) return fail(state, "Add a message template body.");
  if (draft.channel === "email" && !(draft.templateSubject ?? "").trim()) return fail(state, "Email rules need a subject template.");
  const at = nowIso();
  const existing = draft.id ? current.rules.find((item) => item.id === draft.id) : undefined;
  const rule: AutomationRule = {
    id: existing?.id ?? uid("arule"),
    name: draft.name.trim(),
    description: draft.description?.trim() || undefined,
    trigger: draft.trigger,
    channel: draft.channel,
    isActive: Boolean(draft.isActive),
    templateSubject: draft.templateSubject?.trim() || undefined,
    templateBody: draft.templateBody.trim(),
    emailCc: draft.emailCc?.trim() || undefined,
    offsetMinutes: draft.offsetMinutes,
    createdAt: existing?.createdAt ?? at,
    updatedAt: at,
  };
  const rules = existing ? current.rules.map((item) => (item.id === rule.id ? rule : item)) : [rule, ...current.rules];
  const automation = { ...current, rules, updatedAt: at };
  return ok(pushAudit({ ...state, automation }, actor.id, "automation", `${existing ? "Updated" : "Created"} automation rule “${rule.name}”.`), existing ? "Rule saved." : "Rule created.", rule.id);
}

export function deleteAutomationRule(state: AppState, id: string): Outcome {
  const actor = requireUser(state, "automation.manage");
  if (!isEmployee(actor)) return actor;
  const current = normalizeAutomationConfig(state.automation);
  const rule = current.rules.find((item) => item.id === id);
  if (!rule) return fail(state, "That rule was not found.", true);
  const automation = { ...current, rules: current.rules.filter((item) => item.id !== id), updatedAt: nowIso() };
  return ok(pushAudit({ ...state, automation }, actor.id, "automation", `Deleted automation rule “${rule.name}”.`), "Rule deleted.");
}

export function setAutomationRuleActive(state: AppState, id: string, isActive: boolean): Outcome {
  const actor = requireUser(state, "automation.manage");
  if (!isEmployee(actor)) return actor;
  const current = normalizeAutomationConfig(state.automation);
  if (!current.rules.some((item) => item.id === id)) return fail(state, "That rule was not found.", true);
  const automation = {
    ...current,
    rules: current.rules.map((item) => (item.id === id ? { ...item, isActive, updatedAt: nowIso() } : item)),
    updatedAt: nowIso(),
  };
  return ok(pushAudit({ ...state, automation }, actor.id, "automation", `${isActive ? "Activated" : "Paused"} an automation rule.`), isActive ? "Rule activated." : "Rule paused.");
}

export function clearAutomationLogs(state: AppState): Outcome {
  const actor = requireUser(state, "automation.manage");
  if (!isEmployee(actor)) return actor;
  const current = normalizeAutomationConfig(state.automation);
  return ok(pushAudit({ ...state, automation: { ...current, logs: [], updatedAt: nowIso() } }, actor.id, "automation", "Cleared automation logs."), "Automation logs cleared.");
}

export function recordAutomationHealth(state: AppState, check: NonNullable<WahaConfig["lastHealthCheck"]>): Outcome {
  const actor = requireUser(state, "automation.manage");
  if (!isEmployee(actor)) return actor;
  const current = normalizeAutomationConfig(state.automation);
  const automation = { ...current, waha: { ...current.waha, lastHealthCheck: check }, updatedAt: nowIso() };
  return ok({ ...state, automation }, check.status === "ok" ? "WAHA session looks healthy." : "WAHA health check failed.");
}

export { addDays, ensureAutomation };

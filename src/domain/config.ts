import type { AppState, HalfDayPolicy, LeaveType, NotificationPrefs, WorkLocation } from "../types";
import { activeMasters, defaultMasters, normalizeOrgSettings } from "./masters";

/** Shared company configuration reads for Attendance, Leave, Payroll, and Settings. */
export function companyConfig(state: AppState) {
  const settings = normalizeOrgSettings(state.settings);
  return {
    orgName: settings.orgName,
    currency: settings.currency,
    timezone: settings.timezone || "Asia/Kolkata",
    workStart: settings.workStart,
    graceMinutes: settings.graceMinutes,
    weeklyOff: settings.weeklyOff,
    attendanceLocationRequired: settings.attendanceLocationRequired === true,
    locationRetentionDays: settings.locationRetentionDays,
    halfDayPolicy: settings.halfDayPolicy as HalfDayPolicy,
    notificationPrefs: settings.notificationPrefs as NotificationPrefs,
    payroll: {
      startDay: settings.payrollStartDay,
      endDay: settings.payrollEndDay,
      financialYearStartMonth: settings.financialYearStartMonth ?? 4,
      dailyWageDivisor: settings.payrollDailyWageDivisor ?? null,
      rounding: settings.payrollRounding ?? "none",
    },
    leaveTypes: activeLeaveTypes(state),
    expenseCategories: settings.expenseCategories,
    ticketCategories: settings.ticketCategories,
    departments: state.departments.filter((item) => item.active !== false),
    locations: activeLocations(state),
    masters: state.masters ?? defaultMasters(),
  };
}

export function activeLeaveTypes(state: AppState): LeaveType[] {
  return state.settings.leaveTypes.filter((item) => item.active !== false);
}

export function activeLocations(state: AppState): WorkLocation[] {
  return state.locations.filter((item) => item.active !== false);
}

export function designationOptions(state: AppState): string[] {
  return activeMasters(state, "designations").map((item) => item.name);
}

export function regularizationReasonOptions(state: AppState): string[] {
  return activeMasters(state, "regularization_reasons").map((item) => item.name);
}

export function relationshipOptions(state: AppState): string[] {
  return activeMasters(state, "emergency_relationships").map((item) => item.name);
}

export function policyCategoryOptions(state: AppState): string[] {
  const fromMasters = activeMasters(state, "policy_categories").map((item) => item.name);
  const fromPolicies = state.policies.map((item) => item.category).filter(Boolean);
  return [...new Set([...fromMasters, ...fromPolicies])].sort((a, b) => a.localeCompare(b));
}

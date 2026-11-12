import type { AppState, MasterKind, MasterValue, MastersCatalog, OrgSettings } from "../types";
import { nowIso, uid } from "./dates";

export const MASTER_CATEGORIES: Array<{
  id: MasterKind;
  group: string;
  label: string;
  description: string;
}> = [
  { id: "designations", group: "Organization", label: "Designations", description: "Job titles suggested when adding or editing people." },
  { id: "employment_types", group: "Organization", label: "Employment types", description: "Labels for employment types used on employee records." },
  { id: "work_modes", group: "Work & attendance", label: "Work location options", description: "Office, remote, and client-site options for punches." },
  { id: "regularization_reasons", group: "Work & attendance", label: "Regularization reasons", description: "Suggested reasons when requesting attendance corrections." },
  { id: "event_types", group: "Leave & holidays", label: "Event types", description: "Company event vs festival labels for the calendar." },
  { id: "policy_categories", group: "Employee support", label: "Policy categories", description: "Categories for HR policies." },
  { id: "emergency_relationships", group: "Employee support", label: "Emergency relationships", description: "Relationship options for emergency contacts." },
  { id: "asset_types", group: "Employee support", label: "Asset types", description: "Labels for company asset types." },
  { id: "asset_conditions", group: "Employee support", label: "Asset conditions", description: "Condition labels for assets." },
  { id: "notification_categories", group: "Notifications", label: "Notification categories", description: "In-app notification kind labels." },
  { id: "payroll_earnings", group: "Payroll", label: "Earning component names", description: "Display names for earning lines. Calculation rules stay in payroll." },
  { id: "payroll_deductions", group: "Payroll", label: "Deduction component names", description: "Display names for deduction lines. Rates and formulas are not stored here." },
];

function item(id: string, name: string, code?: string, description = ""): MasterValue {
  return { id, name, code, description, active: true, sortOrder: 0 };
}

export function defaultMasters(): MastersCatalog {
  return {
    designations: [
      item("des_hr", "HR admin"),
      item("des_eng", "Software engineer"),
      item("des_mgr", "Manager"),
      item("des_fin", "Finance associate"),
    ],
    employment_types: [
      item("et_full", "Full-time", "full_time"),
      item("et_contract", "Contract", "contract"),
    ],
    work_modes: [
      item("wm_office", "Office", "office"),
      item("wm_remote", "Remote", "remote"),
      item("wm_client", "Client site", "client"),
    ],
    regularization_reasons: [
      item("rr_forgot", "Forgot to punch"),
      item("rr_device", "Device or network issue"),
      item("rr_onsite", "On-site without network"),
      item("rr_other", "Other"),
    ],
    event_types: [
      item("ev_event", "Company event", "event"),
      item("ev_festival", "Festival / national", "festival"),
    ],
    policy_categories: [
      item("pc_conduct", "Conduct"),
      item("pc_leave", "Leave"),
      item("pc_security", "Security"),
      item("pc_other", "Other"),
    ],
    emergency_relationships: [
      item("er_spouse", "Spouse"),
      item("er_parent", "Parent"),
      item("er_sibling", "Sibling"),
      item("er_friend", "Friend"),
      item("er_other", "Other"),
    ],
    asset_types: [
      item("at_laptop", "Laptop", "laptop"),
      item("at_phone", "Phone", "phone"),
      item("at_card", "Access card", "access_card"),
      item("at_monitor", "Monitor", "monitor"),
      item("at_other", "Other", "other"),
    ],
    asset_conditions: [
      item("ac_good", "Good", "good"),
      item("ac_fair", "Fair", "fair"),
      item("ac_poor", "Poor", "poor"),
    ],
    notification_categories: [
      item("nc_approval", "Approvals", "approval"),
      item("nc_attendance", "Attendance", "attendance"),
      item("nc_leave", "Leave", "leave"),
      item("nc_payroll", "Payroll", "payroll"),
      item("nc_birthday", "Birthdays", "birthday"),
      item("nc_event", "Events", "event"),
    ],
    payroll_earnings: [
      item("pe_basic", "Basic"),
      item("pe_hra", "HRA"),
      item("pe_special", "Special allowance"),
      item("pe_overtime", "Overtime"),
    ],
    payroll_deductions: [
      item("pd_pf", "PF"),
      item("pd_esic", "ESIC"),
      item("pd_loan", "Loan / advance"),
      item("pd_penalty", "Penalty"),
      item("pd_other", "Other deduction"),
    ],
  };
}

function mergeList(existing: MasterValue[] | undefined, defaults: MasterValue[]): MasterValue[] {
  const list = Array.isArray(existing) ? existing : [];
  const byId = new Map(list.map((entry) => [entry.id, entry]));
  const merged = defaults.map((item, index) => {
    const current = byId.get(item.id);
    byId.delete(item.id);
    return current
      ? {
          ...item,
          ...current,
          name: current.name?.trim() || item.name,
          active: current.active !== false,
          sortOrder: current.sortOrder ?? index,
        }
      : { ...item, sortOrder: index };
  });
  byId.forEach((value) => {
    merged.push({
      ...value,
      name: value.name?.trim() || "Untitled",
      active: value.active !== false,
      sortOrder: value.sortOrder ?? merged.length,
    });
  });
  return merged.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name));
}

export function ensureMasters(state: AppState): { state: AppState; changed: boolean } {
  const defaults = defaultMasters();
  const next: MastersCatalog = { ...defaults };
  let changed = !state.masters;
  (Object.keys(defaults) as MasterKind[]).forEach((kind) => {
    const merged = mergeList(state.masters?.[kind], defaults[kind]);
    next[kind] = merged;
    if (JSON.stringify(merged) !== JSON.stringify(state.masters?.[kind] ?? null)) changed = true;
  });

  const settings = normalizeOrgSettings(state.settings);
  const settingsChanged = JSON.stringify(settings) !== JSON.stringify(state.settings);
  const departments = state.departments.map((item) => ({ ...item, active: item.active !== false }));
  const locations = state.locations.map((item) => ({ ...item, active: item.active !== false }));
  const leaveTypes = settings.leaveTypes.map((item) => ({ ...item, active: item.active !== false }));

  if (!changed && !settingsChanged) {
    return { state: { ...state, masters: next, settings: { ...settings, leaveTypes } }, changed: false };
  }
  return {
    state: {
      ...state,
      masters: next,
      departments,
      locations,
      settings: { ...settings, leaveTypes },
    },
    changed: true,
  };
}

export function normalizeOrgSettings(settings: OrgSettings): OrgSettings {
  return {
    ...settings,
    timezone: settings.timezone?.trim() || "Asia/Kolkata",
    halfDayPolicy: {
      thresholdHours: settings.halfDayPolicy?.thresholdHours ?? null,
      allowEmployeeRequest: settings.halfDayPolicy?.allowEmployeeRequest !== false,
      effectiveDate: settings.halfDayPolicy?.effectiveDate ?? null,
      note: settings.halfDayPolicy?.note?.trim() || "Half-day leave uses first/second half on leave types that allow it. An hours threshold is stored only when your company configures one.",
    },
    notificationPrefs: {
      birthdays: settings.notificationPrefs?.birthdays !== false,
      events: settings.notificationPrefs?.events !== false,
      approvals: settings.notificationPrefs?.approvals !== false,
      attendance: settings.notificationPrefs?.attendance !== false,
    },
  };
}

export function activeMasters(state: AppState, kind: MasterKind): MasterValue[] {
  const catalog = state.masters ?? defaultMasters();
  return (catalog[kind] ?? []).filter((item) => item.active !== false);
}

export function masterLabel(state: AppState, kind: MasterKind, codeOrId: string): string {
  const catalog = state.masters ?? defaultMasters();
  const match = (catalog[kind] ?? []).find((item) => item.code === codeOrId || item.id === codeOrId || item.name === codeOrId);
  return match?.name ?? codeOrId;
}

export function mastersInUse(state: AppState, kind: MasterKind, item: MasterValue): string | null {
  if (kind === "designations") {
    if (state.employees.some((person) => person.jobTitle === item.name)) return "This designation is used on employee records.";
  }
  if (kind === "employment_types" && item.code) {
    if (state.employees.some((person) => person.employmentType === item.code)) return "This employment type is used on employee records.";
  }
  if (kind === "work_modes" && item.code) {
    if (state.attendance.some((row) => row.workMode === item.code)) return "This work mode is used on attendance punches.";
  }
  if (kind === "policy_categories") {
    if (state.policies.some((policy) => policy.category === item.name)) return "This category is used on policies.";
  }
  if (kind === "asset_types" && item.code) {
    if (state.assets.some((asset) => asset.type === item.code)) return "This asset type is used on assets.";
  }
  if (kind === "asset_conditions" && item.code) {
    if (state.assets.some((asset) => asset.condition === item.code)) return "This condition is used on assets.";
  }
  if (kind === "emergency_relationships") {
    if (state.employees.some((person) => person.emergencyRelationship === item.name || person.emergencySecondaryRelationship === item.name)) {
      return "This relationship is used on employee profiles.";
    }
  }
  return null;
}

export function createMasterValue(name: string, code?: string, description = ""): MasterValue {
  return {
    id: uid("mst"),
    name: name.trim(),
    code: code?.trim() || undefined,
    description: description.trim(),
    active: true,
    sortOrder: Date.now(),
    updatedAt: nowIso(),
  };
}

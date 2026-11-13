import type {
  AppState,
  HrMeetingSlot,
  HrMeetingStatus,
  Microsoft365Config,
  Ticket,
} from "../types";

export const DEFAULT_HR_MEETING_TOPICS = [
  "Leave",
  "Payroll",
  "Benefits",
  "Policy",
  "Workplace concern",
  "Other",
] as const;

export const HR_MEETING_STATUS_LABELS: Record<HrMeetingStatus, string> = {
  submitted: "Submitted",
  awaiting_hr: "Awaiting HR",
  approved_sync_pending: "Approved · Calendar sync pending",
  scheduled: "Scheduled",
  rescheduled_sync_pending: "Rescheduled · Calendar sync pending",
  rejected: "Rejected",
  cancelled: "Cancelled",
  sync_failed: "Calendar sync failed",
};

export function defaultMicrosoft365Config(): Microsoft365Config {
  return {
    enabled: false,
    tenantId: "",
    clientId: "",
    defaultOrganizerEmail: "",
    allowedOrganizerEmails: [],
    demoMode: true,
  };
}

export function normalizeMicrosoft365(raw: Microsoft365Config | undefined | null): Microsoft365Config {
  const defaults = defaultMicrosoft365Config();
  if (!raw || typeof raw !== "object") return defaults;
  const allowed = Array.isArray(raw.allowedOrganizerEmails)
    ? raw.allowedOrganizerEmails.map((item) => item.trim().toLowerCase()).filter(Boolean)
    : [];
  const defaultOrganizer = (raw.defaultOrganizerEmail || "").trim().toLowerCase();
  return {
    enabled: Boolean(raw.enabled),
    tenantId: (raw.tenantId || "").trim(),
    clientId: (raw.clientId || "").trim(),
    defaultOrganizerEmail: defaultOrganizer,
    allowedOrganizerEmails: allowed.length ? allowed : (defaultOrganizer ? [defaultOrganizer] : []),
    demoMode: raw.demoMode !== false,
    lastHealthCheck: raw.lastHealthCheck,
  };
}

export function ensureMicrosoft365(state: AppState): AppState {
  return { ...state, microsoft365: normalizeMicrosoft365(state.microsoft365) };
}

export function microsoftGraphConfigured(config: Microsoft365Config, hasClientSecret: boolean): boolean {
  return Boolean(
    config.enabled
    && config.tenantId
    && config.clientId
    && hasClientSecret
    && config.defaultOrganizerEmail
    && !config.demoMode,
  );
}

export function isHrMeetingTicket(ticket: Ticket): boolean {
  return ticket.kind === "hr_meeting" && Boolean(ticket.meeting);
}

export function hrMeetingTopics(state: AppState): string[] {
  const fromMasters = state.masters?.hr_meeting_topics?.filter((item) => item.active !== false).map((item) => item.name) ?? [];
  if (fromMasters.length > 0) return fromMasters;
  return [...DEFAULT_HR_MEETING_TOPICS];
}

export function slotEndIso(slot: HrMeetingSlot): { startIso: string; endIso: string } {
  const startLocal = `${slot.date}T${slot.startTime}:00`;
  const start = new Date(startLocal);
  // Interpret as wall clock in the slot timezone for Graph; for display we keep components.
  const end = new Date(start.getTime() + slot.durationMinutes * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const endDate = `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`;
  const endTime = `${pad(end.getHours())}:${pad(end.getMinutes())}`;
  return {
    startIso: `${slot.date}T${slot.startTime}:00`,
    endIso: `${endDate}T${endTime}:00`,
  };
}

export function formatMeetingSlot(slot: HrMeetingSlot): string {
  return `${slot.date} ${slot.startTime} (${slot.durationMinutes} min, ${slot.timezone})`;
}

export function neutralCalendarTitle(employeeName: string): string {
  return `HR meeting – ${employeeName}`;
}

export function validateMeetingSlot(slot: HrMeetingSlot, label: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(slot.date)) return `Choose a valid ${label} date.`;
  if (!/^\d{2}:\d{2}$/.test(slot.startTime)) return `Choose a valid ${label} start time.`;
  if (!Number.isFinite(slot.durationMinutes) || slot.durationMinutes < 15 || slot.durationMinutes > 240) {
    return `${label} duration must be between 15 and 240 minutes.`;
  }
  if (!slot.timezone.trim()) return `Choose a timezone for the ${label}.`;
  return null;
}

export function emptyMeetingSlot(timezone = "Asia/Kolkata"): HrMeetingSlot {
  return { date: "", startTime: "10:00", durationMinutes: 30, timezone };
}

export function meetingStatusTone(status: HrMeetingStatus): string {
  if (status === "scheduled") return "green";
  if (status === "rejected" || status === "cancelled" || status === "sync_failed") return "red";
  if (status === "approved_sync_pending" || status === "rescheduled_sync_pending") return "amber";
  return "blue";
}

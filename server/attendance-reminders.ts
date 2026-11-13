import { appendAutomationLog, matchingRules, normalizeAutomationConfig } from "../src/domain/automation.ts";
import { minutesOf, nowIso, officeParts, subtractMinutesHhmm, uid } from "../src/domain/dates.ts";
import { isNonWorking } from "../src/domain/leave.ts";
import { fullName } from "../src/lib/format.ts";
import type { AppState, Employee } from "../src/types.ts";
import type { AutomationLog, AutomationTrigger } from "../src/types/automation.ts";
import { dispatchAutomation } from "./automation.ts";
import { readWorkspace, writeWorkspace } from "./db.ts";

const DEFAULT_OFFSET = 15;
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

function officeNow(): { date: string; time: string } {
  const parts = officeParts();
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

function activeTeam(state: AppState): Employee[] {
  return state.employees.filter((person) => person.status === "active" || person.status === "on_notice");
}

function alreadyClockedIn(state: AppState, employeeId: string, date: string): boolean {
  return state.attendance.some((row) => row.employeeId === employeeId && row.date === date && Boolean(row.clockIn));
}

function alreadyClockedOut(state: AppState, employeeId: string, date: string): boolean {
  return state.attendance.some((row) => row.employeeId === employeeId && row.date === date && Boolean(row.clockOut));
}

function reminderOffset(state: AppState, trigger: AutomationTrigger): number {
  const config = normalizeAutomationConfig(state.automation);
  const rules = config.rules.filter((rule) => rule.isActive && rule.trigger === trigger);
  const offsets = rules
    .map((rule) => rule.offsetMinutes)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
  return offsets[0] ?? DEFAULT_OFFSET;
}

function withReminderMark(
  state: AppState,
  patch: { loginOn?: string; logoutOn?: string },
): AppState {
  const automation = normalizeAutomationConfig(state.automation);
  return {
    ...state,
    automation: {
      ...automation,
      settings: {
        ...automation.settings,
        attendanceReminderSent: {
          ...automation.settings.attendanceReminderSent,
          ...patch,
        },
      },
    },
  };
}

function noteLog(
  trigger: AutomationTrigger,
  message: string,
  status: AutomationLog["status"] = "failed",
): AutomationLog {
  return {
    id: uid("alog"),
    channel: "whatsapp",
    trigger,
    status,
    requestPayload: { source: "attendance-reminder-scheduler", note: message },
    errorMessage: status === "failed" ? message : undefined,
    responseSummary: status === "success" ? message : undefined,
    attemptedAt: nowIso(),
    retryCount: 0,
  };
}

/** True once the reminder minute is reached and before the punch boundary (catch-up friendly). */
function inReminderWindow(nowHhmm: string, remindAt: string, boundaryHhmm: string): boolean {
  const now = minutesOf(nowHhmm);
  const remind = minutesOf(remindAt);
  const boundary = minutesOf(boundaryHhmm);
  if (remind <= boundary) return now >= remind && now < boundary;
  // Overnight wrap (unlikely for office hours): allow from remind through midnight, then until boundary.
  return now >= remind || now < boundary;
}

async function sendBatch(
  state: AppState,
  trigger: AutomationTrigger,
  varsBase: Record<string, string>,
  shouldSkip: (person: Employee) => boolean,
): Promise<{ state: AppState; attempted: number; skipped: number }> {
  const rules = matchingRules(normalizeAutomationConfig(state.automation), trigger);
  if (rules.length === 0) return { state, attempted: 0, skipped: 0 };

  let working = state;
  let attempted = 0;
  let skipped = 0;
  for (const person of activeTeam(working)) {
    if (shouldSkip(person)) {
      skipped += 1;
      continue;
    }
    if (isNonWorking(varsBase.date, person.locationId, working.settings, working.holidays)) {
      skipped += 1;
      continue;
    }
    attempted += 1;
    working = await dispatchAutomation(working, {
      trigger,
      vars: {
        ...varsBase,
        employeeName: fullName(person),
        mobile: person.phone ?? "",
      },
      to: {
        employeeId: person.id,
        email: person.email,
        phone: person.phone,
      },
    });
  }
  return { state: working, attempted, skipped };
}

export type ReminderKind = "login" | "logout";

export async function runAttendanceReminder(
  kind: ReminderKind,
  options: { force?: boolean } = {},
): Promise<{ ok: boolean; message: string }> {
  let state = readWorkspace();
  const config = normalizeAutomationConfig(state.automation);
  const trigger: AutomationTrigger = kind === "login" ? "attendance-login-reminder" : "attendance-logout-reminder";
  const { date, time } = officeNow();
  const workStart = state.settings.workStart;
  const workEnd = state.settings.workEnd?.trim() || "";
  const offset = reminderOffset(state, trigger);
  const remindAt = kind === "login"
    ? (workStart && /^\d{2}:\d{2}$/.test(workStart) ? subtractMinutesHhmm(workStart, offset) : null)
    : (workEnd && /^\d{2}:\d{2}$/.test(workEnd) ? subtractMinutesHhmm(workEnd, offset) : null);
  const boundary = kind === "login" ? workStart : workEnd;
  const sent = config.settings.attendanceReminderSent ?? {};
  const already = kind === "login" ? sent.loginOn === date : sent.logoutOn === date;

  if (!config.settings.automationsEnabled && !options.force) {
    const next = {
      ...state,
      automation: appendAutomationLog(config, noteLog(trigger, "Attendance reminder skipped: global automation switch is Off.")),
    };
    writeWorkspace({ ...next, currentUserId: null });
    return { ok: false, message: "Turn on the global automation switch (Automation → Channels) first." };
  }

  const rules = options.force
    ? config.rules.filter((rule) => rule.isActive && rule.trigger === trigger)
    : matchingRules(config, trigger);
  if (rules.length === 0) {
    const next = {
      ...state,
      automation: appendAutomationLog(config, noteLog(trigger, "Attendance reminder skipped: no active matching rule.")),
    };
    writeWorkspace({ ...next, currentUserId: null });
    return { ok: false, message: `No active ${kind} reminder rule. Enable it under Automation → Rules.` };
  }

  if (!remindAt || !boundary || !/^\d{2}:\d{2}$/.test(boundary)) {
    const next = {
      ...state,
      automation: appendAutomationLog(config, noteLog(trigger, `Attendance reminder skipped: configure work ${kind === "login" ? "start" : "end"} in Settings.`)),
    };
    writeWorkspace({ ...next, currentUserId: null });
    return { ok: false, message: kind === "login" ? "Set workday start in Settings → Work & attendance." : "Set workday end in Settings → Work & attendance." };
  }

  if (!options.force && already) {
    return { ok: false, message: `The ${kind} reminder already ran for ${date}.` };
  }
  if (!options.force && !inReminderWindow(time, remindAt, boundary)) {
    return {
      ok: false,
      message: `Not in the ${kind} reminder window. Reminder time is ${remindAt} (work ${kind === "login" ? "start" : "end"} ${boundary}, −${offset} min). Office clock now ${time}.`,
    };
  }

  const result = await sendBatch(
    { ...state, automation: { ...config, settings: { ...config.settings, automationsEnabled: true } } },
    trigger,
    {
      date,
      companyName: state.settings.orgName,
      workStart,
      workEnd,
      reminderTime: remindAt,
    },
    (person) => (kind === "login"
      ? alreadyClockedIn(state, person.id, date)
      : alreadyClockedOut(state, person.id, date) || !alreadyClockedIn(state, person.id, date)),
  );

  let next = withReminderMark(result.state, kind === "login" ? { loginOn: date } : { logoutOn: date });
  next = {
    ...next,
    automation: appendAutomationLog(
      normalizeAutomationConfig(next.automation),
      noteLog(
        trigger,
        `${kind === "login" ? "Login" : "Logout"} reminder batch finished for ${date} at ${time}. Attempted ${result.attempted}, skipped ${result.skipped}.`,
        result.attempted > 0 ? "success" : "failed",
      ),
    ),
  };
  writeWorkspace({ ...next, currentUserId: null });

  if (result.attempted === 0) {
    return {
      ok: false,
      message: `No recipients. Check phones for WhatsApp, weekly offs/holidays, and whether people already punched. Skipped ${result.skipped}.`,
    };
  }
  return { ok: true, message: `${kind === "login" ? "Login" : "Logout"} reminder sent to ${result.attempted} people (${result.skipped} skipped).` };
}

export async function tickAttendanceReminders(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const state = readWorkspace();
    const config = normalizeAutomationConfig(state.automation);
    if (!config.settings.automationsEnabled) return;

    const { date, time } = officeNow();
    const workStart = state.settings.workStart;
    const workEnd = state.settings.workEnd?.trim() || "";
    const loginOffset = reminderOffset(state, "attendance-login-reminder");
    const logoutOffset = reminderOffset(state, "attendance-logout-reminder");
    const loginAt = workStart && /^\d{2}:\d{2}$/.test(workStart) ? subtractMinutesHhmm(workStart, loginOffset) : null;
    const logoutAt = workEnd && /^\d{2}:\d{2}$/.test(workEnd) ? subtractMinutesHhmm(workEnd, logoutOffset) : null;
    const sent = config.settings.attendanceReminderSent ?? {};

    if (loginAt && workStart && inReminderWindow(time, loginAt, workStart) && sent.loginOn !== date) {
      await runAttendanceReminder("login");
    }
    if (logoutAt && workEnd && inReminderWindow(time, logoutAt, workEnd) && sent.logoutOn !== date) {
      await runAttendanceReminder("logout");
    }
  } catch {
    // Reminder failures must never crash the API process.
  } finally {
    running = false;
  }
}

export function startAttendanceReminderScheduler(): void {
  if (timer) return;
  void tickAttendanceReminders();
  timer = setInterval(() => {
    void tickAttendanceReminders();
  }, 30_000);
  if (typeof timer === "object" && timer && "unref" in timer && typeof timer.unref === "function") {
    timer.unref();
  }
}

export function reminderSchedulePreview(state: AppState): {
  loginAt: string | null;
  logoutAt: string | null;
  workStart: string;
  workEnd: string;
  offsetMinutes: number;
  officeTime: string;
  officeDate: string;
  automationsEnabled: boolean;
} {
  const workStart = state.settings.workStart;
  const workEnd = state.settings.workEnd?.trim() || "";
  const offsetMinutes = reminderOffset(state, "attendance-login-reminder");
  const now = officeNow();
  return {
    workStart,
    workEnd,
    offsetMinutes,
    loginAt: workStart && /^\d{2}:\d{2}$/.test(workStart) ? subtractMinutesHhmm(workStart, offsetMinutes) : null,
    logoutAt: workEnd && /^\d{2}:\d{2}$/.test(workEnd) ? subtractMinutesHhmm(workEnd, offsetMinutes) : null,
    officeTime: now.time,
    officeDate: now.date,
    automationsEnabled: normalizeAutomationConfig(state.automation).settings.automationsEnabled,
  };
}

import { matchingRules, normalizeAutomationConfig } from "../src/domain/automation.ts";
import { officeParts, subtractMinutesHhmm } from "../src/domain/dates.ts";
import { isNonWorking } from "../src/domain/leave.ts";
import { fullName } from "../src/lib/format.ts";
import type { AppState, Employee } from "../src/types.ts";
import type { AutomationTrigger } from "../src/types/automation.ts";
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
  const rules = matchingRules(normalizeAutomationConfig(state.automation), trigger);
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

async function sendBatch(
  state: AppState,
  trigger: AutomationTrigger,
  varsBase: Record<string, string>,
  shouldSkip: (person: Employee) => boolean,
): Promise<AppState> {
  const rules = matchingRules(normalizeAutomationConfig(state.automation), trigger);
  if (rules.length === 0) return state;

  let working = state;
  for (const person of activeTeam(working)) {
    if (shouldSkip(person)) continue;
    if (isNonWorking(varsBase.date, person.locationId, working.settings, working.holidays)) continue;
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
  return working;
}

export async function tickAttendanceReminders(): Promise<void> {
  if (running) return;
  running = true;
  try {
    let state = readWorkspace();
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
    let changed = false;

    if (loginAt && time === loginAt && sent.loginOn !== date) {
      const next = await sendBatch(
        state,
        "attendance-login-reminder",
        {
          date,
          companyName: state.settings.orgName,
          workStart,
          workEnd,
          reminderTime: loginAt,
        },
        (person) => alreadyClockedIn(state, person.id, date),
      );
      state = withReminderMark(next, { loginOn: date });
      writeWorkspace({ ...state, currentUserId: null });
      changed = true;
    }

    if (logoutAt && time === logoutAt) {
      if (changed) state = readWorkspace();
      const latestSent = normalizeAutomationConfig(state.automation).settings.attendanceReminderSent ?? {};
      if (latestSent.logoutOn !== date) {
        const next = await sendBatch(
          state,
          "attendance-logout-reminder",
          {
            date,
            companyName: state.settings.orgName,
            workStart,
            workEnd,
            reminderTime: logoutAt,
          },
          (person) => alreadyClockedOut(state, person.id, date) || !alreadyClockedIn(state, person.id, date),
        );
        state = withReminderMark(next, { logoutOn: date });
        writeWorkspace({ ...state, currentUserId: null });
      }
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
} {
  const workStart = state.settings.workStart;
  const workEnd = state.settings.workEnd?.trim() || "";
  const offsetMinutes = reminderOffset(state, "attendance-login-reminder");
  return {
    workStart,
    workEnd,
    offsetMinutes,
    loginAt: workStart && /^\d{2}:\d{2}$/.test(workStart) ? subtractMinutesHhmm(workStart, offsetMinutes) : null,
    logoutAt: workEnd && /^\d{2}:\d{2}$/.test(workEnd) ? subtractMinutesHhmm(workEnd, offsetMinutes) : null,
  };
}

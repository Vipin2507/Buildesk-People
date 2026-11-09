export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y || 1970, (m || 1) - 1, d || 1);
}

/** Office clock for attendance. A UTC server still records India time. */
const OFFICE_TZ = "Asia/Kolkata";

function officeParts(d = new Date()): { year: string; month: string; day: string; hour: string; minute: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: OFFICE_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const hour = value("hour") === "24" ? "00" : value("hour");
  return { year: value("year"), month: value("month"), day: value("day"), hour, minute: value("minute") };
}

export function todayIso(d = new Date()): string {
  const parts = officeParts(d);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function addDays(iso: string, days: number): string {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

export function eachDate(start: string, end: string): string[] {
  if (!start || !end || end < start) return [];
  const out: string[] = [];
  let cursor = start;
  for (let i = 0; i < 400 && cursor <= end; i += 1) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

export function weekday(iso: string): number {
  return parseISODate(iso).getDay();
}

export function wallNow(d = new Date()): string {
  const parts = officeParts(d);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function hhmm(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/(\d{2}:\d{2})/);
  return match ? match[1] : null;
}

export function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;
}

export function clampDay(day: number, last: number): number {
  return Math.min(Math.max(1, day), last);
}

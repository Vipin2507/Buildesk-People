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

export function todayIso(): string {
  return isoDate(new Date());
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
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${isoDate(d)}T${hh}:${mm}`;
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

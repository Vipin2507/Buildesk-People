import { parseISODate, isoDate } from "./dates";
import type { AppState, Holiday } from "../types";

/** User-supplied company holiday list (2026). Fixed national days repeat annually; lunar festivals are one-time for that year. */
export const COMPANY_HOLIDAYS_2026: Holiday[] = [
  { id: "hol_republic_day", name: "Republic Day", date: "2026-01-26", locationId: "all", recurrence: "annual" },
  { id: "hol_2026_holi", name: "Holi", date: "2026-03-04", locationId: "all", recurrence: "once" },
  { id: "hol_2026_gudi_padwa", name: "Gudi Padwa", date: "2026-03-19", locationId: "all", recurrence: "once" },
  { id: "hol_labour_day", name: "International Workers' Day / Labour Day", date: "2026-05-01", locationId: "all", recurrence: "annual" },
  { id: "hol_independence_day", name: "Independence Day", date: "2026-08-15", locationId: "all", recurrence: "annual" },
  { id: "hol_2026_raksha_bandhan", name: "Raksha Bandhan", date: "2026-08-28", locationId: "all", recurrence: "once" },
  { id: "hol_2026_janmastami", name: "Janmastami", date: "2026-09-04", locationId: "all", recurrence: "once" },
  { id: "hol_2026_ganesh_chaturthi", name: "Ganesh Chaturthi", date: "2026-09-14", locationId: "all", recurrence: "once" },
  { id: "hol_gandhi_jayanti", name: "Gandhi Jayanti", date: "2026-10-02", locationId: "all", recurrence: "annual" },
  { id: "hol_2026_dussehra", name: "Dussehra", date: "2026-10-20", locationId: "all", recurrence: "once" },
  { id: "hol_2026_diwali", name: "Diwali", date: "2026-11-08", locationId: "all", recurrence: "once" },
  { id: "hol_2026_bhaidooj", name: "Bhaidooj", date: "2026-11-11", locationId: "all", recurrence: "once" },
  { id: "hol_christmas", name: "Christmas", date: "2026-12-25", locationId: "all", recurrence: "annual" },
];

export function holidayRecurrence(holiday: Holiday): "once" | "annual" {
  return holiday.recurrence === "annual" ? "annual" : "once";
}

export function holidayMatchesDate(holiday: Holiday, iso: string): boolean {
  if (!iso || !holiday.date) return false;
  if (holidayRecurrence(holiday) === "annual") {
    const candidate = `${iso.slice(0, 4)}-${holiday.date.slice(5)}`;
    return candidate === iso && isValidCalendarDate(candidate);
  }
  return holiday.date === iso;
}

function isValidCalendarDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  return isoDate(parseISODate(iso)) === iso;
}

/** Occurrences of a holiday inside an inclusive YYYY-MM-DD range. */
export function holidayOccurrencesInRange(holiday: Holiday, rangeStart: string, rangeEnd: string): string[] {
  if (!holiday.date || !rangeStart || !rangeEnd || rangeEnd < rangeStart) return [];
  if (holidayRecurrence(holiday) !== "annual") {
    return holiday.date >= rangeStart && holiday.date <= rangeEnd ? [holiday.date] : [];
  }
  const md = holiday.date.slice(5);
  const startY = Number(rangeStart.slice(0, 4));
  const endY = Number(rangeEnd.slice(0, 4));
  const out: string[] = [];
  for (let year = startY; year <= endY; year += 1) {
    const iso = `${year}-${md}`;
    if (!isValidCalendarDate(iso)) continue;
    if (iso >= rangeStart && iso <= rangeEnd) out.push(iso);
  }
  return out;
}

export function normalizeHoliday(input: Holiday): Holiday {
  return {
    ...input,
    id: input.id,
    name: input.name.trim(),
    date: input.date,
    locationId: input.locationId || "all",
    recurrence: holidayRecurrence(input),
  };
}

/** Merge the company holiday list into existing workspaces without inventing extra years for lunar festivals. */
export function ensureCompanyHolidays(state: AppState): { state: AppState; changed: boolean } {
  const byId = new Map(state.holidays.map((item) => [item.id, item]));
  let changed = false;
  const holidays = [...state.holidays];

  COMPANY_HOLIDAYS_2026.forEach((catalog) => {
    const existing = byId.get(catalog.id);
    if (existing) {
      const next = normalizeHoliday({
        ...existing,
        name: existing.name || catalog.name,
        date: existing.date || catalog.date,
        locationId: existing.locationId || catalog.locationId,
        recurrence: existing.recurrence ?? catalog.recurrence,
      });
      if (JSON.stringify(next) !== JSON.stringify(normalizeHoliday(existing))) {
        const index = holidays.findIndex((item) => item.id === catalog.id);
        if (index >= 0) holidays[index] = next;
        changed = true;
      }
      return;
    }
    const duplicate = holidays.find(
      (item) =>
        item.name.toLowerCase() === catalog.name.toLowerCase()
        && item.date === catalog.date
        && item.locationId === catalog.locationId,
    );
    if (duplicate) return;
    holidays.push({ ...catalog });
    changed = true;
  });

  const normalized = holidays.map((item) => {
    const next = normalizeHoliday(item);
    if (next.recurrence !== (item.recurrence ?? "once")) changed = true;
    return next;
  });

  if (!changed) return { state, changed: false };
  return { state: { ...state, holidays: normalized }, changed: true };
}

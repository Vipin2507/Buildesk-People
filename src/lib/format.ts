import { addDays, hhmm, isoDate, minutesOf, parseISODate } from "../domain/dates";

const LABELS: Record<string, string> = {
  present: "Present",
  late: "Late",
  absent: "Absent",
  leave: "On leave",
  incomplete: "Missed punch",
  holiday: "Holiday",
  weekly_off: "Weekly off",
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  paid: "Paid",
  draft: "Draft",
  calculated: "Calculated",
  in_review: "In review",
  verified: "Verified",
  finalized: "Approved",
  failed: "Failed",
  open: "Open",
  in_progress: "In progress",
  waiting: "Waiting",
  resolved: "Resolved",
  available: "Available",
  used: "Used",
  assigned: "Assigned",
  repair: "In repair",
  retired: "Retired",
  active: "Active",
  inactive: "Inactive",
  on_notice: "On notice",
  punch: "Clock punch",
  regularization: "Correction",
  system: "System",
  office: "Office",
  remote: "Remote",
  client: "Client site",
  full_time: "Full-time",
  contract: "Contract",
  employee: "Employee",
  manager: "Manager",
  hr: "HR admin",
  payroll: "Payroll admin",
  admin: "System admin",
  first_half: "First half",
  second_half: "Second half",
  none: "Full day",
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
  good: "Good",
  fair: "Fair",
  poor: "Poor",
  laptop: "Laptop",
  phone: "Phone",
  access_card: "Access card",
  monitor: "Monitor",
  other: "Other",
  event: "Event",
  festival: "Festival",
  birthday: "Birthday",
  published: "Published",
  archived: "Archived",
  standard: "Standard",
  sensitive: "Sensitive",
  compensation: "Compensation",
  invited: "Invited",
  suspended: "Suspended",
  deactivated: "Deactivated",
  success: "Success",
  retrying: "Retrying",
  whatsapp: "WhatsApp",
  email: "Email",
  automation: "Automation",
};

const TONES: Record<string, string> = {
  present: "green",
  approved: "green",
  paid: "green",
  finalized: "green",
  verified: "green",
  calculated: "blue",
  failed: "red",
  resolved: "green",
  available: "green",
  used: "gray",
  active: "green",
  good: "green",
  late: "amber",
  pending: "amber",
  incomplete: "amber",
  in_progress: "amber",
  repair: "amber",
  on_notice: "amber",
  waiting: "amber",
  fair: "amber",
  high: "amber",
  absent: "red",
  rejected: "red",
  urgent: "red",
  poor: "red",
  leave: "blue",
  in_review: "blue",
  open: "blue",
  assigned: "blue",
  draft: "gray",
  published: "green",
  archived: "gray",
  holiday: "gray",
  weekly_off: "gray",
  invited: "blue",
  suspended: "amber",
  deactivated: "gray",
  inactive: "gray",
  retired: "gray",
  low: "gray",
  medium: "blue",
  success: "green",
  retrying: "amber",
  whatsapp: "green",
  email: "blue",
};

export function labelFor(value: string): string {
  return LABELS[value] ?? value;
}

export function toneFor(value: string): string {
  return TONES[value] ?? "gray";
}

export function formatDate(iso: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(parseISODate(iso));
}

export function formatDateLong(iso: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(parseISODate(iso));
}

export function formatWeekdayShort(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", { weekday: "short" }).format(parseISODate(iso));
}

export function formatTime(stamp: string | null): string {
  const time = hhmm(stamp);
  if (!time) return "—";
  const [h, m] = time.split(":").map(Number);
  const dt = new Date();
  dt.setHours(h || 0, m || 0, 0, 0);
  return new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" }).format(dt);
}

export function formatDateTime(value: string): string {
  if (!value) return "—";
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    return `${formatDate(value)} · ${formatTime(value)}`;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

export function formatDuration(clockIn: string | null, clockOut: string | null): string {
  const start = hhmm(clockIn);
  const end = hhmm(clockOut);
  if (!start || !end) return "—";
  const mins = minutesOf(end) - minutesOf(start);
  if (mins < 0) return "—";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function formatMoney(amount: number, currency = "INR"): string {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount).toLocaleString("en-IN")}`;
  }
}

export function formatNumber(amount: number): string {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 }).format(amount);
}

export function greeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function fullName(person: { firstName: string; lastName: string }): string {
  return `${person.firstName} ${person.lastName}`.trim();
}

export function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function rangeLabel(start: string, end: string): string {
  if (start === end) return formatDate(start);
  return `${formatDate(start)} – ${formatDate(end)}`;
}

export function monthLabel(year: number, monthIndex: number): string {
  return new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric" }).format(
    new Date(year, monthIndex, 1),
  );
}

export function shiftLabel(workStart: string, graceMinutes: number): string {
  return `Workday starts ${formatTime(`2000-01-01T${workStart}`)} · ${graceMinutes} min grace`;
}

export function daysFromToday(iso: string): number {
  const today = parseISODate(isoDate(new Date()));
  const target = parseISODate(iso);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

export function relativeDay(iso: string): string {
  const diff = daysFromToday(iso);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return formatDate(iso);
}

export { addDays };

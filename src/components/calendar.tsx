import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { addDays, isoDate, parseISODate, weekday } from "../domain/dates";
import { formatDate, formatDateLong, formatWeekdayShort, labelFor, monthLabel } from "../lib/format";
import type { CalendarItem, CalendarItemKind } from "../domain/calendar";
import { CALENDAR_LEGEND, addMonthCursor, monthCursor, weekRange } from "../domain/calendar";
import { Button, cx } from "./ui";

export interface CalMarker {
  id?: string;
  date: string;
  label: string;
  kind?: string;
  href?: string;
  tone?: string;
}

const LEGEND = [
  { kind: "holiday", label: "Holiday" },
  { kind: "event", label: "Event or festival" },
  { kind: "birthday", label: "Birthday" },
  { kind: "leave", label: "Approved leave" },
];

function addMonth(cursor: string, delta: number): string {
  return addMonthCursor(cursor, delta);
}

/** Compact month grid used by Overview and other surfaces. */
export function MonthCalendar({ markers, onSelect, describe }: { markers: CalMarker[]; onSelect?: (date: string) => void; describe?: (date: string) => ReactNode }) {
  const today = isoDate(new Date());
  const [cursor, setCursor] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState(today);
  const [year, month] = cursor.split("-").map(Number);
  const first = new Date(year, (month || 1) - 1, 1);
  const startPad = first.getDay();
  const days = new Date(year, month || 1, 0).getDate();
  const cells = [...Array(startPad).fill(null), ...Array.from({ length: days }, (_, index) => index + 1)];
  const kinds = new Set(markers.map((item) => item.kind).filter(Boolean));

  const select = (date: string) => {
    setSelected(date);
    setCursor(date.slice(0, 7));
    onSelect?.(date);
  };

  const selectedMarkers = markers.filter((item) => item.date === selected);

  return (
    <div className="cal-scroll">
      <div className="cal-head">
        <Button variant="ghost" size="sm" aria-label="Previous month" onClick={() => setCursor(addMonth(cursor, -1))}>Prev</Button>
        <strong>{monthLabel((year || 2026), (month || 1) - 1)}</strong>
        <div className="actions">
          <Button variant="ghost" size="sm" onClick={() => select(today)}>Today</Button>
          <Button variant="ghost" size="sm" aria-label="Next month" onClick={() => setCursor(addMonth(cursor, 1))}>Next</Button>
        </div>
      </div>
      <div className="cal-grid" role="grid" aria-label="Calendar">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <div key={day} className="cal-dow" role="columnheader">{day}</div>)}
        {cells.map((day, index) => {
          if (!day) return <span key={`e-${index}`} />;
          const date = `${cursor}-${String(day).padStart(2, "0")}`;
          const dayMarkers = markers.filter((item) => item.date === date);
          const off = weekday(date) === 0 || weekday(date) === 6;
          return (
            <button
              key={date}
              type="button"
              role="gridcell"
              className={cx("cal-day", date === today && "today", date === selected && "selected", off && "off")}
              aria-label={`${formatDate(date)}${dayMarkers.length ? `, ${dayMarkers.map((item) => item.label).join(", ")}` : ""}`}
              aria-pressed={date === selected}
              onClick={() => select(date)}
              onKeyDown={(event) => {
                const delta = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" ? -7 : event.key === "ArrowDown" ? 7 : 0;
                if (!delta) return;
                event.preventDefault();
                select(addDays(date, delta));
              }}
            >
              {day}
              {dayMarkers.length > 0 && <span className={`mark kind-${dayMarkers[0].kind ?? "event"}`} />}
            </button>
          );
        })}
      </div>
      {kinds.size > 0 && (
        <ul className="cal-legend">
          {LEGEND.filter((item) => kinds.has(item.kind)).map((item) => (
            <li key={item.kind}><i className={`kind-${item.kind}`} />{item.label}</li>
          ))}
        </ul>
      )}
      <div className="stack" style={{ marginTop: 8 }}>
        {describe ? describe(selected) : selectedMarkers.length === 0 ? <p className="muted">Nothing scheduled on {formatDate(selected)}.</p> : selectedMarkers.map((item) => {
          const body = <span><strong>{item.label}</strong>{item.kind && <span className="muted" style={{ display: "block" }}>{labelFor(item.kind)}</span>}</span>;
          return item.href
            ? <Link key={item.id ?? item.label} to={item.href} className="notice">{body}</Link>
            : <div key={item.id ?? item.label} className="notice">{body}</div>;
        })}
      </div>
    </div>
  );
}

function kindClass(kind: CalendarItemKind): string {
  return `kind-${kind}`;
}

function DayChips({ items }: { items: CalendarItem[] }) {
  if (items.length === 0) return null;
  const shown = items.slice(0, 2);
  const extra = items.length - shown.length;
  return (
    <span className="cal-chips" aria-hidden>
      {shown.map((item) => (
        <span key={item.id} className={cx("cal-chip", kindClass(item.kind))} title={item.title}>
          {item.title}
        </span>
      ))}
      {extra > 0 && <span className="cal-chip more">+{extra}</span>}
    </span>
  );
}

export function LeaveMonthGrid({
  cursor,
  selected,
  today,
  items,
  onSelect,
  onCursorChange,
}: {
  cursor: string;
  selected: string;
  today: string;
  items: CalendarItem[];
  onSelect: (date: string) => void;
  onCursorChange: (cursor: string) => void;
}) {
  const [year, month] = cursor.split("-").map(Number);
  const first = new Date(year, (month || 1) - 1, 1);
  const startPad = first.getDay();
  const days = new Date(year, month || 1, 0).getDate();
  const cells = [...Array(startPad).fill(null), ...Array.from({ length: days }, (_, index) => index + 1)];
  const byDate = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    items.forEach((item) => {
      const list = map.get(item.date) ?? [];
      list.push(item);
      map.set(item.date, list);
    });
    return map;
  }, [items]);

  return (
    <div className="cal-grid leave-cal-grid" role="grid" aria-label={`${monthLabel(year, (month || 1) - 1)} calendar`}>
      {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <div key={day} className="cal-dow" role="columnheader">{day}</div>)}
      {cells.map((day, index) => {
        if (!day) return <span key={`e-${index}`} className="cal-pad" />;
        const date = `${cursor}-${String(day).padStart(2, "0")}`;
        const dayItems = byDate.get(date) ?? [];
        const off = weekday(date) === 0 || weekday(date) === 6;
        return (
          <button
            key={date}
            type="button"
            role="gridcell"
            className={cx("cal-day", "leave-cal-day", date === today && "today", date === selected && "selected", off && "off", dayItems.length > 0 && "has-items")}
            aria-label={`${formatDate(date)}${dayItems.length ? `, ${dayItems.map((item) => item.title).join(", ")}` : ", nothing scheduled"}`}
            aria-pressed={date === selected}
            onClick={() => onSelect(date)}
            onKeyDown={(event) => {
              const delta = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" ? -7 : event.key === "ArrowDown" ? 7 : 0;
              if (!delta) return;
              event.preventDefault();
              const next = addDays(date, delta);
              onSelect(next);
              onCursorChange(monthCursor(next));
            }}
          >
            <span className="cal-day-num">{day}</span>
            <DayChips items={dayItems} />
          </button>
        );
      })}
    </div>
  );
}

export function LeaveWeekGrid({
  selected,
  today,
  items,
  onSelect,
}: {
  selected: string;
  today: string;
  items: CalendarItem[];
  onSelect: (date: string) => void;
}) {
  const week = weekRange(selected);
  return (
    <div className="leave-week-grid" role="list" aria-label="Week view">
      {week.days.map((date) => {
        const dayItems = items.filter((item) => item.date === date);
        const off = weekday(date) === 0 || weekday(date) === 6;
        return (
          <button
            key={date}
            type="button"
            role="listitem"
            className={cx("leave-week-day", date === today && "today", date === selected && "selected", off && "off")}
            aria-pressed={date === selected}
            onClick={() => onSelect(date)}
          >
            <span className="leave-week-head">
              <strong>{formatWeekdayShort(date)}</strong>
              <span className="muted">{formatDate(date)}</span>
            </span>
            {dayItems.length === 0 ? (
              <span className="muted leave-week-empty">Nothing scheduled</span>
            ) : (
              <ul className="leave-week-list">
                {dayItems.map((item) => (
                  <li key={item.id} className={cx("leave-week-item", kindClass(item.kind))}>
                    <span className="leave-week-kind">{CALENDAR_LEGEND.find((entry) => entry.kind === item.kind)?.label ?? item.kind}</span>
                    <strong>{item.title}</strong>
                  </li>
                ))}
              </ul>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function LeaveAgendaList({
  items,
  selected,
  onSelect,
  emptyTitle,
  emptyBody,
}: {
  items: CalendarItem[];
  selected: string;
  onSelect: (date: string) => void;
  emptyTitle: string;
  emptyBody: string;
}) {
  const grouped = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    items.forEach((item) => {
      const list = map.get(item.date) ?? [];
      list.push(item);
      map.set(item.date, list);
    });
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [items]);

  if (grouped.length === 0) {
    return <p className="muted">{emptyTitle}. {emptyBody}</p>;
  }

  return (
    <div className="leave-agenda" role="list" aria-label="Agenda">
      {grouped.map(([date, dayItems]) => (
        <section key={date} className={cx("leave-agenda-day", date === selected && "selected")} role="listitem">
          <button type="button" className="leave-agenda-date" onClick={() => onSelect(date)}>
            <strong>{formatDateLong(date)}</strong>
          </button>
          <ul>
            {dayItems.map((item) => (
              <li key={item.id}>
                {item.href ? (
                  <Link to={item.href} className={cx("leave-agenda-item", kindClass(item.kind))}>
                    <span className="leave-agenda-kind">{CALENDAR_LEGEND.find((entry) => entry.kind === item.kind)?.label}</span>
                    <strong>{item.title}</strong>
                    <span className="muted">{item.detail}</span>
                  </Link>
                ) : (
                  <div className={cx("leave-agenda-item", kindClass(item.kind))}>
                    <span className="leave-agenda-kind">{CALENDAR_LEGEND.find((entry) => entry.kind === item.kind)?.label}</span>
                    <strong>{item.title}</strong>
                    <span className="muted">{item.detail}</span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function CalendarLegend({ kinds }: { kinds: CalendarItemKind[] }) {
  const visible = CALENDAR_LEGEND.filter((item) => kinds.includes(item.kind));
  if (visible.length === 0) return null;
  return (
    <ul className="cal-legend leave-cal-legend" aria-label="Calendar legend">
      {visible.map((item) => (
        <li key={item.kind}><i className={kindClass(item.kind)} aria-hidden />{item.label}</li>
      ))}
    </ul>
  );
}

/** Sync selected date into month cursor when parent changes selection externally. */
export function useMonthCursor(selected: string, controlled?: string): [string, (next: string) => void] {
  const [cursor, setCursor] = useState(controlled ?? monthCursor(selected));
  useEffect(() => {
    if (controlled) setCursor(controlled);
  }, [controlled]);
  useEffect(() => {
    if (!controlled) setCursor(monthCursor(selected));
  }, [selected, controlled]);
  return [cursor, setCursor];
}

// Re-export for callers that parse local dates in calendar UI
export { parseISODate };

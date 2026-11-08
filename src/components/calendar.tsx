import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { addDays, isoDate, parseISODate, weekday } from "../domain/dates";
import { formatDate, labelFor, monthLabel } from "../lib/format";
import { Button } from "./ui";

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
              className={`cal-day${date === today ? " today" : ""}${date === selected ? " selected" : ""}${off ? " off" : ""}`}
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

function addMonth(cursor: string, delta: number): string {
  const date = parseISODate(`${cursor}-01`);
  date.setMonth(date.getMonth() + delta);
  return isoDate(date).slice(0, 7);
}

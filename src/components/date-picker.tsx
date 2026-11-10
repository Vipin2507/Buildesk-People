import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronDown } from "lucide-react";
import { addDays, todayIso, weekday } from "../domain/dates";
import { formatDate } from "../lib/format";
import { Button, cx } from "./ui";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

function isIso(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function clampIso(value: string, min?: string, max?: string): string {
  if (!isIso(value)) return value;
  if (min && value < min) return min;
  if (max && value > max) return max;
  return value;
}

function yearOptions(min?: string, max?: string): number[] {
  const today = todayIso();
  const start = min && isIso(min) ? Number(min.slice(0, 4)) : Number(today.slice(0, 4)) - 80;
  const end = max && isIso(max) ? Number(max.slice(0, 4)) : Number(today.slice(0, 4)) + 10;
  const years: number[] = [];
  for (let year = end; year >= start; year -= 1) years.push(year);
  return years;
}

export function DatePicker({
  value,
  onChange,
  min,
  max,
  disabled,
  required,
  id,
  name,
  className,
  placeholder = "Select date",
  dialogTitle = "Select Date",
  "aria-invalid": ariaInvalid,
  "aria-required": ariaRequired,
  "data-field": dataField,
}: {
  value: string;
  onChange: (next: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  name?: string;
  className?: string;
  placeholder?: string;
  dialogTitle?: string;
  "aria-invalid"?: boolean;
  "aria-required"?: boolean;
  "data-field"?: string;
}) {
  const autoId = useId();
  const triggerId = id ?? autoId;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef(value);
  const boundsRef = useRef({ min, max });
  const [open, setOpen] = useState(false);
  const initial = isIso(value) ? value : todayIso();
  const [cursor, setCursor] = useState(initial.slice(0, 7));
  const [draft, setDraft] = useState(initial);
  draftRef.current = draft;
  boundsRef.current = { min, max };

  const confirm = (next = draftRef.current) => {
    const sealed = clampIso(next, boundsRef.current.min, boundsRef.current.max);
    if (!isIso(sealed)) return;
    onChange(sealed);
    setOpen(false);
    queueMicrotask(() => triggerRef.current?.focus());
  };
  const confirmRef = useRef(confirm);
  confirmRef.current = confirm;

  useEffect(() => {
    if (!open) return;
    const seed = isIso(value) ? value : todayIso();
    setDraft(seed);
    setCursor(seed.slice(0, 7));
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter"].includes(event.key)) return;
      event.preventDefault();
      if (event.key === "Enter") {
        confirmRef.current();
        return;
      }
      const delta = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" ? -7 : 7;
      const next = clampIso(addDays(draftRef.current, delta), boundsRef.current.min, boundsRef.current.max);
      setDraft(next);
      setCursor(next.slice(0, 7));
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open, value]);

  const [year, month] = cursor.split("-").map(Number);
  const years = useMemo(() => yearOptions(min, max), [min, max]);
  const first = new Date(year, (month || 1) - 1, 1);
  const startPad = first.getDay();
  const cells = useMemo(() => {
    const list: Array<{ date: string; day: number; outside: boolean }> = [];
    const start = addDays(`${cursor}-01`, -startPad);
    for (let index = 0; index < 42; index += 1) {
      const date = addDays(start, index);
      list.push({ date, day: Number(date.slice(8, 10)), outside: !date.startsWith(cursor) });
    }
    while (list.length > 35 && list.slice(-7).every((item) => item.outside)) list.splice(-7);
    return list;
  }, [cursor, startPad]);

  const pickDay = (date: string) => {
    if (min && date < min) return;
    if (max && date > max) return;
    setDraft(date);
    setCursor(date.slice(0, 7));
  };

  const iconDay = isIso(draft) ? draft.slice(8, 10) : "01";
  const label = isIso(value) ? formatDate(value) : placeholder;

  return (
    <div className={cx("date-picker", className)}>
      <input type="hidden" name={name} value={value} readOnly />
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        className={cx("date-picker-trigger", !isIso(value) && "placeholder")}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-invalid={ariaInvalid}
        aria-required={ariaRequired ?? required}
        data-field={dataField}
        onClick={(event) => {
          event.preventDefault();
          if (!disabled) setOpen(true);
        }}
      >
        <span>{label}</span>
        <CalendarDays size={18} aria-hidden />
      </button>

      {open && createPortal(
        <div className="date-picker-back" onMouseDown={() => setOpen(false)}>
          <div
            ref={dialogRef}
            className="date-picker-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={dialogTitle}
            tabIndex={-1}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="date-picker-head">
              <h2>{dialogTitle}</h2>
              <span className="date-picker-badge" aria-hidden>
                <span className="date-picker-badge-bind" />
                <strong>{iconDay}</strong>
              </span>
            </div>

            <div className="date-picker-controls">
              <label className="date-picker-select">
                <span className="sr-only">Month</span>
                <select
                  value={String(month || 1)}
                  onChange={(event) => setCursor(`${year}-${String(Number(event.target.value)).padStart(2, "0")}`)}
                >
                  {MONTHS.map((monthLabel, index) => (
                    <option key={monthLabel} value={String(index + 1)}>{monthLabel}</option>
                  ))}
                </select>
                <ChevronDown size={16} aria-hidden />
              </label>
              <label className="date-picker-select">
                <span className="sr-only">Year</span>
                <select
                  value={String(year)}
                  onChange={(event) => setCursor(`${event.target.value}-${String(month || 1).padStart(2, "0")}`)}
                >
                  {years.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
                <ChevronDown size={16} aria-hidden />
              </label>
            </div>

            <div className="date-picker-grid" role="grid" aria-label={`${MONTHS[(month || 1) - 1]} ${year}`}>
              {DOW.map((day, index) => (
                <div key={day} className={cx("date-picker-dow", index === 0 && "sunday")} role="columnheader">{day}</div>
              ))}
              {cells.map((cell) => {
                const disabledDay = Boolean((min && cell.date < min) || (max && cell.date > max));
                const sunday = weekday(cell.date) === 0;
                const selected = cell.date === draft;
                const today = cell.date === todayIso();
                return (
                  <button
                    key={cell.date}
                    type="button"
                    role="gridcell"
                    className={cx(
                      "date-picker-day",
                      cell.outside && "outside",
                      sunday && "sunday",
                      selected && "selected",
                      today && "today",
                    )}
                    disabled={disabledDay}
                    aria-pressed={selected}
                    aria-label={formatDate(cell.date)}
                    onClick={() => pickDay(cell.date)}
                    onDoubleClick={() => confirm(cell.date)}
                  >
                    {String(cell.day).padStart(2, "0")}
                  </button>
                );
              })}
            </div>

            <Button className="date-picker-confirm" onClick={() => confirm()}>Confirm</Button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

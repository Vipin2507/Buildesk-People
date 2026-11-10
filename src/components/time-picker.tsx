import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Clock3, Minus, Plus } from "lucide-react";
import { formatTime } from "../lib/format";
import { Button, cx } from "./ui";

type Period = "am" | "pm";

function isHhmm(value: string): boolean {
  return /^\d{2}:\d{2}$/.test(value);
}

function parseHhmm(value: string): { hour24: number; minute: number } | null {
  if (!isHhmm(value)) return null;
  const [hour24, minute] = value.split(":").map(Number);
  if (hour24 > 23 || minute > 59) return null;
  return { hour24, minute };
}

function toDisplay(hour24: number, minute: number): { hour12: number; minute: number; period: Period } {
  const period: Period = hour24 >= 12 ? "pm" : "am";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return { hour12, minute, period };
}

function toHhmm(hour12: number, minute: number, period: Period): string {
  let hour24 = hour12 % 12;
  if (period === "pm") hour24 += 12;
  return `${String(hour24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function wrap(value: number, min: number, max: number): number {
  if (value < min) return max;
  if (value > max) return min;
  return value;
}

export function TimePicker({
  value,
  onChange,
  sameAs,
  sameTimeLabel = "Same time",
  minuteStep = 1,
  disabled,
  required,
  id,
  name,
  className,
  placeholder = "Select time",
  dialogTitle = "Time",
  "aria-invalid": ariaInvalid,
  "aria-required": ariaRequired,
}: {
  value: string;
  onChange: (next: string) => void;
  /** When set, shows a Same time toggle that copies this HH:mm value. */
  sameAs?: string;
  sameTimeLabel?: string;
  minuteStep?: number;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  name?: string;
  className?: string;
  placeholder?: string;
  dialogTitle?: string;
  "aria-invalid"?: boolean;
  "aria-required"?: boolean;
}) {
  const autoId = useId();
  const triggerId = id ?? autoId;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const parsed = parseHhmm(value) ?? parseHhmm("09:00") ?? { hour24: 9, minute: 0 };
  const seed = toDisplay(parsed.hour24, parsed.minute);
  const [hour12, setHour12] = useState(seed.hour12);
  const [minute, setMinute] = useState(seed.minute);
  const [period, setPeriod] = useState<Period>(seed.period);
  const [sameTime, setSameTime] = useState(false);
  const step = Math.max(1, Math.min(30, minuteStep));
  const draftRef = useRef({ hour12, minute, period, sameTime, sameAs });
  draftRef.current = { hour12, minute, period, sameTime, sameAs };

  const save = () => {
    const draft = draftRef.current;
    const next = draft.sameTime && draft.sameAs && isHhmm(draft.sameAs)
      ? draft.sameAs
      : toHhmm(draft.hour12, draft.minute, draft.period);
    onChange(next);
    setOpen(false);
    queueMicrotask(() => triggerRef.current?.focus());
  };
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    if (!open) return;
    const base = parseHhmm(value) ?? parseHhmm(sameAs || "") ?? parseHhmm("09:00") ?? { hour24: 9, minute: 0 };
    const display = toDisplay(base.hour24, base.minute);
    setHour12(display.hour12);
    setMinute(display.minute);
    setPeriod(display.period);
    setSameTime(Boolean(sameAs && isHhmm(sameAs) && value === sameAs));
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key === "Enter") {
        const tag = (event.target as HTMLElement | null)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        event.preventDefault();
        saveRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open, value, sameAs]);

  useEffect(() => {
    if (!sameTime || !sameAs || !isHhmm(sameAs)) return;
    const linked = parseHhmm(sameAs);
    if (!linked) return;
    const display = toDisplay(linked.hour24, linked.minute);
    setHour12(display.hour12);
    setMinute(display.minute);
    setPeriod(display.period);
  }, [sameTime, sameAs]);

  const bumpHour = (delta: number) => {
    if (sameTime) setSameTime(false);
    setHour12((current) => wrap(current + delta, 1, 12));
  };

  const bumpMinute = (delta: number) => {
    if (sameTime) setSameTime(false);
    setMinute((current) => {
      const span = Math.floor(60 / step) * step;
      const next = ((current + delta * step) % span + span) % span;
      return next;
    });
  };

  const label = isHhmm(value) ? formatTime(`1970-01-01T${value}`) : placeholder;

  return (
    <div className={cx("time-picker", className)}>
      <input type="hidden" name={name} value={value} readOnly />
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        className={cx("time-picker-trigger", !isHhmm(value) && "placeholder")}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-invalid={ariaInvalid}
        aria-required={ariaRequired ?? required}
        onClick={(event) => {
          event.preventDefault();
          if (!disabled) setOpen(true);
        }}
      >
        <span>{label}</span>
        <Clock3 size={18} aria-hidden />
      </button>

      {open && createPortal(
        <div className="time-picker-back" onMouseDown={() => setOpen(false)}>
          <div
            ref={dialogRef}
            className="time-picker-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={dialogTitle}
            tabIndex={-1}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="time-picker-head">
              <h2>{dialogTitle}</h2>
              {sameAs !== undefined && (
                <label className="time-picker-same">
                  <span>{sameTimeLabel}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={sameTime}
                    className={cx("time-switch", sameTime && "on")}
                    disabled={!isHhmm(sameAs)}
                    onClick={() => setSameTime((current) => !current)}
                  >
                    <span className="time-switch-knob" />
                  </button>
                </label>
              )}
            </div>

            <div className={cx("time-picker-body", sameTime && "locked")}>
              <div className="time-spinner">
                <button type="button" className="time-spin-btn" aria-label="Increase hour" disabled={sameTime} onClick={() => bumpHour(1)}>
                  <Plus size={18} />
                </button>
                <input
                  className="time-spin-value"
                  inputMode="numeric"
                  aria-label="Hour"
                  disabled={sameTime}
                  value={hour12}
                  onChange={(event) => {
                    const next = Number(event.target.value.replace(/\D/g, "").slice(0, 2));
                    if (!Number.isFinite(next)) return;
                    setSameTime(false);
                    setHour12(wrap(next === 0 ? 12 : next, 1, 12));
                  }}
                />
                <button type="button" className="time-spin-btn" aria-label="Decrease hour" disabled={sameTime} onClick={() => bumpHour(-1)}>
                  <Minus size={18} />
                </button>
              </div>

              <span className="time-colon" aria-hidden>:</span>

              <div className="time-spinner">
                <button type="button" className="time-spin-btn" aria-label="Increase minutes" disabled={sameTime} onClick={() => bumpMinute(1)}>
                  <Plus size={18} />
                </button>
                <input
                  className="time-spin-value"
                  inputMode="numeric"
                  aria-label="Minutes"
                  disabled={sameTime}
                  value={String(minute).padStart(2, "0")}
                  onChange={(event) => {
                    const next = Number(event.target.value.replace(/\D/g, "").slice(0, 2));
                    if (!Number.isFinite(next) || next > 59) return;
                    setSameTime(false);
                    setMinute(next);
                  }}
                />
                <button type="button" className="time-spin-btn" aria-label="Decrease minutes" disabled={sameTime} onClick={() => bumpMinute(-1)}>
                  <Minus size={18} />
                </button>
              </div>

              <div className="time-period" role="group" aria-label="AM or PM">
                {(["am", "pm"] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={cx("time-period-btn", period === item && "on")}
                    aria-pressed={period === item}
                    disabled={sameTime}
                    onClick={() => {
                      setSameTime(false);
                      setPeriod(item);
                    }}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>

            <Button className="time-picker-confirm" onClick={save}>Save</Button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

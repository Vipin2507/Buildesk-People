import { useState } from "react";
import { Banner, Button, DatePicker, Field } from "./ui";
import { holidayMatchesDate } from "../domain/holidays";
import { formatDateLong, formatHolidayDate } from "../lib/format";
import { useApp } from "../store/store";
import type { Holiday } from "../types";

const EMPTY: Holiday = { id: "", name: "", date: "", locationId: "all", recurrence: "once" };

export function MarkHolidayControls({
  date,
  compact,
}: {
  date: string;
  compact?: boolean;
}) {
  const { can, state, actions } = useApp();
  const [open, setOpen] = useState(false);
  const [holiday, setHoliday] = useState<Holiday>({ ...EMPTY, date });
  const [error, setError] = useState("");
  if (!can("leave.manage")) return null;

  const already = state.holidays.some((item) => holidayMatchesDate(item, date));

  return (
    <>
      <Button
        size="sm"
        variant={compact ? "secondary" : "primary"}
        onClick={() => {
          setHoliday({ ...EMPTY, date, recurrence: "once" });
          setError("");
          setOpen(true);
        }}
      >
        {already ? "Add another holiday" : "Mark day as holiday"}
      </Button>
      {open && (
        <div className="modal-back" onMouseDown={() => setOpen(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="Mark day as holiday" onMouseDown={(event) => event.stopPropagation()}>
            <div className="spread">
              <h2>Mark day as holiday</h2>
              <Button variant="ghost" onClick={() => setOpen(false)} aria-label="Close dialog">Close</Button>
            </div>
            <p className="muted">
              Works for past and future dates. Fixed national days can repeat every year; festivals that move need a one-time date for that year.
            </p>
            {error && <Banner tone="error">{error}</Banner>}
            <Field label="Name"><input value={holiday.name} onChange={(event) => setHoliday({ ...holiday, name: event.target.value })} placeholder="e.g. Company foundation day" /></Field>
            <Field label="Date">
              <DatePicker value={holiday.date} onChange={(next) => setHoliday({ ...holiday, date: next })} />
            </Field>
            <Field label="Repeats">
              <select
                value={holiday.recurrence ?? "once"}
                onChange={(event) => setHoliday({ ...holiday, recurrence: event.target.value as Holiday["recurrence"] })}
              >
                <option value="once">One-time date (this year only)</option>
                <option value="annual">Every year on this month and day</option>
              </select>
            </Field>
            <p className="faint">
              {holiday.recurrence === "annual"
                ? `Year in the date picker only sets the month and day — this will apply as ${formatHolidayDate(holiday.date || date, "annual")}.`
                : `Saved as ${holiday.date ? formatDateLong(holiday.date) : formatDateLong(date)} only.`}
            </p>
            <Field label="Applies to">
              <select value={holiday.locationId} onChange={(event) => setHoliday({ ...holiday, locationId: event.target.value })}>
                <option value="all">All offices</option>
                {state.locations.filter((item) => item.active !== false).map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </Field>
            <div className="actions">
              <Button
                onClick={async () => {
                  const result = await actions.saveHoliday(holiday);
                  if (!result.ok) setError(result.message);
                  else setOpen(false);
                }}
              >
                Save holiday
              </Button>
              <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

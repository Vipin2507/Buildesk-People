import { useState } from "react";
import { Link } from "react-router-dom";
import { officeClosedToday, todayRecord } from "../domain/attendance";
import { todayIso } from "../domain/dates";
import { holidaysFor } from "../domain/leave";
import { formatDate, formatDuration, formatTime, labelFor, shiftLabel } from "../lib/format";
import { useApp } from "../store/store";
import type { WorkMode } from "../types";
import { Banner, Button, StatusBadge } from "./ui";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function ClockCard({ showLinks = false }: { showLinks?: boolean }) {
  const { state, user, actions } = useApp();
  const [mode, setMode] = useState<WorkMode>("office");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  if (!user) return null;
  const record = todayRecord(state, user.id);
  const closed = officeClosedToday(state, user.locationId);
  const holiday = holidaysFor(todayIso(), user.locationId, state.holidays)[0];
  const location = state.locations.find((item) => item.id === user.locationId)?.name ?? "Work location not set";
  const inProgress = Boolean(record?.clockIn && !record.clockOut);
  const done = Boolean(record?.clockIn && record.clockOut);
  const onLeave = record?.status === "leave";
  const headline = onLeave ? "On leave" : !record?.clockIn ? "Not clocked in" : inProgress ? "Working" : "Clocked out";
  const offDays = state.settings.weeklyOff.map((day) => WEEKDAYS[day] ?? "Day").join(", ") || "None";

  const punch = async (kind: "in" | "out") => {
    setPending(true);
    const result = kind === "in" ? await actions.clockIn(mode) : await actions.clockOut();
    setPending(false);
    setError(result.ok ? "" : result.message);
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Today's attendance</h2>
        {record && <StatusBadge value={inProgress ? "in_progress" : record.status} />}
      </div>
      <p className="eyebrow">{formatDate(todayIso())} · {location}</p>
      <p>
        <strong>{headline}</strong>
        <span className="muted"> · {closed === "weekend" ? "Weekend" : closed === "holiday" ? (holiday?.name ?? "Holiday") : "Working day"}</span>
      </p>
      {closed && (
        <p className="muted">
          {closed === "weekend" ? "Today is a configured weekly off." : `Today is a holiday at ${location}.`} You can still record time. Late status is not applied on non-working days.
        </p>
      )}
      {error && <Banner tone="error">{error}</Banner>}
      <div className="today-facts">
        <div><span>Clock in</span><strong>{formatTime(record?.clockIn ?? null)}</strong></div>
        <div><span>Clock out</span><strong>{formatTime(record?.clockOut ?? null)}</strong></div>
        <div><span>Hours</span><strong>{formatDuration(record?.clockIn ?? null, record?.clockOut ?? null)}</strong></div>
        <div><span>Work location</span><strong>{record?.workMode ? labelFor(record.workMode) : "Not recorded yet"}</strong></div>
      </div>
      <p className="hint">The work location is the option you select. Buildesk People does not collect GPS location.</p>
      {!done && !inProgress && !onLeave && (
        <div className="punch-row">
          <label className="field">
            <span>Where are you working?</span>
            <select value={mode} onChange={(event) => setMode(event.target.value as WorkMode)} disabled={pending}>
              <option value="office">Office</option>
              <option value="remote">Remote</option>
              <option value="client">Client site</option>
            </select>
          </label>
          <Button onClick={() => punch("in")} disabled={pending}>Clock in</Button>
        </div>
      )}
      {inProgress && <Button onClick={() => punch("out")} disabled={pending}>Clock out</Button>}
      {done && <p>You're clocked out for today. Request a correction if a punch is wrong.</p>}
      {onLeave && <p>You're on approved leave today. A reviewer has to change that before a punch can be recorded.</p>}
      <p className="faint">{shiftLabel(state.settings.workStart, state.settings.graceMinutes)} · Weekly off: {offDays}</p>
      {showLinks && (
        <p className="actions">
          <Link className="btn btn-secondary btn-sm" to="/attendance?tab=mine">Attendance history</Link>
          <Link className="btn btn-ghost btn-sm" to="/attendance?tab=mine&correct=1">Request a correction</Link>
        </p>
      )}
    </section>
  );
}

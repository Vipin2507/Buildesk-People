import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { officeClosedToday, todayRecord } from "../domain/attendance";
import { todayIso } from "../domain/dates";
import { locationWords } from "../domain/location";
import { holidaysFor } from "../domain/leave";
import { captureCurrentLocation, type CapturedFix, type GeoFailure } from "../lib/geolocation";
import { formatDate, formatDuration, formatTime, labelFor, shiftLabel } from "../lib/format";
import { useApp } from "../store/store";
import type { LocationCaptureStatus, WorkMode } from "../types";
import { LocationView } from "./location-view";
import { Banner, Button, StatusBadge } from "./ui";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const EXPLANATION = "Buildesk People will use your location once to record where you are working for this attendance punch. Your location is visible to you and authorized HR reviewers.";

type UiStatus = "not_requested" | "getting" | "captured" | "denied" | "unavailable" | "timeout";

function statusLabel(status: UiStatus): string {
  if (status === "not_requested") return "Not requested";
  if (status === "getting") return "Getting location";
  if (status === "captured") return "Location captured";
  if (status === "denied") return "Permission denied";
  return "Location unavailable / timed out";
}

function failureStatus(reason: GeoFailure): UiStatus {
  if (reason === "denied") return "denied";
  if (reason === "timeout") return "timeout";
  return "unavailable";
}

function storedStatus(reason: GeoFailure): LocationCaptureStatus {
  if (reason === "denied") return "denied";
  return "unavailable";
}

export function ClockCard({ showLinks = false }: { showLinks?: boolean }) {
  const { state, user, actions } = useApp();
  const [mode, setMode] = useState<WorkMode>("office");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [ui, setUi] = useState<UiStatus>("not_requested");
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [failure, setFailure] = useState<GeoFailure | null>(null);
  const [held, setHeld] = useState<CapturedFix | null>(null);
  const busy = useRef(false);
  if (!user) return null;
  const record = todayRecord(state, user.id);
  const closed = officeClosedToday(state, user.locationId);
  const holiday = holidaysFor(todayIso(), user.locationId, state.holidays)[0];
  const location = state.locations.find((item) => item.id === user.locationId)?.name ?? "Work location not set";
  const inProgress = Boolean(record?.clockIn && !record.clockOut);
  const done = Boolean(record?.clockIn && record.clockOut);
  const onLeave = record?.status === "leave";
  const required = state.settings.attendanceLocationRequired === true;
  const headline = onLeave ? "On leave" : !record?.clockIn ? "Not clocked in" : inProgress ? "Working" : "Clocked out";
  const offDays = state.settings.weeklyOff.map((day) => WEEKDAYS[day] ?? "Day").join(", ") || "None";
  const liveStatus = ui === "captured" && accuracy != null ? `Location recorded · accuracy ±${accuracy} m` : statusLabel(ui);

  const save = async (kind: "in" | "out", payload: { status: LocationCaptureStatus; latitude: number | null; longitude: number | null; accuracyMeters: number | null }) => {
    const result = kind === "in" ? await actions.clockIn(mode, payload) : await actions.clockOut(payload);
    if (!result.ok) {
      setError(result.message);
      return false;
    }
    setError("");
    setFailure(null);
    setHeld(null);
    setAccuracy(null);
    setUi("not_requested");
    return true;
  };

  const startPunch = async (kind: "in" | "out") => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    setFailure(null);
    setHeld(null);
    setAccuracy(null);
    setUi("getting");
    try {
      const captured = await captureCurrentLocation();
      if (!captured.ok) {
        setUi(failureStatus(captured.reason));
        setFailure(captured.reason);
        const next = required
          ? `${captured.message} Your company requires a location, so this punch cannot be saved until a position is captured.`
          : `${captured.message} Location is optional, so you can finish this punch with location not shared.`;
        setError(next);
        return;
      }
      const rounded = Math.round(captured.fix.accuracyMeters);
      setAccuracy(rounded);
      setUi("captured");
      setHeld(captured.fix);
      const saved = await save(kind, {
        status: "captured",
        latitude: captured.fix.latitude,
        longitude: captured.fix.longitude,
        accuracyMeters: captured.fix.accuracyMeters,
      });
      if (!saved) setHeld(captured.fix);
    } finally {
      busy.current = false;
      setPending(false);
    }
  };

  const finishWithout = async (kind: "in" | "out") => {
    if (busy.current || required || !failure) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      await save(kind, { status: storedStatus(failure), latitude: null, longitude: null, accuracyMeters: null });
    } finally {
      busy.current = false;
      setPending(false);
    }
  };

  const saveHeld = async (kind: "in" | "out") => {
    if (busy.current || !held) return;
    busy.current = true;
    setPending(true);
    try {
      await save(kind, {
        status: "captured",
        latitude: held.latitude,
        longitude: held.longitude,
        accuracyMeters: held.accuracyMeters,
      });
    } finally {
      busy.current = false;
      setPending(false);
    }
  };

  const actionsFor = (kind: "in" | "out") => {
    const label = kind === "in" ? "Clock in" : "Clock out";
    if (held && error) {
      return (
        <>
          <Button onClick={() => saveHeld(kind)} disabled={pending}>{pending ? "Saving…" : "Save punch"}</Button>
          <Button variant="secondary" onClick={() => startPunch(kind)} disabled={pending}>Try location again</Button>
        </>
      );
    }
    return (
      <>
        <Button onClick={() => startPunch(kind)} disabled={pending} aria-describedby="punch-location-note">
          {pending && ui === "getting" ? "Getting location…" : pending ? "Saving…" : failure ? "Try location again" : label}
        </Button>
        {!required && failure && !pending && (
          <Button variant="secondary" onClick={() => finishWithout(kind)}>{kind === "in" ? "Clock in with location not shared" : "Clock out with location not shared"}</Button>
        )}
      </>
    );
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
      {record?.clockInLocation?.status === "captured" ? (
        <LocationView label="Clock-in device location" fix={record.clockInLocation} recordId={record.id} which="in" />
      ) : record?.clockIn ? (
        <p className="hint">Clock-in device location: {locationWords(record.clockInLocation)}</p>
      ) : null}
      {record?.clockOutLocation?.status === "captured" ? (
        <LocationView label="Clock-out device location" fix={record.clockOutLocation} recordId={record.id} which="out" />
      ) : record?.clockOut ? (
        <p className="hint">Clock-out device location: {locationWords(record.clockOutLocation)}</p>
      ) : null}
      {!done && !onLeave && (
        <div className="location-note" id="punch-location-note">
          <p>{EXPLANATION}</p>
          <p>{required ? "Your company requires a one-time location for each punch. Clock in and clock out are saved only after a position is captured." : "Location is optional. If it cannot be captured, you can finish the punch with location not shared."}</p>
          <p>Office, Remote, and Client site are the work location you select. They are separate from this device position. A device position does not prove who you are or that you are at a particular address.</p>
        </div>
      )}
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
          <div className="punch-actions">
            {actionsFor("in")}
            <span className="location-status" role="status" aria-live="polite">Location: {liveStatus}</span>
          </div>
        </div>
      )}
      {inProgress && (
        <div className="punch-actions">
          {actionsFor("out")}
          <span className="location-status" role="status" aria-live="polite">Location: {liveStatus}</span>
        </div>
      )}
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

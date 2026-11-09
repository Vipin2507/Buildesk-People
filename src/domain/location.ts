import { addDays, todayIso } from "./dates";
import type { AppState, LocationCaptureStatus, PunchLocation } from "../types";

const STATUSES: LocationCaptureStatus[] = ["captured", "denied", "unavailable", "not_requested", "manual"];

export function withAttendancePolicy(state: AppState): AppState {
  const days = state.settings.locationRetentionDays;
  const locationRetentionDays = typeof days === "number" && Number.isInteger(days) && days >= 1 ? days : null;
  return {
    ...state,
    settings: {
      ...state.settings,
      attendanceLocationRequired: state.settings.attendanceLocationRequired === true,
      locationRetentionDays,
    },
  };
}

function blank(status: LocationCaptureStatus): PunchLocation {
  return { status, latitude: null, longitude: null, accuracyMeters: null, capturedAt: null, placeLabel: null };
}

function finiteIn(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) return null;
  return value;
}

function hasCoordinates(body: Record<string, unknown>): boolean {
  return [body.latitude, body.longitude, body.accuracyMeters].some((value) => typeof value === "number" && Number.isFinite(value));
}

/** Accept a punch location from the client. Coordinates are kept only for a captured fix, and only at the precision the punch needs. */
export function acceptPunchLocation(raw: unknown, required: boolean): { ok: true; location: PunchLocation } | { ok: false; message: string } {
  if (raw == null) {
    if (required) return { ok: false, message: "This company requires a location for each punch. Allow location for this site and try again." };
    return { ok: true, location: blank("not_requested") };
  }
  if (typeof raw !== "object") return { ok: false, message: "The location on this punch could not be read." };
  const body = raw as Record<string, unknown>;
  const status = body.status;
  if (typeof status !== "string" || !STATUSES.includes(status as LocationCaptureStatus)) {
    return { ok: false, message: "The location on this punch could not be read." };
  }
  if (status !== "captured") {
    if (required) return { ok: false, message: "This company requires a location for each punch. Allow location for this site and try the punch again." };
    if (hasCoordinates(body)) return { ok: false, message: "A punch without a captured location cannot include coordinates." };
    return { ok: true, location: blank(status as LocationCaptureStatus) };
  }
  const latitude = finiteIn(body.latitude, -90, 90);
  const longitude = finiteIn(body.longitude, -180, 180);
  const accuracyMeters = finiteIn(body.accuracyMeters, 0, 100000);
  if (latitude == null || longitude == null || accuracyMeters == null) {
    return { ok: false, message: "The captured location was incomplete, so the punch was not saved." };
  }
  return {
    ok: true,
    location: {
      status: "captured",
      latitude: Math.round(latitude * 1e5) / 1e5,
      longitude: Math.round(longitude * 1e5) / 1e5,
      accuracyMeters: Math.round(accuracyMeters),
      capturedAt: null,
      placeLabel: null,
    },
  };
}

export function locationAuditPhrase(fix: PunchLocation): string {
  if (fix.status === "captured") return "Location recorded.";
  if (fix.status === "denied" || fix.status === "manual") return "Location not shared.";
  if (fix.status === "unavailable") return "Location unavailable.";
  return "Location not requested.";
}

export function locationSummary(fix: PunchLocation | null | undefined): string {
  if (!fix || fix.status === "not_requested") return "Not requested";
  if (fix.status === "denied") return "Location not shared · permission denied";
  if (fix.status === "manual") return "Location not shared";
  if (fix.status === "unavailable") return "Location not shared · location unavailable";
  if (fix.latitude == null || fix.longitude == null) return "Location no longer stored";
  const accuracy = fix.accuracyMeters == null ? "" : ` · accuracy ±${Math.round(fix.accuracyMeters)} m`;
  return `Location recorded${accuracy}`;
}

/** Written place for lists. Falls back to a status phrase when no address has been looked up. */
export function locationWords(fix: PunchLocation | null | undefined): string {
  if (!fix || fix.status === "not_requested") return "Not requested";
  if (fix.status === "denied") return "Location not shared · permission denied";
  if (fix.status === "manual") return "Location not shared";
  if (fix.status === "unavailable") return "Location not shared · location unavailable";
  if (fix.latitude == null || fix.longitude == null) return "Location no longer stored";
  return fix.placeLabel?.trim() || "Location recorded";
}

export function punchLocationText(record: { clockIn: string | null; clockOut: string | null; clockInLocation?: PunchLocation | null; clockOutLocation?: PunchLocation | null }): string {
  const parts: string[] = [];
  if (record.clockIn) parts.push(`In: ${locationWords(record.clockInLocation)}`);
  if (record.clockOut) parts.push(`Out: ${locationWords(record.clockOutLocation)}`);
  return parts.join(" · ") || "—";
}

function ageOut(fix: PunchLocation | null | undefined, cutoff: string): PunchLocation | null | undefined {
  if (!fix || fix.status !== "captured" || fix.latitude == null || !fix.capturedAt) return fix;
  if (fix.capturedAt.slice(0, 10) >= cutoff) return fix;
  return { ...fix, latitude: null, longitude: null, accuracyMeters: null, placeLabel: null };
}

/** Remove coordinates older than the configured retention. The punch and its capture status stay. No period is applied when retention is unset. */
export function applyLocationRetention(state: AppState): { state: AppState; changed: boolean } {
  const days = state.settings.locationRetentionDays;
  if (days == null) return { state, changed: false };
  const cutoff = addDays(todayIso(), -days);
  let changed = false;
  const attendance = state.attendance.map((record) => {
    const clockInLocation = ageOut(record.clockInLocation, cutoff);
    const clockOutLocation = ageOut(record.clockOutLocation, cutoff);
    if (clockInLocation !== record.clockInLocation || clockOutLocation !== record.clockOutLocation) {
      changed = true;
      return { ...record, clockInLocation, clockOutLocation };
    }
    return record;
  });
  const regularizations = state.regularizations.map((request) => {
    const originalClockInLocation = ageOut(request.originalClockInLocation, cutoff);
    const originalClockOutLocation = ageOut(request.originalClockOutLocation, cutoff);
    if (originalClockInLocation !== request.originalClockInLocation || originalClockOutLocation !== request.originalClockOutLocation) {
      changed = true;
      return { ...request, originalClockInLocation, originalClockOutLocation };
    }
    return request;
  });
  if (!changed) return { state, changed: false };
  return { state: { ...state, attendance, regularizations }, changed: true };
}

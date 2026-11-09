export type GeoFailure = "unsupported" | "insecure" | "denied" | "unavailable" | "timeout" | "policy";

export interface CapturedFix {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
}

export type CaptureResult =
  | { ok: true; fix: CapturedFix }
  | { ok: false; reason: GeoFailure; message: string };

const TIMEOUT_MS = 12000;

function failed(reason: GeoFailure, message: string): CaptureResult {
  return { ok: false, reason, message };
}

/**
 * One-time position for the punch the employee just started.
 * This is the only geolocation call in the app. It must not use watchPosition or run on page load.
 */
export function captureCurrentLocation(): Promise<CaptureResult> {
  if (typeof window === "undefined" || !window.isSecureContext) {
    return Promise.resolve(failed("insecure", "Location is only available on a secure page. Open this site with HTTPS and try again."));
  }
  if (!navigator.geolocation || typeof navigator.geolocation.getCurrentPosition !== "function") {
    return Promise.resolve(failed("unsupported", "This browser cannot provide a location."));
  }
  return new Promise((resolve) => {
    try {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude, accuracy } = position.coords;
          if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(accuracy)) {
            resolve(failed("unavailable", "This device could not provide a position."));
            return;
          }
          resolve({ ok: true, fix: { latitude, longitude, accuracyMeters: accuracy } });
        },
        (error) => {
          const text = typeof error?.message === "string" ? error.message : "";
          if (/permissions policy/i.test(text)) {
            resolve(failed("policy", "This site is blocked from using location by a browser policy. Allow geolocation for this site's own address, then try again."));
            return;
          }
          if (error?.code === 1) resolve(failed("denied", "Location permission was denied."));
          else if (error?.code === 3) resolve(failed("timeout", "The location request timed out."));
          else resolve(failed("unavailable", "This device could not provide a position."));
        },
        { enableHighAccuracy: true, timeout: TIMEOUT_MS, maximumAge: 0 },
      );
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      const text = error instanceof Error ? error.message : "";
      if (name === "SecurityError" || /permissions policy/i.test(text)) {
        resolve(failed("policy", "This site is blocked from using location by a browser policy. Allow geolocation for this site's own address, then try again."));
        return;
      }
      resolve(failed("unavailable", "This device could not provide a position."));
    }
  });
}

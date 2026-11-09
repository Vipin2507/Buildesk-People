import { useEffect, useRef, useState } from "react";
import { locationSummary } from "../domain/location";
import { formatDateTime } from "../lib/format";
import { useApp } from "../store/store";
import type { PunchLocation } from "../types";
import { Button } from "./ui";

function PlaceCards({ label }: { label: string }) {
  const [country, state, ...rest] = label.split(" · ").map((part) => part.trim()).filter(Boolean);
  const city = rest.join(", ");
  const cards = [
    country ? { name: "Country", value: country } : null,
    state ? { name: "State", value: state } : null,
    city ? { name: "City", value: city } : null,
  ].filter((item): item is { name: string; value: string } => Boolean(item));
  if (cards.length === 0) return <p>{label}</p>;
  return (
    <dl className="place-grid">
      {cards.map((item) => (
        <div key={item.name}>
          <dt>{item.name}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function mapSource(fix: PunchLocation): string {
  const latitude = fix.latitude ?? 0;
  const longitude = fix.longitude ?? 0;
  const pad = Math.min(Math.max((fix.accuracyMeters ?? 150) / 111320, 0.004), 0.02);
  const bbox = [longitude - pad, latitude - pad, longitude + pad, latitude + pad].map((value) => value.toFixed(5)).join(",");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${encodeURIComponent(`${latitude},${longitude}`)}`;
}

export function LocationView({
  label,
  fix,
  recordId,
  which,
}: {
  label: string;
  fix: PunchLocation | null | undefined;
  recordId?: string;
  which: "in" | "out";
}) {
  const { actions } = useApp();
  const lookup = useRef(actions.lookupPlace);
  lookup.current = actions.lookupPlace;
  const captured = Boolean(fix && fix.status === "captured" && fix.latitude != null && fix.longitude != null);
  const [place, setPlace] = useState(fix?.placeLabel ?? "");
  const [phase, setPhase] = useState<"ready" | "loading" | "failed">(fix?.placeLabel ? "ready" : "loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (fix?.placeLabel?.includes(" · ")) {
      setPlace(fix.placeLabel);
      setPhase("ready");
      return;
    }
    if (!captured || !recordId) {
      setPhase("failed");
      return;
    }
    let cancel = false;
    setPhase("loading");
    lookup.current(recordId, which).then((labelText) => {
      if (cancel) return;
      if (labelText) {
        setPlace(labelText);
        setPhase("ready");
      } else {
        setPhase("failed");
      }
    });
    return () => {
      cancel = true;
    };
  }, [attempt, captured, fix?.placeLabel, recordId, which]);

  return (
    <section className="location-view" aria-label={label}>
      <h3>{label}</h3>
      <p>{locationSummary(fix)}</p>
      {captured && fix && (
        <>
          {phase === "loading" && <p>Looking up country, state, and city…</p>}
          {phase === "failed" && <p>Country, state, and city could not be looked up.</p>}
          {phase === "ready" && <PlaceCards label={place} />}
          {phase === "failed" && (
            <Button size="sm" variant="secondary" onClick={() => setAttempt((value) => value + 1)}>Try the place again</Button>
          )}
          {fix.capturedAt && <p className="faint">{formatDateTime(fix.capturedAt)}</p>}
          <iframe className="location-map" title={`Map of the ${label.toLowerCase()}`} src={mapSource(fix)} loading="lazy" />
          <p className="faint">Country, state, and city names come from the Country State City directory. The map is OpenStreetMap. They describe this device position and do not prove identity or a street address.</p>
        </>
      )}
    </section>
  );
}

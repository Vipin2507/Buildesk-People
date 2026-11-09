import { loadEnv } from "./env.ts";

interface NominatimAddress {
  [key: string]: string | undefined;
}

interface NamedPlace {
  name: string;
  iso2?: string;
}

interface RoughPlace {
  countryCode: string;
  country: string;
  state: string;
  cities: string[];
}

const CSC = "https://api.countrystatecity.in/v1";
let countryCache: NamedPlace[] | null = null;
const statesCache = new Map<string, NamedPlace[]>();
const citiesCache = new Map<string, NamedPlace[]>();

function clean(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function sameName(left: string, right: string): boolean {
  const a = left.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const b = right.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
}

function matchPlace(name: string, items: NamedPlace[]): NamedPlace | null {
  const exact = items.find((item) => item.name.toLowerCase() === name.toLowerCase());
  if (exact) return exact;
  return items.find((item) => sameName(item.name, name)) ?? null;
}

async function csc<T>(path: string): Promise<T | null> {
  loadEnv();
  const key = process.env.CSC_API_KEY;
  if (!key) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${CSC}${path}`, {
      signal: controller.signal,
      headers: { accept: "application/json", "X-CSCAPI-KEY": key },
    });
    if (!response.ok) return null;
    return await response.json() as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function statesFor(countryCode: string): Promise<NamedPlace[]> {
  const cached = statesCache.get(countryCode);
  if (cached) return cached;
  const items = await csc<NamedPlace[]>(`/countries/${countryCode}/states`);
  const list = Array.isArray(items) ? items.filter((item) => item?.name) : [];
  if (list.length) statesCache.set(countryCode, list);
  return list;
}

async function citiesFor(countryCode: string, stateCode: string): Promise<NamedPlace[]> {
  const key = `${countryCode}/${stateCode}`;
  const cached = citiesCache.get(key);
  if (cached) return cached;
  const items = await csc<NamedPlace[]>(`/countries/${countryCode}/states/${stateCode}/cities`);
  const list = Array.isArray(items) ? items.filter((item) => item?.name) : [];
  if (list.length) citiesCache.set(key, list);
  return list;
}

async function fromNominatim(latitude: number, longitude: number): Promise<RoughPlace | null> {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", String(latitude));
  url.searchParams.set("lon", String(longitude));
  url.searchParams.set("zoom", "14");
  url.searchParams.set("addressdetails", "1");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "accept-language": "en",
        "user-agent": "BuildeskPeople/1.0 (attendance location display)",
      },
    });
    if (!response.ok) return null;
    const body = await response.json() as { address?: NominatimAddress };
    const address = body.address ?? {};
    const countryCode = clean(address.country_code).toUpperCase();
    const country = clean(address.country);
    const state = clean(address.state);
    const cities = [address.city, address.town, address.village, address.municipality, address.city_district, address.state_district, address.county]
      .map((part) => clean(part))
      .filter((part, index, all) => part && all.indexOf(part) === index);
    if (!country && !state && cities.length === 0) return null;
    return { countryCode, country, state, cities };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fromCountryStateCity(rough: RoughPlace): Promise<RoughPlace | null> {
  if (!rough.countryCode) return null;
  if (!countryCache) {
    const items = await csc<NamedPlace[]>("/countries");
    if (Array.isArray(items) && items.length) countryCache = items;
  }
  const country = countryCache?.find((item) => item.iso2?.toUpperCase() === rough.countryCode) ?? null;
  const states = await statesFor(rough.countryCode);
  const state = rough.state ? matchPlace(rough.state, states) : null;
  const cities = state?.iso2 ? await citiesFor(rough.countryCode, state.iso2) : [];
  const city = rough.cities.map((name) => cities.find((item) => item.name.toLowerCase() === name.toLowerCase())).find(Boolean) ?? null;
  if (!country && !state && !city) return null;
  return {
    countryCode: rough.countryCode,
    country: country?.name || rough.country,
    state: state?.name || rough.state,
    city: city?.name || rough.cities[0] || "",
  };
}

/** Country, state, and city for display. Coordinates are not sent to the country directory. */
export async function describePlace(latitude: number, longitude: number): Promise<string | null> {
  const rough = await fromNominatim(latitude, longitude);
  if (!rough) return null;
  const refined = await fromCountryStateCity(rough);
  const place = refined ?? rough;
  const parts = [place.country, place.state, place.city].filter(Boolean);
  return parts.length >= 2 ? parts.join(" · ") : null;
}

import type { HrMeetingSlot, Microsoft365Config } from "../src/types.ts";
import { microsoftGraphConfigured, neutralCalendarTitle, slotEndIso } from "../src/domain/hr-meeting.ts";
import { normalizeMicrosoft365 } from "../src/domain/hr-meeting.ts";

type TokenCache = { accessToken: string; expiresAt: number };

let tokenCache: TokenCache | null = null;

export function microsoftClientSecret(): string {
  return (process.env.MICROSOFT_CLIENT_SECRET || process.env.AZURE_CLIENT_SECRET || "").trim();
}

export function graphIsLive(config: Microsoft365Config): boolean {
  return microsoftGraphConfigured(normalizeMicrosoft365(config), Boolean(microsoftClientSecret()));
}

async function getAppToken(config: Microsoft365Config): Promise<{ ok: true; token: string } | { ok: false; message: string }> {
  const secret = microsoftClientSecret();
  if (!graphIsLive(config)) {
    return { ok: false, message: "Microsoft 365 is not connected. Set tenant, client id, organizer, enable the integration, turn off demo mode, and set MICROSOFT_CLIENT_SECRET." };
  }
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return { ok: true, token: tokenCache.accessToken };
  }
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: secret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  try {
    const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const json = await res.json() as { access_token?: string; expires_in?: number; error_description?: string };
    if (!res.ok || !json.access_token) {
      return { ok: false, message: json.error_description || `Token request failed (HTTP ${res.status}).` };
    }
    tokenCache = {
      accessToken: json.access_token,
      expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
    };
    return { ok: true, token: json.access_token };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Token request failed." };
  }
}

async function graphFetch(
  config: Microsoft365Config,
  path: string,
  init: RequestInit = {},
): Promise<{ ok: true; status: number; json: Record<string, unknown> } | { ok: false; status: number; message: string }> {
  const token = await getAppToken(config);
  if (!token.ok) return { ok: false, status: 0, message: token.message };
  try {
    const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token.token}`,
        "Content-Type": "application/json",
        Prefer: 'outlook.timezone="UTC"',
        ...(init.headers || {}),
      },
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) as Record<string, unknown> : {};
    if (!res.ok) {
      const err = json.error as { message?: string; code?: string } | undefined;
      return { ok: false, status: res.status, message: err?.message || `Graph HTTP ${res.status}` };
    }
    return { ok: true, status: res.status, json };
  } catch (error) {
    return { ok: false, status: 0, message: error instanceof Error ? error.message : "Graph request failed." };
  }
}

function eventBody(input: {
  title: string;
  slot: HrMeetingSlot;
  attendeeEmail: string;
  attendeeName: string;
  teams: boolean;
  idempotencyKey: string;
}) {
  const { startIso, endIso } = slotEndIso(input.slot);
  return {
    subject: input.title,
    body: {
      contentType: "HTML",
      content: "<p>HR meeting scheduled in Buildesk People. Sensitive request details are not included in this invitation.</p>",
    },
    start: { dateTime: startIso, timeZone: input.slot.timezone },
    end: { dateTime: endIso, timeZone: input.slot.timezone },
    attendees: [
      {
        emailAddress: { address: input.attendeeEmail, name: input.attendeeName },
        type: "required",
      },
    ],
    isOnlineMeeting: input.teams,
    onlineMeetingProvider: input.teams ? "teamsForBusiness" : undefined,
    transactionId: input.idempotencyKey.slice(0, 64),
  };
}

export type GraphEventResult = {
  eventId: string;
  joinUrl: string | null;
  webLink: string | null;
};

export async function createOrganizerEvent(
  config: Microsoft365Config,
  input: {
    organizerEmail: string;
    title: string;
    slot: HrMeetingSlot;
    attendeeEmail: string;
    attendeeName: string;
    teams: boolean;
    idempotencyKey: string;
  },
): Promise<{ ok: true; event: GraphEventResult } | { ok: false; message: string; retryable: boolean }> {
  const path = `/users/${encodeURIComponent(input.organizerEmail)}/events`;
  const result = await graphFetch(config, path, {
    method: "POST",
    body: JSON.stringify(eventBody(input)),
  });
  if (!result.ok) {
    return { ok: false, message: result.message, retryable: result.status === 429 || result.status >= 500 || result.status === 0 };
  }
  const online = result.json.onlineMeeting as { joinUrl?: string } | undefined;
  return {
    ok: true,
    event: {
      eventId: String(result.json.id || ""),
      joinUrl: online?.joinUrl || null,
      webLink: typeof result.json.webLink === "string" ? result.json.webLink : null,
    },
  };
}

export async function updateOrganizerEvent(
  config: Microsoft365Config,
  input: {
    organizerEmail: string;
    eventId: string;
    title: string;
    slot: HrMeetingSlot;
    attendeeEmail: string;
    attendeeName: string;
    teams: boolean;
    idempotencyKey: string;
  },
): Promise<{ ok: true; event: GraphEventResult } | { ok: false; message: string; retryable: boolean }> {
  const path = `/users/${encodeURIComponent(input.organizerEmail)}/events/${encodeURIComponent(input.eventId)}`;
  const result = await graphFetch(config, path, {
    method: "PATCH",
    body: JSON.stringify(eventBody(input)),
  });
  if (!result.ok) {
    return { ok: false, message: result.message, retryable: result.status === 429 || result.status >= 500 || result.status === 0 };
  }
  const online = result.json.onlineMeeting as { joinUrl?: string } | undefined;
  return {
    ok: true,
    event: {
      eventId: String(result.json.id || input.eventId),
      joinUrl: online?.joinUrl || null,
      webLink: typeof result.json.webLink === "string" ? result.json.webLink : null,
    },
  };
}

export async function cancelOrganizerEvent(
  config: Microsoft365Config,
  organizerEmail: string,
  eventId: string,
): Promise<{ ok: true } | { ok: false; message: string; retryable: boolean }> {
  const path = `/users/${encodeURIComponent(organizerEmail)}/events/${encodeURIComponent(eventId)}`;
  const result = await graphFetch(config, path, { method: "DELETE" });
  if (!result.ok && result.status !== 404) {
    return { ok: false, message: result.message, retryable: result.status === 429 || result.status >= 500 || result.status === 0 };
  }
  return { ok: true };
}

export async function testMicrosoftConnection(config: Microsoft365Config): Promise<{ ok: boolean; message: string }> {
  const normalized = normalizeMicrosoft365(config);
  if (!normalized.defaultOrganizerEmail) {
    return { ok: false, message: "Set a default HR organizer mailbox first." };
  }
  if (!graphIsLive(normalized)) {
    return { ok: false, message: "Not connected. Demo mode or missing MICROSOFT_CLIENT_SECRET / tenant / client id." };
  }
  const result = await graphFetch(normalized, `/users/${encodeURIComponent(normalized.defaultOrganizerEmail)}?$select=id,mail,displayName`);
  if (!result.ok) return { ok: false, message: result.message };
  const mail = typeof result.json.mail === "string" ? result.json.mail : normalized.defaultOrganizerEmail;
  return { ok: true, message: `Connected. Organizer mailbox reachable (${mail}).` };
}

export function buildEventTitle(employeeName: string): string {
  return neutralCalendarTitle(employeeName);
}

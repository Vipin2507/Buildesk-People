/** Separate API client for Platform Admin — never shares client HRMS session handling. */

export type PlatformPayload = Record<string, unknown> & {
  ok?: boolean;
  message?: string;
  authenticated?: boolean;
};

export async function platformRequest(
  path: string,
  body?: unknown,
  method?: string,
): Promise<{ status: number; payload: PlatformPayload }> {
  const verb = method || (body === undefined ? "GET" : "POST");
  const response = await fetch(path, {
    method: verb,
    credentials: "include",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as PlatformPayload;
  return { status: response.status, payload };
}

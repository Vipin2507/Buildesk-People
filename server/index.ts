import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { findAccountByEmail, isValidEmail } from "../src/lib/auth.ts";
import { hasPermission } from "../src/lib/access.ts";
import { sessionEmployee } from "../src/lib/session.ts";
import { acceptInvitation, setAccountPassword } from "../src/store/mutations.ts";
import type { AppState } from "../src/types.ts";
import { actions } from "./actions.ts";
import { createSession, deleteSession, readSession, readWorkspace, resetWorkspace, writeWorkspace } from "./db.ts";
import { hashPassword, passwordProblem, verifyPassword } from "./password.ts";
import { presentWorkspace } from "./present.ts";

const PORT = Number(process.env.BUILDESK_API_PORT ?? 8787);
const COOKIE = "buildesk_session";

function send(response: ServerResponse, status: number, payload: unknown, extraHeaders: Record<string, string> = {}): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extraHeaders });
  response.end(JSON.stringify(payload));
}

function cookieHeader(token: string | null): string {
  if (!token) return `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
  return `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${14 * 24 * 60 * 60}`;
}

function tokenFrom(request: IncomingMessage): string | null {
  const header = request.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(raw) as unknown;
        resolve(parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {});
      } catch {
        reject(new Error("Send the request as JSON."));
      }
    });
    request.on("error", reject);
  });
}

function viewerState(accountId: string | null): { source: AppState; accountId: string | null } {
  const source = readWorkspace();
  if (!accountId) return { source, accountId: null };
  const account = source.accounts.find((item) => item.id === accountId && item.status === "active");
  return { source, accountId: account ? accountId : null };
}

function sessionStillValid(state: AppState, accountId: string): boolean {
  const account = state.accounts.find((item) => item.id === accountId);
  return Boolean(account && account.status === "active");
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  try {
    if (request.method === "GET" && url.pathname === "/api/health") {
      send(response, 200, { ok: true });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/bootstrap") {
      const { source, accountId } = viewerState(readSession(tokenFrom(request)));
      if (!accountId) {
        send(response, 200, { authenticated: false });
        return;
      }
      send(response, 200, { authenticated: true, state: presentWorkspace(source, accountId) });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/auth/signout") {
      deleteSession(tokenFrom(request));
      send(response, 200, { ok: true }, { "set-cookie": cookieHeader(null) });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/auth/signin") {
      const body = await readBody(request);
      const email = typeof body.email === "string" ? body.email : "";
      const password = typeof body.password === "string" ? body.password : "";
      if (!isValidEmail(email)) {
        send(response, 400, { ok: false, message: "Enter a valid work email." });
        return;
      }
      const source = readWorkspace();
      const account = findAccountByEmail(source.accounts, email);
      if (!account || (account.passwordHash && !verifyPassword(password, account.passwordHash))) {
        send(response, 401, { ok: false, message: "The email or password is incorrect." });
        return;
      }
      if (!account.passwordHash) {
        send(response, 200, { ok: false, setup: true, invited: account.status === "invited" });
        return;
      }
      if (account.status === "suspended") {
        send(response, 403, { ok: false, message: "This account is suspended. An administrator has to reactivate it." });
        return;
      }
      if (account.status === "deactivated") {
        send(response, 403, { ok: false, message: "This account is deactivated." });
        return;
      }
      const token = createSession(account.id);
      send(response, 200, { ok: true, state: presentWorkspace(source, account.id) }, { "set-cookie": cookieHeader(token) });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/auth/setup") {
      const body = await readBody(request);
      const email = typeof body.email === "string" ? body.email : "";
      const password = typeof body.password === "string" ? body.password : "";
      const confirm = typeof body.confirm === "string" ? body.confirm : "";
      const source = readWorkspace();
      const account = isValidEmail(email) ? findAccountByEmail(source.accounts, email) : undefined;
      if (!account) {
        send(response, 401, { ok: false, message: "The email or password is incorrect." });
        return;
      }
      if (account.passwordHash) {
        send(response, 400, { ok: false, message: "This account already has a password. Sign in with it." });
        return;
      }
      if (account.status === "suspended") {
        send(response, 403, { ok: false, message: "This account is suspended. An administrator has to reactivate it." });
        return;
      }
      if (account.status === "deactivated") {
        send(response, 403, { ok: false, message: "This account is deactivated." });
        return;
      }
      if (password !== confirm) {
        send(response, 400, { ok: false, message: "Those passwords do not match." });
        return;
      }
      const problem = passwordProblem(password, account.email);
      if (problem) {
        send(response, 400, { ok: false, message: problem });
        return;
      }
      let next = source;
      if (account.status === "invited") {
        const outcome = acceptInvitation(source, account.id);
        if (!outcome.result.ok) {
          send(response, 400, { ok: false, message: outcome.result.message });
          return;
        }
        next = { ...outcome.state, currentUserId: null };
      }
      const outcome = setAccountPassword(next, account.id, hashPassword(password));
      if (!outcome.result.ok) {
        send(response, 400, { ok: false, message: outcome.result.message });
        return;
      }
      const saved = { ...outcome.state, currentUserId: null };
      writeWorkspace(saved);
      const token = createSession(account.id);
      send(response, 200, { ok: true, state: presentWorkspace(saved, account.id) }, { "set-cookie": cookieHeader(token) });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/auth/password") {
      const token = tokenFrom(request);
      const { source, accountId } = viewerState(readSession(token));
      if (!accountId) {
        send(response, 401, { ok: false, message: "Sign in to continue." });
        return;
      }
      const body = await readBody(request);
      const current = typeof body.currentPassword === "string" ? body.currentPassword : "";
      const password = typeof body.password === "string" ? body.password : "";
      const confirm = typeof body.confirm === "string" ? body.confirm : "";
      const account = source.accounts.find((item) => item.id === accountId);
      if (!account?.passwordHash || !verifyPassword(current, account.passwordHash)) {
        send(response, 400, { ok: false, message: "The current password is incorrect." });
        return;
      }
      if (password !== confirm) {
        send(response, 400, { ok: false, message: "Those passwords do not match." });
        return;
      }
      const problem = passwordProblem(password, account.email);
      if (problem) {
        send(response, 400, { ok: false, message: problem });
        return;
      }
      const outcome = setAccountPassword(source, account.id, hashPassword(password));
      if (!outcome.result.ok) {
        send(response, 400, { ok: false, message: outcome.result.message });
        return;
      }
      const saved = { ...outcome.state, currentUserId: null };
      writeWorkspace(saved);
      send(response, 200, { ok: true, state: presentWorkspace(saved, account.id), toast: "Password updated." });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/workspace/reset") {
      const { source, accountId } = viewerState(readSession(tokenFrom(request)));
      const viewer = accountId ? sessionEmployee({ ...source, currentUserId: accountId }) : null;
      if (!viewer || !hasPermission(source, viewer, "settings.roles")) {
        send(response, 403, { ok: false, message: "Only a System admin can reset the workspace." });
        return;
      }
      const fresh = resetWorkspace();
      const kept = accountId && fresh.accounts.some((item) => item.id === accountId && item.status === "active") ? accountId : null;
      const token = kept ? createSession(kept) : null;
      send(
        response,
        200,
        { ok: true, authenticated: Boolean(kept), state: kept ? presentWorkspace(fresh, kept) : null, toast: "Workspace reset from the server seed." },
        { "set-cookie": cookieHeader(token) },
      );
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/actions") {
      const token = tokenFrom(request);
      const { source, accountId } = viewerState(readSession(token));
      if (!accountId) {
        send(response, 401, { ok: false, message: "Sign in to continue." });
        return;
      }
      const body = await readBody(request);
      const name = typeof body.action === "string" ? body.action : "";
      const handler = actions[name];
      if (!handler) {
        send(response, 404, { ok: false, message: "That action is not available." });
        return;
      }
      const input = body.input && typeof body.input === "object" ? body.input as Record<string, any> : {};
      const outcome = handler({ ...source, currentUserId: accountId }, input);
      if (!outcome.result.ok) {
        send(response, 200, { result: outcome.result, toast: outcome.toast, tone: outcome.tone ?? "error" });
        return;
      }
      const saved = { ...outcome.state, currentUserId: null };
      writeWorkspace(saved);
      const still = sessionStillValid(saved, accountId);
      if (!still) deleteSession(token);
      send(
        response,
        200,
        { result: outcome.result, toast: outcome.toast, tone: outcome.tone ?? "success", state: still ? presentWorkspace(saved, accountId) : null },
        still ? {} : { "set-cookie": cookieHeader(null) },
      );
      return;
    }

    send(response, 404, { ok: false, message: "Not found." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The server could not complete that request.";
    send(response, 400, { ok: false, message });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Buildesk People API listening on http://127.0.0.1:${PORT}`);
});

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { findAccountByEmail, isValidEmail } from "../src/lib/auth.ts";
import { canEditPhoto, canOpenProfile, hasPermission } from "../src/lib/access.ts";
import { sessionEmployee } from "../src/lib/session.ts";
import { acceptInvitation, rememberPlaceLabel, setAccountPassword, setEmployeePhoto } from "../src/store/mutations.ts";
import { loadEnv } from "./env.ts";
import { describePlace } from "./place.ts";

loadEnv();
import type { AppState } from "../src/types.ts";
import { actions } from "./actions.ts";
import { checkN8nHealth, checkWahaSession, postN8nWebhook, sendWahaText } from "./automation.ts";
import { afterActionAutomation } from "./automation-hooks.ts";
import { afterActionHrMeetingSync } from "./hr-meeting-hooks.ts";
import { processHrMeetingSync } from "./hr-meeting-sync.ts";
import { testMicrosoftConnection } from "./microsoft-graph.ts";
import { createSession, deleteSession, readSession, readWorkspace, writeWorkspace } from "./db.ts";
import { normalizeMicrosoft365 } from "../src/domain/hr-meeting.ts";
import { recordMicrosoft365Health } from "../src/store/mutations.ts";
import { hashPassword, passwordProblem, verifyPassword } from "./password.ts";
import { deletePhoto, readPhoto, writePhoto } from "./photos.ts";
import { renderPayslipPdf } from "./payslip-pdf.ts";
import { makeDocumentKey, readPayslipPdf, writePayslipPdf } from "./payslips-store.ts";
import { presentWorkspace } from "./present.ts";
import { buildPayslipDto } from "../src/domain/payslip.ts";
import { generatePayslip as generatePayslipMutation, publishPayslip as publishPayslipMutation, recordPayslipDownload } from "../src/store/mutations.ts";
import {
  appendAutomationLog,
  buildN8nWebhookUrl,
  emailEndpointReady,
  normalizeAutomationConfig,
  phoneToWahaChatId,
  renderAutomationTemplate,
  sampleAutomationVars,
  sanitizeLogPayload,
  wahaReady,
} from "../src/domain/automation.ts";
import { nowIso, uid } from "../src/domain/dates.ts";
import { fullName } from "../src/lib/format.ts";

const PORT = Number(process.env.PORT ?? process.env.BUILDESK_API_PORT ?? 8787);
const HOST = process.env.HOST ?? "127.0.0.1";
const COOKIE = "buildesk_session";
const DIST = resolve(process.cwd(), "dist");

/** Geolocation is allowed only for this site's own origin. Unrelated origins stay blocked. */
const SECURITY_HEADERS = { "permissions-policy": "geolocation=(self)" };

function send(response: ServerResponse, status: number, payload: unknown, extraHeaders: Record<string, string> = {}): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...SECURITY_HEADERS, ...extraHeaders });
  response.end(JSON.stringify(payload));
}

function cookieHeader(token: string | null, request: IncomingMessage): string {
  const forwarded = request.headers["x-forwarded-proto"];
  const secure = forwarded === "https" || (Array.isArray(forwarded) && forwarded.includes("https"));
  const flags = `HttpOnly; SameSite=Lax; Path=/${secure ? "; Secure" : ""}`;
  if (!token) return `${COOKIE}=; ${flags}; Max-Age=0`;
  return `${COOKIE}=${token}; ${flags}; Max-Age=${14 * 24 * 60 * 60}`;
}

function contentType(file: string): string {
  switch (extname(file)) {
    case ".html": return "text/html; charset=utf-8";
    case ".js":
    case ".mjs": return "text/javascript; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".svg": return "image/svg+xml";
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".webp": return "image/webp";
    case ".ico": return "image/x-icon";
    case ".json": return "application/json; charset=utf-8";
    case ".woff": return "font/woff";
    case ".woff2": return "font/woff2";
    default: return "application/octet-stream";
  }
}

function serveApp(request: IncomingMessage, response: ServerResponse, pathname: string): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  if (pathname.startsWith("/api/")) return false;
  const relative = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, "");
  let file = resolve(DIST, relative);
  if (file !== DIST && !file.startsWith(DIST + sep)) {
    response.writeHead(403, { "content-type": "text/plain; charset=utf-8", ...SECURITY_HEADERS });
    response.end("Forbidden");
    return true;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, "index.html");
  if (!existsSync(file)) {
    send(response, 503, { ok: false, message: "The site has not been built yet. Run npm run build." });
    return true;
  }
  const html = extname(file) === ".html";
  response.writeHead(200, {
    "content-type": contentType(file),
    "cache-control": html ? "no-cache" : "public, max-age=31536000, immutable",
    ...SECURITY_HEADERS,
  });
  if (request.method === "HEAD") {
    response.end();
    return true;
  }
  createReadStream(file).pipe(response);
  return true;
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

function readBytes(request: IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > max) {
        request.destroy();
        reject(new Error("That image is larger than 2 MB."));
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function employeeIdFromPhotoPath(pathname: string): string | null {
  const match = pathname.match(/^\/api\/people\/(emp_[a-z0-9_]+)\/photo$/i);
  return match?.[1] ?? null;
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
      send(response, 200, { ok: true }, { "set-cookie": cookieHeader(null, request) });
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
      if (!account) {
        const listed = source.employees.some((item) => item.email.toLowerCase() === email.trim().toLowerCase());
        send(response, 401, {
          ok: false,
          message: listed
            ? "This person is in the directory, but no login has been created. HR adds the login in User Management. The first sign-in is where the password is chosen."
            : "The email or password is incorrect.",
        });
        return;
      }
      if (account.passwordHash && !verifyPassword(password, account.passwordHash)) {
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
      send(response, 200, { ok: true, state: presentWorkspace(source, account.id) }, { "set-cookie": cookieHeader(token, request) });
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
      send(response, 200, { ok: true, state: presentWorkspace(saved, account.id) }, { "set-cookie": cookieHeader(token, request) });
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

    const photoEmployeeId = employeeIdFromPhotoPath(url.pathname);
    if (photoEmployeeId && (request.method === "GET" || request.method === "POST" || request.method === "DELETE")) {
      const token = tokenFrom(request);
      const { source, accountId } = viewerState(readSession(token));
      if (!accountId) {
        send(response, 401, { ok: false, message: "Sign in to continue." });
        return;
      }
      const signed = { ...source, currentUserId: accountId };
      const viewer = sessionEmployee(signed);
      const employee = signed.employees.find((item) => item.id === photoEmployeeId);
      if (!viewer || !employee || !canOpenProfile(signed, viewer, employee)) {
        send(response, 403, { ok: false, message: "You don't have access to this profile." });
        return;
      }
      if (request.method === "GET") {
        if (!employee.photoUpdatedAt) {
          send(response, 404, { ok: false, message: "This employee has no profile photo." });
          return;
        }
        const bytes = readPhoto(employee.id);
        if (!bytes) {
          send(response, 404, { ok: false, message: "This employee has no profile photo." });
          return;
        }
        response.writeHead(200, {
          "content-type": "image/jpeg",
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
          ...SECURITY_HEADERS,
        });
        response.end(bytes);
        return;
      }
      if (!canEditPhoto(signed, viewer, employee)) {
        send(response, 403, { ok: false, message: "You don't have permission to change this photo." });
        return;
      }
      if (request.method === "DELETE") {
        deletePhoto(employee.id);
        const outcome = setEmployeePhoto(signed, employee.id, null);
        if (!outcome.result.ok) {
          send(response, 400, { ok: false, message: outcome.result.message });
          return;
        }
        const saved = { ...outcome.state, currentUserId: null };
        writeWorkspace(saved);
        send(response, 200, { ok: true, state: presentWorkspace(saved, accountId), toast: outcome.toast });
        return;
      }
      const type = request.headers["content-type"] ?? "";
      if (!type.startsWith("image/jpeg")) {
        send(response, 400, { ok: false, message: "Use a JPEG, PNG, or WebP image. The preview is saved as a JPEG." });
        return;
      }
      let bytes: Buffer;
      try {
        bytes = await readBytes(request, 2 * 1024 * 1024);
      } catch (error) {
        send(response, 400, { ok: false, message: error instanceof Error ? error.message : "That image could not be read." });
        return;
      }
      const problem = writePhoto(employee.id, bytes);
      if (problem) {
        send(response, 400, { ok: false, message: problem });
        return;
      }
      const outcome = setEmployeePhoto(signed, employee.id, new Date().toISOString());
      if (!outcome.result.ok) {
        deletePhoto(employee.id);
        send(response, 400, { ok: false, message: outcome.result.message });
        return;
      }
      const saved = { ...outcome.state, currentUserId: null };
      writeWorkspace(saved);
      send(response, 200, { ok: true, state: presentWorkspace(saved, accountId), toast: outcome.toast });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/attendance/place") {
      const token = tokenFrom(request);
      const { source, accountId } = viewerState(readSession(token));
      if (!accountId) {
        send(response, 401, { ok: false, message: "Sign in to continue." });
        return;
      }
      const body = await readBody(request);
      const recordId = typeof body.recordId === "string" ? body.recordId : "";
      const which = body.which === "out" ? "out" : body.which === "in" ? "in" : "";
      if (!recordId || !which) {
        send(response, 400, { ok: false, message: "The attendance punch could not be found." });
        return;
      }
      const signed = { ...source, currentUserId: accountId };
      const record = signed.attendance.find((item) => item.id === recordId);
      const viewer = sessionEmployee(signed);
      const allowed = Boolean(record && viewer && (
        record.employeeId === viewer.id
        || hasPermission(signed, viewer, "attendance.company")
        || (hasPermission(signed, viewer, "attendance.team") && signed.employees.some((item) => item.id === record.employeeId && item.managerId === viewer.id))
      ));
      if (!record || !allowed) {
        send(response, 403, { ok: false, message: "You don't have access to this attendance location." });
        return;
      }
      const fix = which === "in" ? record.clockInLocation : record.clockOutLocation;
      if (fix?.placeLabel?.includes(" · ")) {
        send(response, 200, { ok: true, placeLabel: fix.placeLabel, state: presentWorkspace(source, accountId) });
        return;
      }
      if (!fix || fix.status !== "captured" || fix.latitude == null || fix.longitude == null) {
        send(response, 200, { ok: false, placeLabel: null, message: "This punch has no device position to describe." });
        return;
      }
      const placeLabel = await describePlace(fix.latitude, fix.longitude);
      if (!placeLabel) {
        send(response, 200, { ok: false, placeLabel: null, message: "The address could not be looked up." });
        return;
      }
      const outcome = rememberPlaceLabel(signed, recordId, which, placeLabel);
      if (!outcome.result.ok) {
        send(response, 200, { ok: false, placeLabel: null, message: outcome.result.message });
        return;
      }
      const saved = { ...outcome.state, currentUserId: null };
      writeWorkspace(saved);
      send(response, 200, { ok: true, placeLabel, state: presentWorkspace(saved, accountId) });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/payslips/preview") {
      const token = tokenFrom(request);
      const { source, accountId } = viewerState(readSession(token));
      if (!accountId) {
        send(response, 401, { ok: false, message: "Sign in to continue." });
        return;
      }
      const body = await readBody(request);
      const state = { ...source, currentUserId: accountId };
      const viewer = sessionEmployee(state);
      if (!viewer || !hasPermission(state, viewer, "payroll.manage")) {
        send(response, 403, { ok: false, message: "Payslip preview is limited to payroll administrators." });
        return;
      }
      const runId = typeof body.runId === "string" ? body.runId : "";
      const employeeId = typeof body.employeeId === "string" ? body.employeeId : "";
      const run = state.payrollRuns.find((item) => item.id === runId);
      if (!run) {
        send(response, 404, { ok: false, message: "That payroll run was not found." });
        return;
      }
      const built = buildPayslipDto(state, run, employeeId, { official: false, requireValid: false });
      if (!built.ok) {
        send(response, 400, { ok: false, message: built.message, missing: built.missing ?? [] });
        return;
      }
      const approved = run.status === "finalized" || run.status === "paid";
      const dto = {
        ...built.dto,
        official: approved && built.validation.ok,
        watermark: approved && built.validation.ok ? null : "INTERNAL PREVIEW — NOT AN OFFICIAL PAYSLIP",
      };
      const bytes = await renderPayslipPdf(dto);
      response.writeHead(200, {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${built.dto.filename}"`,
        "cache-control": "no-store",
        ...SECURITY_HEADERS,
      });
      response.end(bytes);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/payslips/generate") {
      const token = tokenFrom(request);
      const { source, accountId } = viewerState(readSession(token));
      if (!accountId) {
        send(response, 401, { ok: false, message: "Sign in to continue." });
        return;
      }
      const body = await readBody(request);
      const before = { ...source, currentUserId: accountId };
      const viewer = sessionEmployee(before);
      if (!viewer || !hasPermission(before, viewer, "payroll.manage")) {
        send(response, 403, { ok: false, message: "Payslip generation is limited to payroll administrators." });
        return;
      }
      const runId = typeof body.runId === "string" ? body.runId : "";
      const employeeId = typeof body.employeeId === "string" ? body.employeeId : "";
      const run = before.payrollRuns.find((item) => item.id === runId);
      if (!run) {
        send(response, 404, { ok: false, message: "That payroll run was not found." });
        return;
      }
      const built = buildPayslipDto(before, run, employeeId, { official: true });
      if (!built.ok) {
        send(response, 400, { ok: false, message: built.message, missing: built.missing ?? [] });
        return;
      }
      const existing = before.payslips.find((item) => item.runId === runId && item.employeeId === employeeId && item.status !== "superseded");
      const version = (existing?.version ?? 0) + 1;
      const slipId = existing?.id ?? `slip_${runId}_${employeeId}`;
      const documentKey = makeDocumentKey(slipId, version);
      const bytes = await renderPayslipPdf({ ...built.dto, slipId, version, official: true, watermark: null });
      const writeError = writePayslipPdf(documentKey, bytes);
      if (writeError) {
        send(response, 500, { ok: false, message: writeError });
        return;
      }
      const outcome = generatePayslipMutation(before, { runId, employeeId, documentKey, version });
      if (!outcome.result.ok) {
        send(response, 200, { ok: false, result: outcome.result, toast: outcome.toast, tone: "error" });
        return;
      }
      const saved = { ...outcome.state, currentUserId: null };
      writeWorkspace(saved);
      send(response, 200, {
        ok: true,
        result: outcome.result,
        toast: outcome.toast,
        tone: "success",
        slipId,
        version,
        filename: built.dto.filename,
        state: presentWorkspace(saved, accountId),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/payslips/generate-batch") {
      const token = tokenFrom(request);
      const { source, accountId } = viewerState(readSession(token));
      if (!accountId) {
        send(response, 401, { ok: false, message: "Sign in to continue." });
        return;
      }
      const body = await readBody(request);
      let working = { ...source, currentUserId: accountId };
      const viewer = sessionEmployee(working);
      if (!viewer || !hasPermission(working, viewer, "payroll.manage")) {
        send(response, 403, { ok: false, message: "Batch payslip generation is limited to payroll administrators." });
        return;
      }
      const runId = typeof body.runId === "string" ? body.runId : "";
      const run = working.payrollRuns.find((item) => item.id === runId);
      if (!run) {
        send(response, 404, { ok: false, message: "That payroll run was not found." });
        return;
      }
      const failures: Array<{ employeeId: string; message: string }> = [];
      let generated = 0;
      for (const line of run.lines) {
        const built = buildPayslipDto(working, run, line.employeeId, { official: true });
        if (!built.ok) {
          failures.push({ employeeId: line.employeeId, message: built.message });
          continue;
        }
        const existing = working.payslips.find((item) => item.runId === runId && item.employeeId === line.employeeId && item.status !== "superseded");
        const version = (existing?.version ?? 0) + 1;
        const slipId = existing?.id ?? `slip_${runId}_${line.employeeId}`;
        const documentKey = makeDocumentKey(slipId, version);
        const bytes = await renderPayslipPdf({ ...built.dto, slipId, version, official: true, watermark: null });
        const writeError = writePayslipPdf(documentKey, bytes);
        if (writeError) {
          failures.push({ employeeId: line.employeeId, message: writeError });
          continue;
        }
        const outcome = generatePayslipMutation(working, { runId, employeeId: line.employeeId, documentKey, version });
        if (!outcome.result.ok) {
          failures.push({ employeeId: line.employeeId, message: outcome.result.message });
          continue;
        }
        working = { ...outcome.state, currentUserId: accountId };
        generated += 1;
      }
      const saved = { ...working, currentUserId: null };
      writeWorkspace(saved);
      send(response, 200, {
        ok: failures.length === 0,
        generated,
        failed: failures.length,
        failures,
        toast: failures.length ? `Generated ${generated}; ${failures.length} need fixes.` : `Generated ${generated} payslip PDFs.`,
        tone: failures.length ? "error" : "success",
        state: presentWorkspace(saved, accountId),
      });
      return;
    }

    const payslipMatch = url.pathname.match(/^\/api\/payslips\/([^/]+)\/pdf$/i);
    if (request.method === "GET" && payslipMatch) {
      const token = tokenFrom(request);
      const { source, accountId } = viewerState(readSession(token));
      if (!accountId) {
        send(response, 401, { ok: false, message: "Sign in to continue." });
        return;
      }
      const slipId = decodeURIComponent(payslipMatch[1]);
      const state = { ...source, currentUserId: accountId };
      const viewer = sessionEmployee(state);
      const slip = state.payslips.find((item) => item.id === slipId);
      if (!viewer || !slip) {
        send(response, 404, { ok: false, message: "That payslip was not found." });
        return;
      }
      const manage = hasPermission(state, viewer, "payroll.manage");
      const selfOk = slip.employeeId === viewer.id && slip.published === true && hasPermission(state, viewer, "payroll.self");
      if (!manage && !selfOk) {
        send(response, 403, { ok: false, message: "You don't have access to that payslip." });
        return;
      }
      if (!slip.documentKey) {
        send(response, 404, { ok: false, message: "That payslip PDF has not been generated yet." });
        return;
      }
      const bytes = readPayslipPdf(slip.documentKey);
      if (!bytes) {
        send(response, 404, { ok: false, message: "That payslip file was not found." });
        return;
      }
      const audited = recordPayslipDownload(state, slipId);
      if (audited.result.ok) {
        writeWorkspace({ ...audited.state, currentUserId: null });
      }
      const code = state.employees.find((item) => item.id === slip.employeeId)?.employeeCode ?? "employee";
      const filename = `Payslip_${code}_${slip.periodStart.slice(0, 7)}.pdf`;
      response.writeHead(200, {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
        ...SECURITY_HEADERS,
      });
      response.end(bytes);
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
      const before = { ...source, currentUserId: accountId };
      const outcome = handler(before, input);
      if (!outcome.result.ok) {
        send(response, 200, { result: outcome.result, toast: outcome.toast, tone: outcome.tone ?? "error" });
        return;
      }
      let saved = { ...outcome.state, currentUserId: null };
      writeWorkspace(saved);
      afterActionAutomation(name, before, outcome.state, { ...input, resultId: outcome.result.id });
      const syncIds = ["approveHrMeeting", "rescheduleHrMeeting", "cancelHrMeeting", "retryHrMeetingSync"];
      if (syncIds.includes(name) && typeof input.id === "string") {
        const synced = await processHrMeetingSync(readWorkspace(), input.id);
        saved = { ...synced, currentUserId: null };
        writeWorkspace(saved);
      } else {
        afterActionHrMeetingSync(name, outcome.state, { ...input, resultId: outcome.result.id });
      }
      const still = sessionStillValid(saved, accountId);
      if (!still) deleteSession(token);
      send(
        response,
        200,
        { result: outcome.result, toast: outcome.toast, tone: outcome.tone ?? "success", state: still ? presentWorkspace(saved, accountId) : null },
        still ? {} : { "set-cookie": cookieHeader(null, request) },
      );
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/microsoft365/test") {
      const token = tokenFrom(request);
      const { source, accountId } = viewerState(readSession(token));
      if (!accountId) {
        send(response, 401, { ok: false, message: "Sign in to continue." });
        return;
      }
      const state = { ...source, currentUserId: accountId };
      const viewer = sessionEmployee(state);
      if (!viewer || !hasPermission(state, viewer, "settings.org")) {
        send(response, 403, { ok: false, message: "Microsoft 365 settings are limited to organization administrators." });
        return;
      }
      const config = normalizeMicrosoft365(state.microsoft365);
      const result = await testMicrosoftConnection(config);
      const outcome = recordMicrosoft365Health(state, { ok: result.ok, message: result.message });
      if (outcome.result.ok) writeWorkspace({ ...outcome.state, currentUserId: null });
      send(response, 200, {
        ok: result.ok,
        message: result.message,
        state: presentWorkspace(outcome.state, accountId),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/automation/health") {
      const token = tokenFrom(request);
      const { source, accountId } = viewerState(readSession(token));
      if (!accountId) {
        send(response, 401, { ok: false, message: "Sign in to continue." });
        return;
      }
      const state = { ...source, currentUserId: accountId };
      const viewer = sessionEmployee(state);
      if (!viewer || !hasPermission(state, viewer, "automation.manage")) {
        send(response, 403, { ok: false, message: "Automation is limited to authorized administrators." });
        return;
      }
      const body = await readBody(request);
      const channel = body.channel === "email" ? "email" : "whatsapp";
      const config = normalizeAutomationConfig(state.automation);
      if (channel === "whatsapp") {
        const result = await checkWahaSession(config.waha);
        const check = {
          status: result.ok ? "ok" as const : "error" as const,
          checkedAt: nowIso(),
          latencyMs: result.latencyMs,
          message: result.message,
        };
        const outcome = actions.recordAutomationHealth(state, { check });
        if (outcome.result.ok) writeWorkspace({ ...outcome.state, currentUserId: null });
        send(response, 200, {
          ok: result.ok,
          message: result.message,
          latencyMs: result.latencyMs,
          state: presentWorkspace(outcome.state, accountId),
        });
        return;
      }
      const result = await checkN8nHealth(config);
      send(response, 200, { ok: result.ok, message: result.message, state: presentWorkspace(state, accountId) });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/automation/attendance-reminder") {
      const token = tokenFrom(request);
      const { source, accountId } = viewerState(readSession(token));
      if (!accountId) {
        send(response, 401, { ok: false, message: "Sign in to continue." });
        return;
      }
      const state = { ...source, currentUserId: accountId };
      const viewer = sessionEmployee(state);
      if (!viewer || !hasPermission(state, viewer, "automation.manage")) {
        send(response, 403, { ok: false, message: "Automation is limited to authorized administrators." });
        return;
      }
      const body = await readBody(request);
      const kind = body.kind === "logout" ? "logout" : "login";
      const force = body.force !== false;
      const { runAttendanceReminder, reminderSchedulePreview } = await import("./attendance-reminders.ts");
      const outcome = await runAttendanceReminder(kind, { force });
      const latest = readWorkspace();
      send(response, 200, {
        ok: outcome.ok,
        message: outcome.message,
        toast: outcome.message,
        tone: outcome.ok ? "success" : "error",
        preview: reminderSchedulePreview(latest),
        state: presentWorkspace({ ...latest, currentUserId: null }, accountId),
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/automation/attendance-reminder/preview") {
      const token = tokenFrom(request);
      const { source, accountId } = viewerState(readSession(token));
      if (!accountId) {
        send(response, 401, { ok: false, message: "Sign in to continue." });
        return;
      }
      const state = { ...source, currentUserId: accountId };
      const viewer = sessionEmployee(state);
      if (!viewer || !hasPermission(state, viewer, "automation.manage")) {
        send(response, 403, { ok: false, message: "Automation is limited to authorized administrators." });
        return;
      }
      const { reminderSchedulePreview } = await import("./attendance-reminders.ts");
      send(response, 200, { ok: true, preview: reminderSchedulePreview(state) });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/automation/test") {
      const token = tokenFrom(request);
      const { source, accountId } = viewerState(readSession(token));
      if (!accountId) {
        send(response, 401, { ok: false, message: "Sign in to continue." });
        return;
      }
      const state = { ...source, currentUserId: accountId };
      const viewer = sessionEmployee(state);
      if (!viewer || !hasPermission(state, viewer, "automation.manage")) {
        send(response, 403, { ok: false, message: "Automation is limited to authorized administrators." });
        return;
      }
      const body = await readBody(request);
      let config = normalizeAutomationConfig(state.automation);
      const ruleId = typeof body.ruleId === "string" ? body.ruleId : "";
      const rule = ruleId ? config.rules.find((item) => item.id === ruleId) : undefined;
      if (ruleId && !rule) {
        send(response, 200, { ok: false, message: "That automation rule was not found.", state: presentWorkspace(state, accountId) });
        return;
      }
      const channel = rule ? rule.channel : body.channel === "email" ? "email" : "whatsapp";
      const phone = typeof body.phone === "string" && body.phone.trim() ? body.phone.trim() : viewer.phone;
      const email = typeof body.email === "string" && body.email.trim() ? body.email.trim() : viewer.email;
      const sampleVars = sampleAutomationVars({
        employeeName: fullName(viewer),
        companyName: state.settings.orgName,
        mobile: phone,
      });
      const message = rule
        ? renderAutomationTemplate(rule.templateBody, sampleVars)
        : typeof body.message === "string" && body.message.trim()
          ? body.message.trim()
          : "Buildesk People automation test message.";
      const subject = rule
        ? renderAutomationTemplate(rule.templateSubject || rule.name, sampleVars)
        : "Buildesk People automation test";
      const trigger = rule ? rule.trigger : "manual-test";

      if (channel === "whatsapp") {
        if (!wahaReady(config.waha)) {
          send(response, 200, { ok: false, message: "Enable WAHA and save settings before testing WhatsApp.", state: presentWorkspace(state, accountId) });
          return;
        }
        const chatId = phoneToWahaChatId(phone);
        if (!chatId) {
          send(response, 200, { ok: false, message: "Invalid mobile for WhatsApp.", state: presentWorkspace(state, accountId) });
          return;
        }
        const result = await sendWahaText(config.waha, chatId, message);
        config = appendAutomationLog(config, {
          id: uid("alog"),
          channel: "whatsapp",
          trigger,
          status: result.ok ? "success" : "failed",
          requestPayload: sanitizeLogPayload({ chatId, text: message, ruleId: rule?.id, test: true }),
          responseSummary: `HTTP ${result.status}`,
          errorMessage: result.ok ? undefined : result.text.slice(0, 280),
          attemptedAt: nowIso(),
          retryCount: 0,
          ruleId: rule?.id,
          employeeId: viewer.id,
        });
        writeWorkspace({ ...state, automation: config, currentUserId: null });
        send(response, 200, {
          ok: result.ok,
          message: result.ok
            ? rule
              ? `WhatsApp test for “${rule.name}” handed off to WAHA.`
              : "WhatsApp test handed off to WAHA."
            : result.text.slice(0, 180),
          state: presentWorkspace({ ...state, automation: config }, accountId),
        });
        return;
      }
      if (!emailEndpointReady(config)) {
        send(response, 200, { ok: false, message: "Enable n8n email endpoint and base URL before testing email.", state: presentWorkspace(state, accountId) });
        return;
      }
      const emailEp = config.endpoints.find((item) => item.channel === "email" && item.isEnabled && !item.webhookUrl.includes("health"));
      const url = buildN8nWebhookUrl(config.settings.n8nWebhookBase, emailEp?.webhookUrl ?? "buildesk-people");
      const result = await postN8nWebhook(url, {
        recipientEmail: email,
        emailSubject: subject,
        messageBody: message,
        emailCc: [config.settings.emailCc, rule?.emailCc].filter(Boolean).join(", "),
        emailFromAddress: config.settings.emailFromAddress,
        emailFromName: config.settings.emailFromName,
        trigger,
        ruleId: rule?.id,
        test: true,
        delayHours: 0,
        waitAmount: 0,
        ...sampleVars,
      });
      config = appendAutomationLog(config, {
        id: uid("alog"),
        channel: "email",
        trigger,
        status: result.ok ? "success" : "failed",
        requestPayload: sanitizeLogPayload({ recipientEmail: email, emailSubject: subject, messageBody: message, ruleId: rule?.id, test: true }),
        responseSummary: `HTTP ${result.status}`,
        errorMessage: result.ok ? undefined : result.text.slice(0, 280),
        attemptedAt: nowIso(),
        retryCount: 0,
        ruleId: rule?.id,
        employeeId: viewer.id,
      });
      writeWorkspace({ ...state, automation: config, currentUserId: null });
      send(response, 200, {
        ok: result.ok,
        message: result.ok
          ? rule
            ? `Email test for “${rule.name}” posted to n8n.`
            : "Email test posted to n8n."
          : result.text.slice(0, 180),
        state: presentWorkspace({ ...state, automation: config }, accountId),
      });
      return;
    }

    if (serveApp(request, response, url.pathname)) return;
    send(response, 404, { ok: false, message: "Not found." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The server could not complete that request.";
    send(response, 400, { ok: false, message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Buildesk People listening on http://${HOST}:${PORT}`);
  void import("./attendance-reminders.ts").then(({ startAttendanceReminderScheduler }) => {
    startAttendanceReminderScheduler();
    console.log("Attendance reminder scheduler started (login/logout −15 min, Asia/Kolkata).");
  }).catch(() => {
    // Scheduler is optional relative to serving the API.
  });
});

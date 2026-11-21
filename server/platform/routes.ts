import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { nowIso, uid } from "../../src/domain/dates.ts";
import { isValidEmail, normalizeEmail } from "../../src/lib/auth.ts";
import type { PlatformOperator, PlatformPlan, WorkspaceStatus } from "../../src/types/platform.ts";
import { HRMS_MODULES } from "../../src/types/platform.ts";
import { hashPassword, passwordProblem, verifyPassword } from "../password.ts";
import { closeTenantHandle, readTenantDocument, tenantDbPathFor } from "../tenant/store.ts";
import { adoptLegacyWorkspace, provisionWorkspace } from "./provision.ts";
import {
  bootstrapPlatformOwnerFromEnv,
  countActiveOwners,
  createPlatformSession,
  deleteClientSessionsForWorkspace,
  deletePlatformSession,
  deleteWorkspaceRecord,
  effectiveEmployeeLimit,
  effectiveModules,
  getOperator,
  getOperatorByEmail,
  getPlan,
  getWorkspace,
  isValidSlug,
  listOperators,
  listPlans,
  listPlatformAudits,
  listWorkspaces,
  lookupEmail,
  multiTenantEnabled,
  readPlatformSession,
  saveOperator,
  savePlan,
  saveWorkspace,
  slugifyCompany,
  writePlatformAudit,
} from "./db.ts";

type Send = (response: ServerResponse, status: number, payload: unknown, extraHeaders?: Record<string, string>) => void;

const PLATFORM_COOKIE = "buildesk_platform_session";

function platformTokenFrom(request: IncomingMessage): string | null {
  const header = request.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === PLATFORM_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function platformCookieHeader(token: string | null, request: IncomingMessage): string {
  const forwarded = request.headers["x-forwarded-proto"];
  const secure = forwarded === "https" || (Array.isArray(forwarded) && forwarded.includes("https"));
  // Path=/ so the cookie is sent for both /admin and /api/platform.
  const base = `HttpOnly; SameSite=Lax; Path=/${secure ? "; Secure" : ""}`;
  if (!token) return `${PLATFORM_COOKIE}=; ${base}; Max-Age=0`;
  return `${PLATFORM_COOKIE}=${token}; ${base}; Max-Age=${14 * 24 * 60 * 60}`;
}

function publicOperator(operator: PlatformOperator) {
  return {
    id: operator.id,
    email: operator.email,
    displayName: operator.displayName,
    role: operator.role,
    status: operator.status,
    createdAt: operator.createdAt,
    updatedAt: operator.updatedAt,
  };
}

function workspaceUsage(workspaceId: string): { ok: boolean; employees: number; accounts: number; storageBytes: number; message?: string } {
  try {
    const dbPath = tenantDbPathFor(workspaceId);
    if (!existsSync(dbPath)) return { ok: false, employees: 0, accounts: 0, storageBytes: 0, message: "Database unavailable" };
    const state = readTenantDocument(dbPath);
    let storageBytes = statSync(dbPath).size;
    const dataDir = join(process.cwd(), "data", "tenants", workspaceId.replace(/[^a-zA-Z0-9_-]/g, "_"));
    for (const folder of ["photos", "policies", "payslips"]) {
      // size omitted for simplicity — presence counted via db size primarily
      void folder;
      void dataDir;
    }
    return {
      ok: true,
      employees: state.employees.filter((item) => item.status !== "inactive").length,
      accounts: state.accounts.length,
      storageBytes,
    };
  } catch (error) {
    return { ok: false, employees: 0, accounts: 0, storageBytes: 0, message: error instanceof Error ? error.message : "Unavailable" };
  }
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
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

function requireOperator(request: IncomingMessage): { ok: true; operator: PlatformOperator } | { ok: false; status: number; message: string } {
  const token = platformTokenFrom(request);
  const operatorId = readPlatformSession(token);
  if (!operatorId) return { ok: false, status: 401, message: "Sign in to Platform Admin." };
  const operator = getOperator(operatorId);
  if (!operator || operator.status !== "active") return { ok: false, status: 401, message: "Sign in to Platform Admin." };
  return { ok: true, operator };
}

export function ensurePlatformBootstrap(): void {
  bootstrapPlatformOwnerFromEnv(hashPassword);
}

/** Returns true when the request was handled as a platform route. */
export async function handlePlatformRequest(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  send: Send,
): Promise<boolean> {
  if (!url.pathname.startsWith("/api/platform")) return false;

  // Reject client cookies being used as platform auth — platform uses its own cookie only.
  if (request.method === "POST" && url.pathname === "/api/platform/auth/signin") {
    const body = await readBody(request);
    const email = typeof body.email === "string" ? body.email : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!isValidEmail(email)) {
      send(response, 400, { ok: false, message: "Enter a valid email." });
      return true;
    }
    const operator = getOperatorByEmail(email);
    // Uniform failure message
    if (!operator || operator.status !== "active" || !operator.passwordHash || !verifyPassword(password, operator.passwordHash)) {
      send(response, 401, { ok: false, message: "The email or password is incorrect." });
      return true;
    }
    const token = createPlatformSession(operator.id);
    writePlatformAudit({
      actorId: operator.id,
      action: "platform.signin",
      targetType: "operator",
      targetId: operator.id,
      summary: "Platform operator signed in.",
    });
    send(response, 200, { ok: true, operator: publicOperator(operator), multiTenant: multiTenantEnabled() }, {
      "set-cookie": platformCookieHeader(token, request),
    });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/platform/auth/signout") {
    deletePlatformSession(platformTokenFrom(request));
    send(response, 200, { ok: true }, { "set-cookie": platformCookieHeader(null, request) });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/platform/bootstrap") {
    const auth = requireOperator(request);
    if (!auth.ok) {
      send(response, 200, { authenticated: false });
      return true;
    }
    send(response, 200, {
      authenticated: true,
      operator: publicOperator(auth.operator),
      multiTenant: multiTenantEnabled(),
    });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/platform/operators/setup") {
    const body = await readBody(request);
    const email = normalizeEmail(String(body.email || ""));
    const password = String(body.password || "");
    const confirm = String(body.confirm || "");
    const operator = getOperatorByEmail(email);
    if (!operator || operator.status === "disabled") {
      send(response, 400, { ok: false, message: "Invitation not found." });
      return true;
    }
    if (operator.passwordHash) {
      send(response, 400, { ok: false, message: "This operator already has a password." });
      return true;
    }
    if (password !== confirm) {
      send(response, 400, { ok: false, message: "Those passwords do not match." });
      return true;
    }
    const problem = passwordProblem(password, email);
    if (problem) {
      send(response, 400, { ok: false, message: problem });
      return true;
    }
    const next = {
      ...operator,
      passwordHash: hashPassword(password),
      status: "active" as const,
      activatedAt: nowIso(),
      updatedAt: nowIso(),
    };
    saveOperator(next);
    const token = createPlatformSession(next.id);
    send(response, 200, { ok: true, operator: publicOperator(next) }, { "set-cookie": platformCookieHeader(token, request) });
    return true;
  }

  const auth = requireOperator(request);
  if (!auth.ok) {
    send(response, auth.status, { ok: false, message: auth.message });
    return true;
  }
  const actor = auth.operator;

  if (request.method === "GET" && url.pathname === "/api/platform/overview") {
    const workspaces = listWorkspaces();
    const plans = listPlans();
    const byStatus: Record<string, number> = {};
    const byPlan: Record<string, number> = {};
    let approachingExpiry = 0;
    let dbUnavailable = 0;
    const soon = new Date();
    soon.setDate(soon.getDate() + 14);
    const soonIso = soon.toISOString().slice(0, 10);
    for (const ws of workspaces) {
      byStatus[ws.status] = (byStatus[ws.status] || 0) + 1;
      byPlan[ws.planId] = (byPlan[ws.planId] || 0) + 1;
      if (ws.expiresAt && ws.expiresAt <= soonIso && ws.status !== "archived") approachingExpiry += 1;
      const usage = workspaceUsage(ws.id);
      if (!usage.ok) dbUnavailable += 1;
    }
    send(response, 200, {
      ok: true,
      totals: {
        workspaces: workspaces.length,
        operators: listOperators().filter((item) => item.status === "active").length,
        plans: plans.filter((item) => item.status === "active").length,
        approachingExpiry,
        dbUnavailable,
        provisioningFailed: workspaces.filter((item) => item.provisioningStatus === "failed").length,
      },
      byStatus,
      byPlan,
      recentAudits: listPlatformAudits(12),
    });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/platform/workspaces") {
    const q = (url.searchParams.get("q") || "").trim().toLowerCase();
    const status = url.searchParams.get("status") || "all";
    const planId = url.searchParams.get("planId") || "all";
    const rows = listWorkspaces()
      .filter((item) => {
        if (status !== "all" && item.status !== status) return false;
        if (planId !== "all" && item.planId !== planId) return false;
        if (!q) return true;
        return `${item.companyName} ${item.slug} ${item.adminEmail}`.toLowerCase().includes(q);
      })
      .map((item) => {
        const plan = getPlan(item.planId);
        const usage = workspaceUsage(item.id);
        return {
          ...item,
          planName: plan?.name || item.planId,
          employeeLimit: effectiveEmployeeLimit(item, plan),
          modules: effectiveModules(item, plan),
          usage,
        };
      });
    send(response, 200, { ok: true, workspaces: rows });
    return true;
  }

  const workspaceMatch = url.pathname.match(/^\/api\/platform\/workspaces\/([^/]+)(?:\/(action))?$/);
  if (workspaceMatch && request.method === "GET" && !workspaceMatch[2]) {
    const workspace = getWorkspace(decodeURIComponent(workspaceMatch[1]));
    if (!workspace) {
      send(response, 404, { ok: false, message: "Workspace not found." });
      return true;
    }
    const plan = getPlan(workspace.planId);
    send(response, 200, {
      ok: true,
      workspace: {
        ...workspace,
        planName: plan?.name || workspace.planId,
        employeeLimit: effectiveEmployeeLimit(workspace, plan),
        modules: effectiveModules(workspace, plan),
        usage: workspaceUsage(workspace.id),
      },
    });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/platform/workspaces") {
    const body = await readBody(request);
    const result = provisionWorkspace({
      companyName: String(body.companyName || ""),
      slug: typeof body.slug === "string" ? body.slug : undefined,
      adminEmail: String(body.adminEmail || ""),
      adminDisplayName: String(body.adminDisplayName || ""),
      planId: String(body.planId || ""),
      expiresAt: typeof body.expiresAt === "string" && body.expiresAt ? body.expiresAt : null,
      trialDays: typeof body.trialDays === "number" ? body.trialDays : undefined,
      notes: typeof body.notes === "string" ? body.notes : "",
      actorId: actor.id,
      inviteOnly: body.inviteOnly !== false,
      temporaryPassword: typeof body.temporaryPassword === "string" ? body.temporaryPassword : undefined,
    });
    if (!result.ok) {
      send(response, 400, { ok: false, message: result.message, workspace: result.workspace });
      return true;
    }
    send(response, 200, { ok: true, workspace: result.workspace, message: result.setupMessage });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/platform/workspaces/adopt-legacy") {
    const body = await readBody(request);
    const result = adoptLegacyWorkspace({
      companyName: String(body.companyName || "Existing organization"),
      slug: typeof body.slug === "string" ? body.slug : undefined,
      planId: String(body.planId || listPlans()[0]?.id || ""),
      actorId: actor.id,
    });
    if (!result.ok) {
      send(response, 400, { ok: false, message: result.message });
      return true;
    }
    send(response, 200, { ok: true, workspace: result.workspace, message: result.setupMessage });
    return true;
  }

  if (workspaceMatch && request.method === "PATCH") {
    const workspace = getWorkspace(decodeURIComponent(workspaceMatch[1]));
    if (!workspace) {
      send(response, 404, { ok: false, message: "Workspace not found." });
      return true;
    }
    const body = await readBody(request);
    const next = { ...workspace, updatedAt: nowIso() };
    if (typeof body.companyName === "string" && body.companyName.trim()) next.companyName = body.companyName.trim();
    if (typeof body.planId === "string" && getPlan(body.planId)) next.planId = body.planId;
    if (typeof body.notes === "string") next.notes = body.notes;
    if (typeof body.expiresAt === "string") next.expiresAt = body.expiresAt || null;
    if (body.employeeLimitOverride === null) next.employeeLimitOverride = null;
    if (typeof body.employeeLimitOverride === "number") next.employeeLimitOverride = body.employeeLimitOverride;
    if (Array.isArray(body.modulesOverride)) next.modulesOverride = body.modulesOverride.map(String);
    if (body.modulesOverride === null) next.modulesOverride = null;
    if (typeof body.status === "string") {
      const status = body.status as WorkspaceStatus;
      if (["active", "trial", "suspended", "expired", "archived"].includes(status)) {
        next.status = status;
        next.suspendedAt = status === "suspended" ? nowIso() : status === "active" || status === "trial" ? null : next.suspendedAt;
        next.archivedAt = status === "archived" ? nowIso() : next.archivedAt;
        if (status === "suspended" || status === "archived" || status === "expired") {
          deleteClientSessionsForWorkspace(workspace.id);
        }
      }
    }
    saveWorkspace(next);
    writePlatformAudit({
      actorId: actor.id,
      action: "workspace.update",
      targetType: "workspace",
      targetId: workspace.id,
      summary: `Updated workspace ${next.companyName}.`,
    });
    send(response, 200, { ok: true, workspace: next });
    return true;
  }

  if (request.method === "POST" && workspaceMatch?.[2] === "action") {
    const workspace = getWorkspace(decodeURIComponent(workspaceMatch[1]));
    if (!workspace) {
      send(response, 404, { ok: false, message: "Workspace not found." });
      return true;
    }
    const body = await readBody(request);
    const action = String(body.action || "");
    if (action === "extend") {
      const days = Number(body.days) || 30;
      const base = workspace.expiresAt && workspace.expiresAt > nowIso().slice(0, 10)
        ? new Date(workspace.expiresAt)
        : new Date();
      base.setDate(base.getDate() + days);
      const next = { ...workspace, expiresAt: base.toISOString().slice(0, 10), status: workspace.status === "expired" ? "active" as const : workspace.status, updatedAt: nowIso() };
      saveWorkspace(next);
      writePlatformAudit({ actorId: actor.id, action: "workspace.extend", targetType: "workspace", targetId: workspace.id, summary: `Extended expiry by ${days} days.` });
      send(response, 200, { ok: true, workspace: next });
      return true;
    }
    if (action === "reset-admin-access") {
      // Clears password hash so admin must set a new password on next sign-in (invite-style).
      try {
        const dbPath = tenantDbPathFor(workspace.id);
        const state = readTenantDocument(dbPath);
        const admin = state.accounts.find((item) => item.email === workspace.adminEmail) || state.accounts.find((item) => item.role === "admin");
        if (!admin) {
          send(response, 400, { ok: false, message: "Admin account not found in tenant." });
          return true;
        }
        const accounts = state.accounts.map((item) =>
          item.id === admin.id
            ? { ...item, passwordHash: null, status: "invited" as const, updatedAt: nowIso(), invitedAt: nowIso(), activatedAt: null }
            : item,
        );
        const { writeTenantDocument } = await import("../tenant/store.ts");
        writeTenantDocument(dbPath, { ...state, accounts });
        deleteClientSessionsForWorkspace(workspace.id);
        writePlatformAudit({
          actorId: actor.id,
          action: "workspace.reset_admin",
          targetType: "workspace",
          targetId: workspace.id,
          summary: "Cleared client admin password for secure re-setup.",
        });
        send(response, 200, { ok: true, message: "Admin must sign in with email and create a new password." });
        return true;
      } catch (error) {
        send(response, 400, { ok: false, message: error instanceof Error ? error.message : "Reset failed." });
        return true;
      }
    }
    if (action === "delete") {
      if (actor.role !== "owner") {
        send(response, 403, { ok: false, message: "Only a platform owner can permanently delete a workspace." });
        return true;
      }
      const confirmSlug = String(body.confirmSlug || "");
      if (confirmSlug !== workspace.slug) {
        send(response, 400, { ok: false, message: "Type the exact workspace slug to confirm permanent deletion." });
        return true;
      }
      const dbPath = tenantDbPathFor(workspace.id);
      closeTenantHandle(dbPath);
      deleteClientSessionsForWorkspace(workspace.id);
      deleteWorkspaceRecord(workspace.id);
      const dataDir = join(process.cwd(), "data", "tenants", workspace.id.replace(/[^a-zA-Z0-9_-]/g, "_"));
      if (existsSync(dataDir)) {
        rmSync(dataDir, { recursive: true, force: true });
      }
      writePlatformAudit({
        actorId: actor.id,
        action: "workspace.delete",
        targetType: "workspace",
        targetId: workspace.id,
        summary: `Permanently deleted workspace ${workspace.slug}.`,
      });
      send(response, 200, { ok: true });
      return true;
    }
    send(response, 400, { ok: false, message: "Unknown workspace action." });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/platform/plans") {
    send(response, 200, { ok: true, plans: listPlans(), modules: HRMS_MODULES });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/platform/plans") {
    const body = await readBody(request);
    const code = String(body.code || "").trim().toLowerCase();
    if (!/^[a-z0-9_-]+$/.test(code)) {
      send(response, 400, { ok: false, message: "Plan code must be lowercase letters, numbers, _ or -." });
      return true;
    }
    const at = nowIso();
    const plan: PlatformPlan = {
      id: typeof body.id === "string" && body.id ? body.id : uid("plan"),
      code,
      name: String(body.name || code).trim(),
      status: body.status === "inactive" ? "inactive" : "active",
      employeeLimit: Math.max(1, Number(body.employeeLimit) || 25),
      storageMb: Math.max(100, Number(body.storageMb) || 1024),
      modules: Array.isArray(body.modules) ? body.modules.map(String) : [...HRMS_MODULES],
      sortOrder: Number(body.sortOrder) || 99,
      notes: String(body.notes || ""),
      createdAt: getPlan(String(body.id || ""))?.createdAt || at,
      updatedAt: at,
    };
    savePlan(plan);
    writePlatformAudit({ actorId: actor.id, action: "plan.save", targetType: "plan", targetId: plan.id, summary: `Saved plan ${plan.name}.` });
    send(response, 200, { ok: true, plan });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/platform/operators") {
    send(response, 200, { ok: true, operators: listOperators().map(publicOperator) });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/platform/operators") {
    if (actor.role !== "owner") {
      send(response, 403, { ok: false, message: "Only a platform owner can add operators." });
      return true;
    }
    const body = await readBody(request);
    const email = normalizeEmail(String(body.email || ""));
    if (!isValidEmail(email)) {
      send(response, 400, { ok: false, message: "Enter a valid email." });
      return true;
    }
    if (getOperatorByEmail(email)) {
      send(response, 400, { ok: false, message: "That operator already exists." });
      return true;
    }
    const at = nowIso();
    const operator: PlatformOperator = {
      id: uid("pop"),
      email,
      displayName: String(body.displayName || email).trim(),
      role: body.role === "owner" ? "owner" : "operator",
      status: "invited",
      passwordHash: null,
      createdAt: at,
      updatedAt: at,
      invitedAt: at,
      activatedAt: null,
      disabledAt: null,
    };
    saveOperator(operator);
    writePlatformAudit({ actorId: actor.id, action: "operator.invite", targetType: "operator", targetId: operator.id, summary: `Invited platform operator ${email}.` });
    send(response, 200, { ok: true, operator: publicOperator(operator), message: "Operator invited. They must complete password setup." });
    return true;
  }

  if (request.method === "PATCH" && url.pathname.startsWith("/api/platform/operators/")) {
    const id = decodeURIComponent(url.pathname.slice("/api/platform/operators/".length));
    const target = getOperator(id);
    if (!target) {
      send(response, 404, { ok: false, message: "Operator not found." });
      return true;
    }
    const body = await readBody(request);
    if (body.selfPassword === true) {
      const current = String(body.currentPassword || "");
      const password = String(body.password || "");
      const confirm = String(body.confirm || "");
      if (target.id !== actor.id) {
        send(response, 403, { ok: false, message: "You can only change your own password here." });
        return true;
      }
      if (!target.passwordHash || !verifyPassword(current, target.passwordHash)) {
        send(response, 400, { ok: false, message: "The current password is incorrect." });
        return true;
      }
      if (password !== confirm) {
        send(response, 400, { ok: false, message: "Those passwords do not match." });
        return true;
      }
      const problem = passwordProblem(password, target.email);
      if (problem) {
        send(response, 400, { ok: false, message: problem });
        return true;
      }
      saveOperator({ ...target, passwordHash: hashPassword(password), updatedAt: nowIso() });
      send(response, 200, { ok: true, message: "Password updated." });
      return true;
    }
    if (actor.role !== "owner") {
      send(response, 403, { ok: false, message: "Only a platform owner can change operator access." });
      return true;
    }
    const next = { ...target, updatedAt: nowIso() };
    if (typeof body.displayName === "string") next.displayName = body.displayName.trim();
    if (body.role === "owner" || body.role === "operator") {
      if (target.role === "owner" && body.role !== "owner" && countActiveOwners() <= 1 && target.status === "active") {
        send(response, 400, { ok: false, message: "Cannot demote the last active platform owner." });
        return true;
      }
      next.role = body.role;
    }
    if (body.status === "active" || body.status === "disabled" || body.status === "invited") {
      if (target.id === actor.id && body.status === "disabled") {
        send(response, 400, { ok: false, message: "You cannot disable your own operator account." });
        return true;
      }
      if (target.role === "owner" && body.status === "disabled" && countActiveOwners() <= 1) {
        send(response, 400, { ok: false, message: "Cannot disable the last active platform owner." });
        return true;
      }
      next.status = body.status;
      next.disabledAt = body.status === "disabled" ? nowIso() : null;
    }
    saveOperator(next);
    writePlatformAudit({ actorId: actor.id, action: "operator.update", targetType: "operator", targetId: next.id, summary: `Updated operator ${next.email}.` });
    send(response, 200, { ok: true, operator: publicOperator(next) });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/platform/audits") {
    send(response, 200, { ok: true, audits: listPlatformAudits(300) });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/platform/meta") {
    send(response, 200, {
      ok: true,
      multiTenant: multiTenantEnabled(),
      slugSuggest: slugifyCompany("Example Company"),
      slugValidExample: isValidSlug("example-company"),
      modules: HRMS_MODULES,
      emailTakenCheck: typeof url.searchParams.get("email") === "string" ? Boolean(lookupEmail(String(url.searchParams.get("email")))) : undefined,
    });
    return true;
  }

  send(response, 404, { ok: false, message: "Platform route not found." });
  return true;
}

export { PLATFORM_COOKIE, platformCookieHeader, platformTokenFrom };

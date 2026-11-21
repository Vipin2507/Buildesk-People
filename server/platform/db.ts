import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { nowIso, uid } from "../../src/domain/dates.ts";
import { normalizeEmail } from "../../src/lib/auth.ts";
import type {
  ClientWorkspace,
  EmailDirectoryEntry,
  PlatformAuditEvent,
  PlatformOperator,
  PlatformOperatorRole,
  PlatformPlan,
  ProvisioningStatus,
  WorkspaceStatus,
} from "../../src/types/platform.ts";
import { HRMS_MODULES } from "../../src/types/platform.ts";

const platformPath = join(process.cwd(), "data", "platform", "platform.sqlite");
mkdirSync(dirname(platformPath), { recursive: true });

const db = new DatabaseSync(platformPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS operators (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL,
    status TEXT NOT NULL,
    password_hash TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    invited_at TEXT,
    activated_at TEXT,
    disabled_at TEXT
  );
  CREATE TABLE IF NOT EXISTS plans (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    status TEXT NOT NULL,
    employee_limit INTEGER NOT NULL,
    storage_mb INTEGER NOT NULL,
    modules_json TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    notes TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    company_name TEXT NOT NULL,
    status TEXT NOT NULL,
    plan_id TEXT NOT NULL,
    admin_email TEXT NOT NULL,
    admin_display_name TEXT NOT NULL,
    expires_at TEXT,
    employee_limit_override INTEGER,
    modules_override_json TEXT,
    notes TEXT NOT NULL,
    db_relative_path TEXT NOT NULL,
    provisioning_status TEXT NOT NULL,
    provisioning_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    suspended_at TEXT,
    archived_at TEXT
  );
  CREATE TABLE IF NOT EXISTS email_directory (
    email TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS platform_sessions (
    token_hash TEXT PRIMARY KEY,
    operator_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS client_sessions (
    token_hash TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS platform_audits (
    id TEXT PRIMARY KEY,
    at TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    summary TEXT NOT NULL,
    meta_json TEXT
  );
`);

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function parseModules(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [...HRMS_MODULES];
  } catch {
    return [...HRMS_MODULES];
  }
}

function mapPlan(row: Record<string, unknown>): PlatformPlan {
  return {
    id: String(row.id),
    code: String(row.code),
    name: String(row.name),
    status: row.status === "inactive" ? "inactive" : "active",
    employeeLimit: Number(row.employee_limit) || 0,
    storageMb: Number(row.storage_mb) || 0,
    modules: parseModules(String(row.modules_json || "[]")),
    sortOrder: Number(row.sort_order) || 0,
    notes: String(row.notes || ""),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapOperator(row: Record<string, unknown>): PlatformOperator {
  return {
    id: String(row.id),
    email: String(row.email),
    displayName: String(row.display_name),
    role: row.role === "owner" ? "owner" : "operator",
    status: (row.status as PlatformOperator["status"]) || "active",
    passwordHash: row.password_hash ? String(row.password_hash) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    invitedAt: row.invited_at ? String(row.invited_at) : null,
    activatedAt: row.activated_at ? String(row.activated_at) : null,
    disabledAt: row.disabled_at ? String(row.disabled_at) : null,
  };
}

function mapWorkspace(row: Record<string, unknown>): ClientWorkspace {
  return {
    id: String(row.id),
    slug: String(row.slug),
    companyName: String(row.company_name),
    status: String(row.status) as WorkspaceStatus,
    planId: String(row.plan_id),
    adminEmail: String(row.admin_email),
    adminDisplayName: String(row.admin_display_name),
    expiresAt: row.expires_at ? String(row.expires_at) : null,
    employeeLimitOverride: row.employee_limit_override == null ? null : Number(row.employee_limit_override),
    modulesOverride: row.modules_override_json ? parseModules(String(row.modules_override_json)) : null,
    notes: String(row.notes || ""),
    dbRelativePath: String(row.db_relative_path),
    provisioningStatus: String(row.provisioning_status) as ProvisioningStatus,
    provisioningError: row.provisioning_error ? String(row.provisioning_error) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    suspendedAt: row.suspended_at ? String(row.suspended_at) : null,
    archivedAt: row.archived_at ? String(row.archived_at) : null,
  };
}

export function ensureDefaultPlans(): void {
  const count = db.prepare("SELECT COUNT(*) AS c FROM plans").get() as { c: number };
  if (count.c > 0) return;
  const at = nowIso();
  const plans: Array<Omit<PlatformPlan, "createdAt" | "updatedAt"> & { createdAt: string; updatedAt: string }> = [
    {
      id: "plan_starter",
      code: "starter",
      name: "Starter",
      status: "active",
      employeeLimit: 25,
      storageMb: 1024,
      modules: ["people", "attendance", "leave", "tickets", "policies"],
      sortOrder: 1,
      notes: "Small teams",
      createdAt: at,
      updatedAt: at,
    },
    {
      id: "plan_growth",
      code: "growth",
      name: "Growth",
      status: "active",
      employeeLimit: 150,
      storageMb: 10240,
      modules: [...HRMS_MODULES],
      sortOrder: 2,
      notes: "Full HRMS modules",
      createdAt: at,
      updatedAt: at,
    },
    {
      id: "plan_enterprise",
      code: "enterprise",
      name: "Enterprise",
      status: "active",
      employeeLimit: 5000,
      storageMb: 102400,
      modules: [...HRMS_MODULES],
      sortOrder: 3,
      notes: "Large organizations",
      createdAt: at,
      updatedAt: at,
    },
  ];
  for (const plan of plans) {
    db.prepare(`
      INSERT INTO plans (id, code, name, status, employee_limit, storage_mb, modules_json, sort_order, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(plan.id, plan.code, plan.name, plan.status, plan.employeeLimit, plan.storageMb, JSON.stringify(plan.modules), plan.sortOrder, plan.notes, plan.createdAt, plan.updatedAt);
  }
}

ensureDefaultPlans();

export function listPlans(): PlatformPlan[] {
  const rows = db.prepare("SELECT * FROM plans ORDER BY sort_order ASC, name ASC").all() as Record<string, unknown>[];
  return rows.map(mapPlan);
}

export function getPlan(id: string): PlatformPlan | null {
  const row = db.prepare("SELECT * FROM plans WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? mapPlan(row) : null;
}

export function savePlan(plan: PlatformPlan): void {
  db.prepare(`
    INSERT INTO plans (id, code, name, status, employee_limit, storage_mb, modules_json, sort_order, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      code = excluded.code,
      name = excluded.name,
      status = excluded.status,
      employee_limit = excluded.employee_limit,
      storage_mb = excluded.storage_mb,
      modules_json = excluded.modules_json,
      sort_order = excluded.sort_order,
      notes = excluded.notes,
      updated_at = excluded.updated_at
  `).run(plan.id, plan.code, plan.name, plan.status, plan.employeeLimit, plan.storageMb, JSON.stringify(plan.modules), plan.sortOrder, plan.notes, plan.createdAt, plan.updatedAt);
}

export function listOperators(): PlatformOperator[] {
  return (db.prepare("SELECT * FROM operators ORDER BY created_at ASC").all() as Record<string, unknown>[]).map(mapOperator);
}

export function getOperatorByEmail(email: string): PlatformOperator | null {
  const row = db.prepare("SELECT * FROM operators WHERE email = ?").get(normalizeEmail(email)) as Record<string, unknown> | undefined;
  return row ? mapOperator(row) : null;
}

export function getOperator(id: string): PlatformOperator | null {
  const row = db.prepare("SELECT * FROM operators WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? mapOperator(row) : null;
}

export function saveOperator(operator: PlatformOperator): void {
  db.prepare(`
    INSERT INTO operators (id, email, display_name, role, status, password_hash, created_at, updated_at, invited_at, activated_at, disabled_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      email = excluded.email,
      display_name = excluded.display_name,
      role = excluded.role,
      status = excluded.status,
      password_hash = excluded.password_hash,
      updated_at = excluded.updated_at,
      invited_at = excluded.invited_at,
      activated_at = excluded.activated_at,
      disabled_at = excluded.disabled_at
  `).run(
    operator.id,
    normalizeEmail(operator.email),
    operator.displayName,
    operator.role,
    operator.status,
    operator.passwordHash,
    operator.createdAt,
    operator.updatedAt,
    operator.invitedAt,
    operator.activatedAt,
    operator.disabledAt,
  );
}

export function countActiveOwners(): number {
  const row = db.prepare("SELECT COUNT(*) AS c FROM operators WHERE role = 'owner' AND status = 'active'").get() as { c: number };
  return row.c;
}

export function listWorkspaces(): ClientWorkspace[] {
  return (db.prepare("SELECT * FROM workspaces ORDER BY company_name ASC").all() as Record<string, unknown>[]).map(mapWorkspace);
}

export function getWorkspace(id: string): ClientWorkspace | null {
  const row = db.prepare("SELECT * FROM workspaces WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? mapWorkspace(row) : null;
}

export function getWorkspaceBySlug(slug: string): ClientWorkspace | null {
  const row = db.prepare("SELECT * FROM workspaces WHERE slug = ?").get(slug.trim().toLowerCase()) as Record<string, unknown> | undefined;
  return row ? mapWorkspace(row) : null;
}

export function saveWorkspace(workspace: ClientWorkspace): void {
  db.prepare(`
    INSERT INTO workspaces (
      id, slug, company_name, status, plan_id, admin_email, admin_display_name, expires_at,
      employee_limit_override, modules_override_json, notes, db_relative_path, provisioning_status,
      provisioning_error, created_at, updated_at, suspended_at, archived_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      slug = excluded.slug,
      company_name = excluded.company_name,
      status = excluded.status,
      plan_id = excluded.plan_id,
      admin_email = excluded.admin_email,
      admin_display_name = excluded.admin_display_name,
      expires_at = excluded.expires_at,
      employee_limit_override = excluded.employee_limit_override,
      modules_override_json = excluded.modules_override_json,
      notes = excluded.notes,
      db_relative_path = excluded.db_relative_path,
      provisioning_status = excluded.provisioning_status,
      provisioning_error = excluded.provisioning_error,
      updated_at = excluded.updated_at,
      suspended_at = excluded.suspended_at,
      archived_at = excluded.archived_at
  `).run(
    workspace.id,
    workspace.slug,
    workspace.companyName,
    workspace.status,
    workspace.planId,
    normalizeEmail(workspace.adminEmail),
    workspace.adminDisplayName,
    workspace.expiresAt,
    workspace.employeeLimitOverride,
    workspace.modulesOverride ? JSON.stringify(workspace.modulesOverride) : null,
    workspace.notes,
    workspace.dbRelativePath,
    workspace.provisioningStatus,
    workspace.provisioningError,
    workspace.createdAt,
    workspace.updatedAt,
    workspace.suspendedAt,
    workspace.archivedAt,
  );
}

export function deleteWorkspaceRecord(id: string): void {
  db.prepare("DELETE FROM email_directory WHERE workspace_id = ?").run(id);
  db.prepare("DELETE FROM client_sessions WHERE workspace_id = ?").run(id);
  db.prepare("DELETE FROM workspaces WHERE id = ?").run(id);
}

export function lookupEmail(email: string): EmailDirectoryEntry | null {
  const row = db.prepare("SELECT * FROM email_directory WHERE email = ?").get(normalizeEmail(email)) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    email: String(row.email),
    workspaceId: String(row.workspace_id),
    accountId: String(row.account_id),
    updatedAt: String(row.updated_at),
  };
}

export function registerEmail(email: string, workspaceId: string, accountId: string): { ok: true } | { ok: false; message: string } {
  const key = normalizeEmail(email);
  const existing = lookupEmail(key);
  if (existing && existing.workspaceId !== workspaceId) {
    return { ok: false, message: "That email is already registered to another workspace." };
  }
  db.prepare(`
    INSERT INTO email_directory (email, workspace_id, account_id, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET workspace_id = excluded.workspace_id, account_id = excluded.account_id, updated_at = excluded.updated_at
  `).run(key, workspaceId, accountId, nowIso());
  return { ok: true };
}

export function unregisterEmail(email: string): void {
  db.prepare("DELETE FROM email_directory WHERE email = ?").run(normalizeEmail(email));
}

export function unregisterWorkspaceEmails(workspaceId: string): void {
  db.prepare("DELETE FROM email_directory WHERE workspace_id = ?").run(workspaceId);
}

export function listEmailsForWorkspace(workspaceId: string): EmailDirectoryEntry[] {
  return (db.prepare("SELECT * FROM email_directory WHERE workspace_id = ?").all(workspaceId) as Record<string, unknown>[]).map((row) => ({
    email: String(row.email),
    workspaceId: String(row.workspace_id),
    accountId: String(row.account_id),
    updatedAt: String(row.updated_at),
  }));
}

export function createPlatformSession(operatorId: string): string {
  const token = randomBytes(32).toString("hex");
  const now = new Date();
  const expires = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  db.prepare("INSERT INTO platform_sessions (token_hash, operator_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(
    hashToken(token),
    operatorId,
    now.toISOString(),
    expires.toISOString(),
  );
  return token;
}

export function readPlatformSession(token: string | null): string | null {
  if (!token) return null;
  const row = db.prepare("SELECT operator_id, expires_at FROM platform_sessions WHERE token_hash = ?").get(hashToken(token)) as { operator_id: string; expires_at: string } | undefined;
  if (!row) return null;
  if (row.expires_at < new Date().toISOString()) {
    db.prepare("DELETE FROM platform_sessions WHERE token_hash = ?").run(hashToken(token));
    return null;
  }
  return row.operator_id;
}

export function deletePlatformSession(token: string | null): void {
  if (!token) return;
  db.prepare("DELETE FROM platform_sessions WHERE token_hash = ?").run(hashToken(token));
}

export function createClientSession(workspaceId: string, accountId: string): string {
  const token = randomBytes(32).toString("hex");
  const now = new Date();
  const expires = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  db.prepare("INSERT INTO client_sessions (token_hash, workspace_id, account_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)").run(
    hashToken(token),
    workspaceId,
    accountId,
    now.toISOString(),
    expires.toISOString(),
  );
  return token;
}

export function readClientSession(token: string | null): { workspaceId: string; accountId: string } | null {
  if (!token) return null;
  const row = db.prepare("SELECT workspace_id, account_id, expires_at FROM client_sessions WHERE token_hash = ?").get(hashToken(token)) as {
    workspace_id: string;
    account_id: string;
    expires_at: string;
  } | undefined;
  if (!row) return null;
  if (row.expires_at < new Date().toISOString()) {
    db.prepare("DELETE FROM client_sessions WHERE token_hash = ?").run(hashToken(token));
    return null;
  }
  return { workspaceId: row.workspace_id, accountId: row.account_id };
}

export function deleteClientSession(token: string | null): void {
  if (!token) return;
  db.prepare("DELETE FROM client_sessions WHERE token_hash = ?").run(hashToken(token));
}

export function deleteClientSessionsForWorkspace(workspaceId: string): void {
  db.prepare("DELETE FROM client_sessions WHERE workspace_id = ?").run(workspaceId);
}

export function writePlatformAudit(input: Omit<PlatformAuditEvent, "id" | "at"> & { id?: string; at?: string }): void {
  const event: PlatformAuditEvent = {
    id: input.id || uid("paud"),
    at: input.at || nowIso(),
    actorId: input.actorId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    summary: input.summary,
    meta: input.meta,
  };
  db.prepare(`
    INSERT INTO platform_audits (id, at, actor_id, action, target_type, target_id, summary, meta_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(event.id, event.at, event.actorId, event.action, event.targetType, event.targetId, event.summary, event.meta ? JSON.stringify(event.meta) : null);
}

export function listPlatformAudits(limit = 200): PlatformAuditEvent[] {
  const rows = db.prepare("SELECT * FROM platform_audits ORDER BY at DESC LIMIT ?").all(limit) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: String(row.id),
    at: String(row.at),
    actorId: String(row.actor_id),
    action: String(row.action),
    targetType: String(row.target_type),
    targetId: String(row.target_id),
    summary: String(row.summary),
    meta: row.meta_json ? JSON.parse(String(row.meta_json)) as PlatformAuditEvent["meta"] : undefined,
  }));
}

export function slugifyCompany(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "workspace";
}

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length >= 2 && slug.length <= 48;
}

export function effectiveEmployeeLimit(workspace: ClientWorkspace, plan: PlatformPlan | null): number {
  if (workspace.employeeLimitOverride != null && workspace.employeeLimitOverride > 0) return workspace.employeeLimitOverride;
  return plan?.employeeLimit ?? 0;
}

export function effectiveModules(workspace: ClientWorkspace, plan: PlatformPlan | null): string[] {
  if (workspace.modulesOverride?.length) return workspace.modulesOverride;
  return plan?.modules ?? [...HRMS_MODULES];
}

export function workspaceAccessBlocked(workspace: ClientWorkspace): string | null {
  if (workspace.provisioningStatus !== "ready") return "This workspace is still provisioning or failed to provision.";
  if (workspace.status === "suspended") return "This workspace is suspended.";
  if (workspace.status === "archived") return "This workspace is archived.";
  if (workspace.status === "expired") return "This workspace subscription has expired.";
  if (workspace.expiresAt && workspace.expiresAt < nowIso().slice(0, 10)) return "This workspace subscription has expired.";
  if (workspace.status === "provisioning") return "This workspace is still provisioning.";
  return null;
}

export function bootstrapPlatformOwnerFromEnv(hashPassword: (password: string) => string): { created: boolean; email: string | null } {
  const email = (process.env.BUILDESK_PLATFORM_OWNER_EMAIL || "").trim().toLowerCase();
  const password = process.env.BUILDESK_PLATFORM_OWNER_PASSWORD || "";
  if (!email || !password) return { created: false, email: null };
  const existing = getOperatorByEmail(email);
  if (existing) return { created: false, email };
  if (listOperators().length > 0) return { created: false, email };
  const at = nowIso();
  saveOperator({
    id: uid("pop"),
    email,
    displayName: process.env.BUILDESK_PLATFORM_OWNER_NAME?.trim() || "Platform Owner",
    role: "owner" as PlatformOperatorRole,
    status: "active",
    passwordHash: hashPassword(password),
    createdAt: at,
    updatedAt: at,
    invitedAt: at,
    activatedAt: at,
    disabledAt: null,
  });
  writePlatformAudit({
    actorId: "system",
    action: "operator.bootstrap",
    targetType: "operator",
    targetId: email,
    summary: "Bootstrapped platform owner from environment configuration.",
  });
  return { created: true, email };
}

export function multiTenantEnabled(): boolean {
  const flag = (process.env.BUILDESK_MULTI_TENANT || "").trim().toLowerCase();
  if (flag === "1" || flag === "true" || flag === "yes") return true;
  if (flag === "0" || flag === "false" || flag === "no") return false;
  // Auto-enable when at least one provisioned workspace exists.
  const row = db.prepare("SELECT COUNT(*) AS c FROM workspaces WHERE provisioning_status = 'ready'").get() as { c: number };
  return row.c > 0;
}

export function legacySingleTenantAllowed(): boolean {
  const flag = (process.env.BUILDESK_LEGACY_SINGLE_TENANT || "true").trim().toLowerCase();
  return flag !== "0" && flag !== "false" && flag !== "no";
}

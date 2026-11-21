import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { grantHrAdminAccess } from "../../src/lib/access.ts";
import { removeDemoContent } from "../../src/data/cleanup.ts";
import { createSeed } from "../../src/data/seed.ts";
import { normalizeAttendance } from "../../src/domain/attendance.ts";
import { ensureAutomation } from "../../src/domain/automation.ts";
import { ensureMicrosoft365 } from "../../src/domain/hr-meeting.ts";
import { applyLocationRetention, withAttendancePolicy } from "../../src/domain/location.ts";
import { ensureCompanyHolidays } from "../../src/domain/holidays.ts";
import { ensureMasters } from "../../src/domain/masters.ts";
import { DATA_VERSION, type AppState } from "../../src/types.ts";
import { syncWorkspaceEmailDirectory } from "../platform/email-sync.ts";
import { getTenantContext, requireTenantContext } from "./context.ts";

type TenantHandle = {
  db: DatabaseSync;
  dbPath: string;
};

const handles = new Map<string, TenantHandle>();

function ensureSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL,
      document TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
  `);
}

function openHandle(dbPath: string): TenantHandle {
  const existing = handles.get(dbPath);
  if (existing) return existing;
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  ensureSchema(db);
  const handle = { db, dbPath };
  handles.set(dbPath, handle);
  return handle;
}

export function closeTenantHandle(dbPath: string): void {
  const handle = handles.get(dbPath);
  if (!handle) return;
  try {
    handle.db.close();
  } catch {
    // ignore
  }
  handles.delete(dbPath);
}

export function closeAllTenantHandles(): void {
  for (const path of [...handles.keys()]) closeTenantHandle(path);
}

function freshState(): AppState {
  const state = normalizeAttendance(createSeed());
  state.currentUserId = null;
  return state;
}

function normalizeLoaded(parsed: AppState): { state: AppState; changed: boolean } {
  const base = ensureMasters(ensureAutomation(withAttendancePolicy(normalizeAttendance(parsed))));
  base.state.currentUserId = null;
  const cleaned = removeDemoContent(base.state);
  const granted = grantHrAdminAccess(cleaned.state);
  const mastered = ensureMasters(ensureAutomation(granted.state));
  const withMs = ensureMicrosoft365(mastered.state);
  const withHolidays = ensureCompanyHolidays(withMs);
  const retained = applyLocationRetention(withHolidays.state);
  const changed = cleaned.changed || granted.changed || mastered.changed || withHolidays.changed || retained.changed || base.changed || !parsed.automation || !parsed.microsoft365;
  return { state: retained.state, changed };
}

export function readTenantDocument(dbPath: string): AppState {
  const { db } = openHandle(dbPath);
  const row = db.prepare("SELECT version, document FROM workspace WHERE id = 1").get() as { version: number; document: string } | undefined;
  if (!row || row.version !== DATA_VERSION) {
    const state = freshState();
    writeTenantDocument(dbPath, state);
    db.exec("DELETE FROM sessions");
    return state;
  }
  const loaded = normalizeLoaded(JSON.parse(row.document) as AppState);
  if (loaded.changed) writeTenantDocument(dbPath, loaded.state);
  return loaded.state;
}

export function writeTenantDocument(dbPath: string, state: AppState): void {
  const { db } = openHandle(dbPath);
  const stored = { ...state, currentUserId: null };
  db.prepare(`
    INSERT INTO workspace (id, version, document) VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET version = excluded.version, document = excluded.document
  `).run(DATA_VERSION, JSON.stringify(stored));
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Local tenant-session helpers kept for compatibility; primary client sessions live in the control plane. */
export function createTenantLocalSession(dbPath: string, accountId: string): string {
  const { db } = openHandle(dbPath);
  const token = randomBytes(32).toString("hex");
  const now = new Date();
  const expires = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  db.prepare("INSERT INTO sessions (token_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(
    hashToken(token),
    accountId,
    now.toISOString(),
    expires.toISOString(),
  );
  return token;
}

export function readWorkspace(): AppState {
  const ctx = getTenantContext();
  if (!ctx) {
    // Legacy callers during boot — only allowed when explicitly opening legacy path via resolve.
    throw new Error("readWorkspace() called without tenant context.");
  }
  return readTenantDocument(ctx.dbPath);
}

export function writeWorkspace(state: AppState): void {
  const ctx = requireTenantContext();
  writeTenantDocument(ctx.dbPath, state);
  if (!ctx.legacy) syncWorkspaceEmailDirectory(ctx.workspaceId, state);
}

export function tenantDataDir(): string {
  return requireTenantContext().dataDir;
}

export function legacyDbPath(): string {
  return join(process.cwd(), "data", "buildesk.sqlite");
}

export function legacyDataDir(): string {
  return join(process.cwd(), "data");
}

export function tenantDbPathFor(workspaceId: string): string {
  const safe = workspaceId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(process.cwd(), "data", "tenants", safe, "buildesk.sqlite");
}

export function tenantDataDirFor(workspaceId: string): string {
  const safe = workspaceId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(process.cwd(), "data", "tenants", safe);
}

export function ensureTenantDatabase(dbPath: string, seed?: AppState): AppState {
  if (existsSync(dbPath)) {
    return readTenantDocument(dbPath);
  }
  const state = seed ?? freshState();
  writeTenantDocument(dbPath, state);
  return state;
}

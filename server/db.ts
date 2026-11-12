import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { grantHrAdminAccess } from "../src/lib/access.ts";
import { removeDemoContent } from "../src/data/cleanup.ts";
import { createSeed } from "../src/data/seed.ts";
import { normalizeAttendance } from "../src/domain/attendance.ts";
import { ensureAutomation } from "../src/domain/automation.ts";
import { applyLocationRetention, withAttendancePolicy } from "../src/domain/location.ts";
import { ensureMasters } from "../src/domain/masters.ts";
import { DATA_VERSION, type AppState } from "../src/types.ts";

const file = join(process.cwd(), "data", "buildesk.sqlite");
mkdirSync(dirname(file), { recursive: true });

const db = new DatabaseSync(file);
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

function freshState(): AppState {
  const state = normalizeAttendance(createSeed());
  state.currentUserId = null;
  return state;
}

export function readWorkspace(): AppState {
  const row = db.prepare("SELECT version, document FROM workspace WHERE id = 1").get() as { version: number; document: string } | undefined;
  if (!row || row.version !== DATA_VERSION) {
    const state = freshState();
    writeWorkspace(state);
    db.exec("DELETE FROM sessions");
    return state;
  }
  const parsed = ensureMasters(ensureAutomation(withAttendancePolicy(normalizeAttendance(JSON.parse(row.document) as AppState))));
  parsed.state.currentUserId = null;
  const cleaned = removeDemoContent(parsed.state);
  const granted = grantHrAdminAccess(cleaned.state);
  const mastered = ensureMasters(ensureAutomation(granted.state));
  const retained = applyLocationRetention(mastered.state);
  if (cleaned.changed || granted.changed || mastered.changed || retained.changed || parsed.changed || !parsed.state.automation) {
    writeWorkspace(retained.state);
  }
  return retained.state;
}

export function writeWorkspace(state: AppState): void {
  const stored = { ...state, currentUserId: null };
  db.prepare(`
    INSERT INTO workspace (id, version, document) VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET version = excluded.version, document = excluded.document
  `).run(DATA_VERSION, JSON.stringify(stored));
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createSession(accountId: string): string {
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

export function readSession(token: string | null): string | null {
  if (!token) return null;
  const row = db.prepare("SELECT account_id, expires_at FROM sessions WHERE token_hash = ?").get(hashToken(token)) as { account_id: string; expires_at: string } | undefined;
  if (!row) return null;
  if (row.expires_at < new Date().toISOString()) {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
    return null;
  }
  return row.account_id;
}

export function deleteSession(token: string | null): void {
  if (!token) return;
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
}

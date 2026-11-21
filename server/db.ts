/**
 * Compatibility facade for tenant-aware workspace storage.
 * Prefer importing from ./tenant/store.ts and ./platform/db.ts for new code.
 */
export {
  readWorkspace,
  writeWorkspace,
  readTenantDocument,
  writeTenantDocument,
  ensureTenantDatabase,
  closeTenantHandle,
  closeAllTenantHandles,
  legacyDbPath,
  legacyDataDir,
  tenantDbPathFor,
  tenantDataDirFor,
  tenantDataDir,
} from "./tenant/store.ts";

import { createClientSession, deleteClientSession, readClientSession } from "./platform/db.ts";

/** Create a control-plane client session bound to a workspace. */
export function createSession(accountId: string, workspaceId = "legacy"): string {
  return createClientSession(workspaceId, accountId);
}

export function readSession(token: string | null): string | null {
  const session = readClientSession(token);
  return session?.accountId ?? null;
}

export function readSessionFull(token: string | null): { workspaceId: string; accountId: string } | null {
  return readClientSession(token);
}

export function deleteSession(token: string | null): void {
  deleteClientSession(token);
}

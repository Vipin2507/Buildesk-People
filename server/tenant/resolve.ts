import { join } from "node:path";
import { getWorkspace, workspaceAccessBlocked } from "../platform/db.ts";
import type { TenantContext } from "./context.ts";
import { legacyDataDir, legacyDbPath, tenantDataDirFor, tenantDbPathFor } from "./store.ts";

export function contextForWorkspaceId(workspaceId: string, legacy = false): TenantContext | null {
  if (legacy || workspaceId === "legacy") {
    return {
      workspaceId: "legacy",
      slug: "legacy",
      dataDir: legacyDataDir(),
      dbPath: legacyDbPath(),
      legacy: true,
    };
  }
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return null;
  return {
    workspaceId: workspace.id,
    slug: workspace.slug,
    dataDir: tenantDataDirFor(workspace.id),
    dbPath: join(process.cwd(), "data", workspace.dbRelativePath),
    legacy: false,
  };
}

export function assertWorkspaceApiAccess(workspaceId: string): { ok: true } | { ok: false; status: number; message: string } {
  if (workspaceId === "legacy") return { ok: true };
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return { ok: false, status: 404, message: "Workspace not found." };
  const blocked = workspaceAccessBlocked(workspace);
  if (blocked) return { ok: false, status: 403, message: blocked };
  return { ok: true };
}

export { tenantDbPathFor, tenantDataDirFor };

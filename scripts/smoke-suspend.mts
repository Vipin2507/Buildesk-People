import { writeFileSync } from "node:fs";
import { getWorkspace, lookupEmail, saveWorkspace, workspaceAccessBlocked } from "../server/platform/db.ts";
import { nowIso } from "../src/domain/dates.ts";

const entry = lookupEmail("admin@smoke-acme.test");
if (!entry) {
  writeFileSync("data/smoke-suspend-result.txt", "missing email entry");
  process.exit(1);
}
const ws = getWorkspace(entry.workspaceId)!;
saveWorkspace({ ...ws, status: "suspended", suspendedAt: nowIso(), updatedAt: nowIso() });
const blocked = workspaceAccessBlocked(getWorkspace(ws.id)!);
saveWorkspace({ ...ws, status: "active", suspendedAt: null, updatedAt: nowIso() });
const unblocked = workspaceAccessBlocked(getWorkspace(ws.id)!);
writeFileSync("data/smoke-suspend-result.txt", `blocked=${blocked}\nunblocked=${unblocked}`);

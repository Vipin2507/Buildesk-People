import { ensurePlatformBootstrap } from "../server/platform/routes.ts";
import { getOperatorByEmail, listPlans, lookupEmail, createClientSession, createPlatformSession } from "../server/platform/db.ts";
import { provisionWorkspace } from "../server/platform/provision.ts";
import { findAccountByEmail } from "../src/lib/auth.ts";
import { readTenantDocument, tenantDbPathFor } from "../server/tenant/store.ts";
import { writeFileSync } from "node:fs";

ensurePlatformBootstrap();
const lines: string[] = [];
const owner = getOperatorByEmail("owner@buildesk.local");
lines.push("owner=" + (owner?.email ?? "missing"));
const planId = listPlans()[0]?.id ?? "";
const slug = "smoke-acme-" + Date.now().toString(36);
const result = provisionWorkspace({
  companyName: "Smoke Acme",
  slug,
  adminEmail: "admin@smoke-acme.test",
  adminDisplayName: "Smoke Admin",
  planId,
  trialDays: 14,
  actorId: owner!.id,
  inviteOnly: true,
});
lines.push("provision=" + JSON.stringify({ ok: result.ok, message: (result as any).message, id: result.workspace?.id }));
const dup = provisionWorkspace({
  companyName: "Other",
  slug: slug + "-2",
  adminEmail: "admin@smoke-acme.test",
  adminDisplayName: "Dup",
  planId,
  actorId: owner!.id,
  inviteOnly: true,
});
lines.push("dupBlocked=" + (!dup.ok) + " msg=" + (dup as any).message);
if (result.ok) {
  const entry = lookupEmail("admin@smoke-acme.test");
  lines.push("directory=" + JSON.stringify(entry));
  const state = readTenantDocument(tenantDbPathFor(result.workspace.id));
  const account = findAccountByEmail(state.accounts, "admin@smoke-acme.test");
  lines.push("adminStatus=" + account?.status + " needsSetup=" + !account?.passwordHash);
  lines.push("clientSession=" + createClientSession(result.workspace.id, account!.id).slice(0, 12));
  lines.push("platformSession=" + createPlatformSession(owner!.id).slice(0, 12));
}
writeFileSync("data/smoke-platform-result.txt", lines.join("\n"));
console.log(lines.join("\n"));

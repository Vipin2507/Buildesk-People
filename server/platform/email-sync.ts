import type { AppState } from "../../src/types.ts";
import { listEmailsForWorkspace, registerEmail, unregisterEmail } from "./db.ts";

/** Keep the global email directory aligned with tenant accounts after mutations. */
export function syncWorkspaceEmailDirectory(workspaceId: string, state: AppState): string[] {
  if (workspaceId === "legacy") return [];
  const errors: string[] = [];
  const desired = new Map<string, string>();
  for (const account of state.accounts) {
    if (!account.email) continue;
    if (account.status === "deactivated") continue;
    desired.set(account.email.toLowerCase(), account.id);
  }
  const existing = listEmailsForWorkspace(workspaceId);
  for (const entry of existing) {
    if (!desired.has(entry.email)) unregisterEmail(entry.email);
  }
  for (const [email, accountId] of desired) {
    const result = registerEmail(email, workspaceId, accountId);
    if (!result.ok) errors.push(`${email}: ${result.message}`);
  }
  return errors;
}

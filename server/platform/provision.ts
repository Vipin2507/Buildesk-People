import { copyFileSync, existsSync, mkdirSync, cpSync } from "node:fs";
import { join } from "node:path";
import { nowIso, uid } from "../../src/domain/dates.ts";
import { normalizeEmail } from "../../src/lib/auth.ts";
import type { AppState } from "../../src/types.ts";
import type { ClientWorkspace, PlatformPlan } from "../../src/types/platform.ts";
import { createSeed } from "../../src/data/seed.ts";
import { normalizeAttendance } from "../../src/domain/attendance.ts";
import { hashPassword } from "../password.ts";
import {
  getPlan,
  getWorkspaceBySlug,
  isValidSlug,
  lookupEmail,
  registerEmail,
  saveWorkspace,
  slugifyCompany,
  writePlatformAudit,
} from "./db.ts";
import { ensureTenantDatabase, tenantDataDirFor, tenantDbPathFor, closeTenantHandle, writeTenantDocument, readTenantDocument } from "../tenant/store.ts";

export type ProvisionInput = {
  companyName: string;
  slug?: string;
  adminEmail: string;
  adminDisplayName: string;
  planId: string;
  /** Explicit lifecycle. Defaults to active unless trialDays > 0 without status. */
  status?: "active" | "trial";
  expiresAt?: string | null;
  trialDays?: number;
  notes?: string;
  actorId: string;
  /** When true, create admin with passwordHash null so first login sets password. */
  inviteOnly?: boolean;
  temporaryPassword?: string;
};

export type ProvisionResult =
  | { ok: true; workspace: ClientWorkspace; setupMessage: string }
  | { ok: false; message: string; workspace?: ClientWorkspace };

function seedTenantAdmin(state: AppState, input: { email: string; displayName: string; passwordHash: string | null }): AppState {
  const email = normalizeEmail(input.email);
  const at = nowIso();
  const employeeId = uid("emp");
  const accountId = uid("usr");
  const [firstName, ...rest] = input.displayName.trim().split(/\s+/);
  const lastName = rest.join(" ") || "Admin";
  const employees = [
    {
      id: employeeId,
      employeeCode: "ADM-001",
      firstName: firstName || "Admin",
      lastName,
      email,
      jobTitle: "Client Super Admin",
      departmentId: state.departments[0]?.id || "dep_people",
      managerId: null as string | null,
      locationId: state.locations[0]?.id || "loc_blr",
      employmentType: "full_time" as const,
      status: "active" as const,
      joiningDate: at.slice(0, 10),
      role: "admin" as const,
      phone: "",
      personalEmail: "",
      address: "",
      emergencyName: "",
      emergencyRelationship: "",
      emergencyPhone: "",
      emergencySecondaryName: "",
      emergencySecondaryRelationship: "",
      emergencySecondaryPhone: "",
      dateOfBirth: "",
      showBirthday: false,
      monthlyGross: 0,
      avatarColor: "#4F6BED",
      photoUpdatedAt: null as string | null,
    },
    ...state.employees,
  ];
  const accounts = [
    {
      id: accountId,
      email,
      displayName: input.displayName.trim() || email,
      role: "admin" as const,
      status: (input.passwordHash ? "active" : "invited") as "active" | "invited",
      departmentId: employees[0].departmentId,
      employeeId,
      createdAt: at,
      updatedAt: at,
      invitedAt: at,
      activatedAt: input.passwordHash ? at : null,
      suspendedAt: null,
      deactivatedAt: null,
      passwordHash: input.passwordHash,
    },
    ...state.accounts.filter((item) => item.email !== email),
  ];
  const settings = {
    ...state.settings,
    orgName: state.settings.orgName,
  };
  return { ...state, employees, accounts, settings, currentUserId: null };
}

export function provisionWorkspace(input: ProvisionInput): ProvisionResult {
  const companyName = input.companyName.trim();
  if (companyName.length < 2) return { ok: false, message: "Enter a company name." };
  const slug = (input.slug?.trim() || slugifyCompany(companyName)).toLowerCase();
  if (!isValidSlug(slug)) return { ok: false, message: "Use a slug with lowercase letters, numbers, and hyphens only." };
  if (getWorkspaceBySlug(slug)) return { ok: false, message: "That workspace slug is already in use." };

  const adminEmail = normalizeEmail(input.adminEmail);
  if (!adminEmail.includes("@")) return { ok: false, message: "Enter a valid admin email." };
  if (lookupEmail(adminEmail)) return { ok: false, message: "That admin email is already registered to another workspace." };

  const plan = getPlan(input.planId);
  if (!plan || plan.status !== "active") return { ok: false, message: "Choose an active plan." };

  const workspaceId = uid("ws");
  const dbPath = tenantDbPathFor(workspaceId);
  const dataDir = tenantDataDirFor(workspaceId);
  const at = nowIso();
  const wantsTrial = input.status === "trial" || (input.status !== "active" && Boolean(input.trialDays && input.trialDays > 0));
  let expiresAt = input.expiresAt || null;
  if (wantsTrial && !expiresAt) {
    const days = input.trialDays && input.trialDays > 0 ? input.trialDays : 30;
    const d = new Date();
    d.setDate(d.getDate() + days);
    expiresAt = d.toISOString().slice(0, 10);
  }

  const workspace: ClientWorkspace = {
    id: workspaceId,
    slug,
    companyName,
    status: wantsTrial ? "trial" : "active",
    planId: plan.id,
    adminEmail,
    adminDisplayName: input.adminDisplayName.trim() || adminEmail,
    expiresAt,
    employeeLimitOverride: null,
    modulesOverride: null,
    notes: input.notes?.trim() || "",
    dbRelativePath: join("tenants", workspaceId.replace(/[^a-zA-Z0-9_-]/g, "_"), "buildesk.sqlite"),
    provisioningStatus: "creating_db",
    provisioningError: null,
    createdAt: at,
    updatedAt: at,
    suspendedAt: null,
    archivedAt: null,
  };

  if (existsSync(dbPath)) {
    return { ok: false, message: "A tenant database already exists for this id. Provisioning aborted to avoid overwrite." };
  }

  try {
    saveWorkspace(workspace);
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(join(dataDir, "photos"), { recursive: true });
    mkdirSync(join(dataDir, "policies"), { recursive: true });
    mkdirSync(join(dataDir, "payslips"), { recursive: true });

    workspace.provisioningStatus = "seeding";
    workspace.updatedAt = nowIso();
    saveWorkspace(workspace);

    let state = normalizeAttendance(createSeed());
    state = {
      ...state,
      settings: { ...state.settings, orgName: companyName },
      accounts: [],
      employees: [],
    };
    const passwordHash = input.inviteOnly || !input.temporaryPassword
      ? null
      : hashPassword(input.temporaryPassword);
    state = seedTenantAdmin(state, {
      email: adminEmail,
      displayName: workspace.adminDisplayName,
      passwordHash,
    });
    ensureTenantDatabase(dbPath, state);

    workspace.provisioningStatus = "registering";
    workspace.updatedAt = nowIso();
    saveWorkspace(workspace);

    const adminAccount = state.accounts[0];
    const registered = registerEmail(adminEmail, workspaceId, adminAccount.id);
    if (!registered.ok) {
      workspace.provisioningStatus = "failed";
      workspace.provisioningError = registered.message;
      workspace.updatedAt = nowIso();
      saveWorkspace(workspace);
      return { ok: false, message: registered.message, workspace };
    }

    workspace.provisioningStatus = "ready";
    workspace.provisioningError = null;
    workspace.updatedAt = nowIso();
    saveWorkspace(workspace);

    writePlatformAudit({
      actorId: input.actorId,
      action: "workspace.provision",
      targetType: "workspace",
      targetId: workspaceId,
      summary: `Provisioned workspace ${companyName} (${slug}).`,
      meta: { slug, planId: plan.id },
    });

    const setupMessage = passwordHash
      ? "Workspace ready. Share the temporary password with the client admin and ask them to change it after first sign-in."
      : "Workspace ready. The client admin can sign in with their email and create a password on first access.";

    return { ok: true, workspace, setupMessage };
  } catch (error) {
    workspace.provisioningStatus = "failed";
    workspace.provisioningError = error instanceof Error ? error.message : "Provisioning failed.";
    workspace.updatedAt = nowIso();
    saveWorkspace(workspace);
    writePlatformAudit({
      actorId: input.actorId,
      action: "workspace.provision_failed",
      targetType: "workspace",
      targetId: workspaceId,
      summary: `Provisioning failed for ${slug}: ${workspace.provisioningError}`,
    });
    return { ok: false, message: workspace.provisioningError, workspace };
  }
}

/** Register the existing single-tenant database as a named workspace without copying HR data. */
export function adoptLegacyWorkspace(input: {
  companyName: string;
  slug?: string;
  planId: string;
  actorId: string;
}): ProvisionResult {
  const legacyPath = join(process.cwd(), "data", "buildesk.sqlite");
  if (!existsSync(legacyPath)) return { ok: false, message: "No legacy data/buildesk.sqlite found to adopt." };

  const companyName = input.companyName.trim() || "Existing organization";
  const slug = (input.slug?.trim() || slugifyCompany(companyName)).toLowerCase();
  if (!isValidSlug(slug)) return { ok: false, message: "Invalid slug." };
  if (getWorkspaceBySlug(slug)) return { ok: false, message: "That slug is already in use." };
  const plan = getPlan(input.planId);
  if (!plan) return { ok: false, message: "Choose a plan." };

  const workspaceId = uid("ws");
  const targetDir = tenantDataDirFor(workspaceId);
  const targetDb = tenantDbPathFor(workspaceId);
  mkdirSync(targetDir, { recursive: true });

  // Copy (not move) so rollback remains possible until operators disable legacy mode.
  if (existsSync(targetDb)) return { ok: false, message: "Target tenant database already exists." };
  copyFileSync(legacyPath, targetDb);

  for (const folder of ["photos", "policies", "payslips"]) {
    const from = join(process.cwd(), "data", folder);
    const to = join(targetDir, folder);
    mkdirSync(to, { recursive: true });
    if (existsSync(from)) {
      try {
        cpSync(from, to, { recursive: true, force: false, errorOnExist: false });
      } catch {
        // Keep empty tenant folders if copy is blocked; operator can re-copy manually.
      }
    }
  }

  const state = readTenantDocument(targetDb);
  const at = nowIso();
  const workspace: ClientWorkspace = {
    id: workspaceId,
    slug,
    companyName: state.settings.orgName || companyName,
    status: "active",
    planId: plan.id,
    adminEmail: state.accounts.find((item) => item.role === "admin" || item.role === "hr")?.email || state.accounts[0]?.email || "admin@example.com",
    adminDisplayName: state.accounts.find((item) => item.role === "admin" || item.role === "hr")?.displayName || "Admin",
    expiresAt: null,
    employeeLimitOverride: null,
    modulesOverride: null,
    notes: "Adopted from legacy single-tenant database.",
    dbRelativePath: join("tenants", workspaceId.replace(/[^a-zA-Z0-9_-]/g, "_"), "buildesk.sqlite"),
    provisioningStatus: "ready",
    provisioningError: null,
    createdAt: at,
    updatedAt: at,
    suspendedAt: null,
    archivedAt: null,
  };
  saveWorkspace(workspace);

  for (const account of state.accounts) {
    if (!account.email) continue;
    registerEmail(account.email, workspaceId, account.id);
  }

  writeTenantDocument(targetDb, { ...state, settings: { ...state.settings, orgName: workspace.companyName } });
  closeTenantHandle(targetDb);

  writePlatformAudit({
    actorId: input.actorId,
    action: "workspace.adopt_legacy",
    targetType: "workspace",
    targetId: workspaceId,
    summary: `Adopted legacy database as workspace ${workspace.companyName} (${slug}).`,
  });

  return {
    ok: true,
    workspace,
    setupMessage: "Legacy database adopted. Users sign in with their existing emails; the server resolves the workspace automatically.",
  };
}

export function resolvePlanLimits(workspace: ClientWorkspace): { plan: PlatformPlan | null; employeeLimit: number; modules: string[] } {
  const plan = getPlan(workspace.planId);
  return {
    plan,
    employeeLimit: workspace.employeeLimitOverride ?? plan?.employeeLimit ?? 0,
    modules: workspace.modulesOverride ?? plan?.modules ?? [],
  };
}

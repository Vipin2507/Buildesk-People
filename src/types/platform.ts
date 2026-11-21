/** Control-plane types for Platform Super Admin and multi-client workspaces. */

export type PlatformOperatorRole = "owner" | "operator";
export type PlatformOperatorStatus = "active" | "invited" | "disabled";

export type WorkspaceStatus = "provisioning" | "active" | "trial" | "suspended" | "expired" | "archived";
export type ProvisioningStatus = "pending" | "creating_db" | "migrating" | "seeding" | "registering" | "ready" | "failed";

export type PlanStatus = "active" | "inactive";

export interface PlatformPlan {
  id: string;
  code: string;
  name: string;
  status: PlanStatus;
  employeeLimit: number;
  storageMb: number;
  /** Module keys enabled by default for this plan. */
  modules: string[];
  sortOrder: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformOperator {
  id: string;
  email: string;
  displayName: string;
  role: PlatformOperatorRole;
  status: PlatformOperatorStatus;
  passwordHash: string | null;
  createdAt: string;
  updatedAt: string;
  invitedAt: string | null;
  activatedAt: string | null;
  disabledAt: string | null;
}

export interface ClientWorkspace {
  id: string;
  slug: string;
  companyName: string;
  status: WorkspaceStatus;
  planId: string;
  adminEmail: string;
  adminDisplayName: string;
  expiresAt: string | null;
  employeeLimitOverride: number | null;
  modulesOverride: string[] | null;
  notes: string;
  /** Relative path under data/ for the tenant SQLite file. */
  dbRelativePath: string;
  provisioningStatus: ProvisioningStatus;
  provisioningError: string | null;
  createdAt: string;
  updatedAt: string;
  suspendedAt: string | null;
  archivedAt: string | null;
}

export interface EmailDirectoryEntry {
  email: string;
  workspaceId: string;
  accountId: string;
  updatedAt: string;
}

export interface PlatformAuditEvent {
  id: string;
  at: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  summary: string;
  meta?: Record<string, string | number | boolean | null>;
}

export const HRMS_MODULES = [
  "people",
  "attendance",
  "leave",
  "payroll",
  "expenses",
  "tickets",
  "assets",
  "policies",
  "automation",
  "teams",
] as const;

export type HrmsModule = (typeof HRMS_MODULES)[number];

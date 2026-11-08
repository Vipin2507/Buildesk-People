import type { AppState, DocumentSensitivity, Employee, EmployeeDocument, Permission, Role, Ticket } from "../types";

export interface PermissionMeta {
  id: Permission;
  group: string;
  label: string;
  description: string;
}

export const PERMISSIONS: PermissionMeta[] = [
  { id: "directory.view", group: "People", label: "View directory", description: "See the employee directory and organization chart." },
  { id: "people.manage", group: "People", label: "Manage people", description: "Add, edit, and deactivate employee records and reporting lines." },
  { id: "people.sensitive", group: "People", label: "View personal details", description: "See personal contact, address, and emergency details." },
  { id: "people.compensation", group: "People", label: "View compensation", description: "See demo monthly gross figures used for payroll." },
  { id: "attendance.self", group: "Attendance", label: "Own attendance", description: "Clock in, clock out, and view own attendance." },
  { id: "attendance.team", group: "Attendance", label: "Team attendance", description: "View attendance for direct reports." },
  { id: "attendance.company", group: "Attendance", label: "Company attendance", description: "View attendance across the company." },
  { id: "attendance.review", group: "Attendance", label: "Review corrections", description: "Approve or reject attendance corrections in scope." },
  { id: "leave.self", group: "Leave", label: "Own leave", description: "View balances and submit leave requests." },
  { id: "leave.team", group: "Leave", label: "Team leave", description: "View the team leave calendar." },
  { id: "leave.approve", group: "Leave", label: "Approve leave", description: "Approve or reject leave requests in scope." },
  { id: "leave.manage", group: "Leave", label: "Manage leave setup", description: "Maintain leave types, holidays, and comp-off grants." },
  { id: "payroll.self", group: "Payroll", label: "Own payslips", description: "View own payslips." },
  { id: "payroll.manage", group: "Payroll", label: "Run payroll", description: "Review inputs, generate, and finalize payroll runs." },
  { id: "expenses.self", group: "Expenses", label: "Own expenses", description: "Submit and track own expense claims." },
  { id: "expenses.review", group: "Expenses", label: "Review expenses", description: "Approve or reject expense claims in scope." },
  { id: "expenses.pay", group: "Expenses", label: "Mark reimbursed", description: "Mark approved expenses as paid." },
  { id: "insurance.self", group: "Insurance", label: "Own insurance", description: "View own insurance enrollment." },
  { id: "insurance.manage", group: "Insurance", label: "Manage insurance", description: "Maintain enrollment, dependents, and renewal dates." },
  { id: "tickets.self", group: "Tickets", label: "Own tickets", description: "Create tickets and follow own requests." },
  { id: "tickets.manage", group: "Tickets", label: "Handle tickets", description: "Assign and update tickets. Payroll admins are limited to payroll tickets." },
  { id: "assets.self", group: "Assets", label: "Own assets", description: "View assigned assets and acknowledge them." },
  { id: "assets.manage", group: "Assets", label: "Manage assets", description: "Maintain the asset register and assignments." },
  { id: "policies.view", group: "Policies", label: "View policies", description: "Read published policies that apply to you." },
  { id: "policies.manage", group: "Policies", label: "Manage policies", description: "Draft, publish, and archive HR policies." },
  { id: "documents.manage", group: "People", label: "Manage documents", description: "Upload employment documents to an employee profile." },
  { id: "reports.self", group: "Reports", label: "Own reports", description: "Export own attendance, leave, and expenses." },
  { id: "reports.team", group: "Reports", label: "Team reports", description: "Export reports for direct reports." },
  { id: "reports.org", group: "Reports", label: "Organization reports", description: "Export company reports that exclude payroll amounts." },
  { id: "reports.payroll", group: "Reports", label: "Payroll reports", description: "Export payroll registers with compensation amounts." },
  { id: "settings.org", group: "Settings", label: "Organization settings", description: "Maintain locations, departments, schedule, holidays, and categories." },
  { id: "settings.payroll", group: "Settings", label: "Payroll settings", description: "Maintain the payroll period and payroll notes." },
  { id: "settings.roles", group: "Settings", label: "Roles and permissions", description: "Maintain the demo permission matrix." },
  { id: "audit.view", group: "Settings", label: "View audit history", description: "See the audit trail allowed for the role." },
  { id: "users.manage", group: "User management", label: "Manage login accounts", description: "Invite, edit, suspend, and deactivate login accounts. System admin only unless this permission is granted." },
];

const ALL = PERMISSIONS.map((item) => item.id);

function setOf(ids: Permission[]): Permission[] {
  return ids;
}

export const DEFAULT_ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  employee: setOf([
    "directory.view",
    "attendance.self",
    "leave.self",
    "payroll.self",
    "expenses.self",
    "insurance.self",
    "tickets.self",
    "assets.self",
    "policies.view",
    "reports.self",
  ]),
  manager: setOf([
    "directory.view",
    "attendance.self",
    "attendance.team",
    "attendance.review",
    "leave.self",
    "leave.team",
    "leave.approve",
    "payroll.self",
    "expenses.self",
    "expenses.review",
    "insurance.self",
    "tickets.self",
    "assets.self",
    "policies.view",
    "reports.self",
    "reports.team",
  ]),
  hr: setOf([
    "directory.view",
    "people.manage",
    "people.sensitive",
    "attendance.self",
    "attendance.team",
    "attendance.company",
    "attendance.review",
    "leave.self",
    "leave.team",
    "leave.approve",
    "leave.manage",
    "payroll.self",
    "expenses.self",
    "expenses.review",
    "insurance.self",
    "insurance.manage",
    "tickets.self",
    "tickets.manage",
    "assets.self",
    "assets.manage",
    "policies.view",
    "policies.manage",
    "documents.manage",
    "reports.self",
    "reports.team",
    "reports.org",
    "settings.org",
    "audit.view",
  ]),
  payroll: setOf([
    "directory.view",
    "people.compensation",
    "attendance.self",
    "attendance.company",
    "leave.self",
    "payroll.self",
    "payroll.manage",
    "expenses.self",
    "expenses.review",
    "expenses.pay",
    "insurance.self",
    "tickets.self",
    "tickets.manage",
    "assets.self",
    "policies.view",
    "reports.self",
    "reports.org",
    "reports.payroll",
    "settings.payroll",
    "audit.view",
  ]),
  admin: ALL,
};

export const ROLES: Role[] = ["employee", "manager", "hr", "payroll", "admin"];

export function hasPermission(state: AppState, user: Employee | null, permission: Permission): boolean {
  if (!user) return false;
  const granted = state.settings.rolePermissions[user.role] ?? [];
  return granted.includes(permission);
}

export function canReview(
  state: AppState,
  actor: Employee | null,
  targetId: string,
  topic: "leave" | "attendance" | "expense",
): boolean {
  if (!actor || actor.id === targetId) return false;
  const target = state.employees.find((item) => item.id === targetId);
  if (!target || target.status === "inactive") return false;
  const permission =
    topic === "leave" ? "leave.approve" : topic === "attendance" ? "attendance.review" : "expenses.review";
  if (!hasPermission(state, actor, permission)) return false;
  if (actor.role === "admin" || actor.role === "hr") return true;
  if (topic === "expense" && actor.role === "payroll") return true;
  return target.managerId === actor.id;
}

export function canManageTicket(state: AppState, actor: Employee | null, ticket: Ticket): boolean {
  if (!actor || !hasPermission(state, actor, "tickets.manage")) return false;
  if (actor.role === "payroll") return ticket.category === "Payroll";
  return actor.role === "hr" || actor.role === "admin";
}

export function canSeeBirthday(viewer: Employee | null, person: Employee, sensitive: boolean): boolean {
  if (!viewer) return false;
  if (viewer.id === person.id) return true;
  if (!person.showBirthday && !sensitive) return false;
  return true;
}

export type ProfileSection = "personal" | "salary" | "team" | "emergency" | "documents" | "attendance" | "leaves" | "regularization" | "assets" | "policies";

export function canOpenProfile(state: AppState, viewer: Employee, employee: Employee): boolean {
  if (viewer.id === employee.id) return true;
  return hasPermission(state, viewer, "directory.view");
}

export function canSeeSensitiveContact(state: AppState, viewer: Employee, employee: Employee): boolean {
  return viewer.id === employee.id || hasPermission(state, viewer, "people.sensitive");
}

export function canSeeCompensation(state: AppState, viewer: Employee): boolean {
  return hasPermission(state, viewer, "people.compensation") || hasPermission(state, viewer, "payroll.manage");
}

export function canSeeDocument(state: AppState, viewer: Employee, document: EmployeeDocument): boolean {
  if (viewer.id === document.employeeId) return true;
  if (document.sensitivity === "compensation") return canSeeCompensation(state, viewer);
  if (document.sensitivity === "sensitive") return hasPermission(state, viewer, "people.sensitive");
  return hasPermission(state, viewer, "people.manage") || hasPermission(state, viewer, "people.sensitive");
}

export function canSeeSection(state: AppState, viewer: Employee, employee: Employee, section: ProfileSection): boolean {
  if (!canOpenProfile(state, viewer, employee)) return false;
  const self = viewer.id === employee.id;
  const directReport = employee.managerId === viewer.id;
  if (section === "salary") return canSeeCompensation(state, viewer) || (self && hasPermission(state, viewer, "payroll.self"));
  if (section === "emergency") return canSeeSensitiveContact(state, viewer, employee);
  if (section === "documents") return self || hasPermission(state, viewer, "people.manage") || hasPermission(state, viewer, "people.sensitive") || canSeeCompensation(state, viewer);
  if (section === "attendance") return self || hasPermission(state, viewer, "attendance.company") || (directReport && hasPermission(state, viewer, "attendance.team"));
  if (section === "leaves") return self || hasPermission(state, viewer, "leave.manage") || (directReport && hasPermission(state, viewer, "leave.team"));
  if (section === "regularization") return self || hasPermission(state, viewer, "attendance.company") || canReview(state, viewer, employee.id, "attendance");
  if (section === "assets") return self || hasPermission(state, viewer, "assets.manage") || directReport;
  return true;
}

export function documentSensitivityAllowed(sensitivity: DocumentSensitivity, state: AppState, viewer: Employee, ownerId: string): boolean {
  return canSeeDocument(state, viewer, {
    id: "",
    employeeId: ownerId,
    title: "",
    kind: "",
    sensitivity,
    fileName: "",
    uploadedAt: "",
    uploadedBy: "",
  });
}

export function defaultAssignee(state: AppState, category: string): string | null {
  const emailByCategory: Record<string, string> = {
    HR: "meera.iyer@buildesk.com",
    Payroll: "rohan.desai@buildesk.com",
    IT: "priya.nair@buildesk.com",
    Facilities: "meera.iyer@buildesk.com",
  };
  const email = emailByCategory[category] ?? "meera.iyer@buildesk.com";
  return state.employees.find((item) => item.email === email)?.id ?? null;
}

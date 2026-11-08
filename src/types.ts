export const DATA_VERSION = 3;

export type Role = "employee" | "manager" | "hr" | "payroll" | "admin";

export type Permission =
  | "directory.view"
  | "people.manage"
  | "people.sensitive"
  | "people.compensation"
  | "attendance.self"
  | "attendance.team"
  | "attendance.company"
  | "attendance.review"
  | "leave.self"
  | "leave.team"
  | "leave.approve"
  | "leave.manage"
  | "payroll.self"
  | "payroll.manage"
  | "expenses.self"
  | "expenses.review"
  | "expenses.pay"
  | "insurance.self"
  | "insurance.manage"
  | "tickets.self"
  | "tickets.manage"
  | "assets.self"
  | "assets.manage"
  | "policies.view"
  | "policies.manage"
  | "documents.manage"
  | "reports.self"
  | "reports.team"
  | "reports.org"
  | "reports.payroll"
  | "settings.org"
  | "settings.payroll"
  | "settings.roles"
  | "audit.view"
  | "users.manage";

export type EmploymentStatus = "active" | "on_notice" | "inactive";
export type EmploymentType = "full_time" | "contract";
export type WorkMode = "office" | "remote" | "client";
export type AttendanceStatus = "present" | "late" | "absent" | "leave" | "incomplete" | "holiday";
export type AttendanceSource = "punch" | "regularization" | "leave" | "system";
export type RequestStatus = "pending" | "approved" | "rejected";
export type ExpenseStatus = "pending" | "approved" | "rejected" | "paid";
export type TicketStatus = "open" | "in_progress" | "waiting" | "resolved";
export type TicketPriority = "low" | "medium" | "high" | "urgent";
export type AssetType = "laptop" | "phone" | "access_card" | "monitor" | "other";
export type AssetStatus = "available" | "assigned" | "repair" | "retired";
export type AssetCondition = "good" | "fair" | "poor";
export type PayrollStatus = "draft" | "in_review" | "finalized" | "paid";
export type PartialDay = "none" | "first_half" | "second_half";
export type AuditArea =
  | "people"
  | "attendance"
  | "leave"
  | "payroll"
  | "expenses"
  | "tickets"
  | "assets"
  | "policies"
  | "settings"
  | "insurance"
  | "users";
export type AuditScope = "general" | "payroll" | "insurance";
export type NotificationKind =
  | "approval"
  | "attendance"
  | "leave"
  | "payroll"
  | "ticket"
  | "birthday"
  | "event"
  | "expense"
  | "asset"
  | "policy";

export interface Department {
  id: string;
  name: string;
}

export interface WorkLocation {
  id: string;
  name: string;
  kind: "office" | "remote" | "client";
  city: string;
}

export type AccountStatus = "invited" | "active" | "suspended" | "deactivated";

/** A login account. This is not an employee record. */
export interface UserAccount {
  id: string;
  email: string;
  /** Shown in the product. Seeded accounts use the email until a name is provided. */
  displayName: string;
  role: Role;
  status: AccountStatus;
  departmentId: string | null;
  employeeId: string | null;
  createdAt: string;
  updatedAt: string;
  invitedAt: string | null;
  activatedAt: string | null;
  suspendedAt: string | null;
  deactivatedAt: string | null;
  /** Scrypt hash. Never sent to the browser. Null until the person chooses a password. */
  passwordHash: string | null;
}

export interface Employee {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  email: string;
  role: Role;
  demoLogin: boolean;
  jobTitle: string;
  departmentId: string;
  managerId: string | null;
  locationId: string;
  employmentType: EmploymentType;
  status: EmploymentStatus;
  joiningDate: string;
  phone: string;
  personalEmail: string;
  address: string;
  emergencyName: string;
  emergencyRelationship: string;
  emergencyPhone: string;
  emergencySecondaryName: string;
  emergencySecondaryRelationship: string;
  emergencySecondaryPhone: string;
  dateOfBirth: string;
  showBirthday: boolean;
  /** Demo compensation used only for payroll preview. Not a salary structure. */
  monthlyGross: number;
  avatarColor: string;
}

export interface LeaveType {
  id: string;
  name: string;
  paid: boolean;
  /** Null means the type has no annual cap, such as unpaid leave. */
  annual: number | null;
  allowHalfDay: boolean;
}

export interface OrgSettings {
  orgName: string;
  currency: string;
  workStart: string;
  graceMinutes: number;
  weeklyOff: number[];
  payrollStartDay: number;
  payrollEndDay: number;
  leaveTypes: LeaveType[];
  expenseCategories: string[];
  ticketCategories: string[];
  rolePermissions: Record<Role, Permission[]>;
}

export interface AttendanceRecord {
  id: string;
  employeeId: string;
  date: string;
  clockIn: string | null;
  clockOut: string | null;
  workMode: WorkMode | null;
  status: AttendanceStatus;
  source: AttendanceSource;
  note: string;
}

export interface HistoryEvent {
  id: string;
  at: string;
  actorId: string;
  action: string;
  comment: string;
}

export interface RegularizationRequest {
  id: string;
  employeeId: string;
  date: string;
  requestedIn: string;
  requestedOut: string;
  reason: string;
  attachmentName: string;
  status: RequestStatus;
  originalIn: string | null;
  originalOut: string | null;
  appliedIn: string | null;
  appliedOut: string | null;
  reviewerId: string | null;
  reviewComment: string;
  reviewedAt: string | null;
  submittedAt: string;
  history: HistoryEvent[];
}

export interface LeaveRequest {
  id: string;
  employeeId: string;
  typeId: string;
  startDate: string;
  endDate: string;
  partial: PartialDay;
  reason: string;
  attachmentName: string;
  status: RequestStatus;
  days: number;
  reviewerId: string | null;
  reviewComment: string;
  submittedAt: string;
  reviewedAt: string | null;
  history: HistoryEvent[];
}

export interface CompOffGrant {
  id: string;
  employeeId: string;
  days: number;
  earnedOn: string;
  expiresOn: string;
  reason: string;
  status: "available" | "used";
  usedOn: string | null;
  leaveRequestId: string | null;
}

export interface Holiday {
  id: string;
  name: string;
  date: string;
  locationId: string | "all";
}

export interface CompanyEvent {
  id: string;
  title: string;
  date: string;
  locationId: string | "all";
  description: string;
  kind: "event" | "festival";
}

export interface ExpenseClaim {
  id: string;
  employeeId: string;
  category: string;
  amount: number;
  date: string;
  description: string;
  receiptName: string;
  status: ExpenseStatus;
  payrollRunId: string | null;
  submittedAt: string;
  history: HistoryEvent[];
}

export interface InsuranceDependent {
  id: string;
  name: string;
  relationship: string;
  dateOfBirth: string;
}

export interface InsuranceRecord {
  id: string;
  employeeId: string;
  plan: string;
  policyNumber: string;
  coverage: string;
  renewalDate: string;
  dependents: InsuranceDependent[];
  notes: string;
}

export interface Ticket {
  id: string;
  number: string;
  employeeId: string;
  subject: string;
  description: string;
  category: string;
  priority: TicketPriority;
  status: TicketStatus;
  assigneeId: string | null;
  attachmentName: string;
  createdAt: string;
  updatedAt: string;
  history: HistoryEvent[];
}

export interface Asset {
  id: string;
  tag: string;
  name: string;
  type: AssetType;
  brand: string;
  model: string;
  serial: string;
  locationId: string;
  remarks: string;
  status: AssetStatus;
  condition: AssetCondition;
  assignedTo: string | null;
  assignedAt: string | null;
  returnedAt: string | null;
  acknowledged: boolean;
  history: HistoryEvent[];
}

export type DocumentSensitivity = "standard" | "sensitive" | "compensation";

export interface EmployeeDocument {
  id: string;
  employeeId: string;
  title: string;
  kind: string;
  sensitivity: DocumentSensitivity;
  fileName: string;
  uploadedAt: string;
  uploadedBy: string;
}

export type PolicyStatus = "draft" | "published" | "archived";

export type PolicyAudience =
  | { kind: "all" }
  | { kind: "location"; locationId: string }
  | { kind: "department"; departmentId: string };

export interface PolicyVersion {
  id: string;
  version: string;
  summary: string;
  content: string;
  fileName: string;
  effectiveDate: string;
  publishedAt: string | null;
}

export interface Policy {
  id: string;
  title: string;
  category: string;
  status: PolicyStatus;
  audience: PolicyAudience;
  versions: PolicyVersion[];
  updatedAt: string;
}

export interface PolicyAcknowledgement {
  id: string;
  policyId: string;
  version: string;
  employeeId: string;
  at: string;
}

export interface PayrollLine {
  employeeId: string;
  monthlyGross: number;
  presentDays: number;
  lateDays: number;
  leaveDays: number;
  unpaidLeaveDays: number;
  compOffDays: number;
  absentDays: number;
  incompleteDays: number;
  remoteDays: number;
  reimbursement: number;
  adjustment: number;
  adjustmentReason: string;
  exceptions: string[];
  payable: number;
}

export interface PayrollRun {
  id: string;
  periodStart: string;
  periodEnd: string;
  excludedDates: string[];
  status: PayrollStatus;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  finalizedAt: string | null;
  finalizedBy: string | null;
  paidAt: string | null;
  warnings: string[];
  lines: PayrollLine[];
}

export interface Payslip {
  id: string;
  runId: string;
  employeeId: string;
  periodStart: string;
  periodEnd: string;
  monthlyGross: number;
  adjustment: number;
  adjustmentReason: string;
  reimbursement: number;
  payable: number;
  presentDays: number;
  leaveDays: number;
  unpaidLeaveDays: number;
  absentDays: number;
  generatedAt: string;
}

export interface AppNotification {
  id: string;
  userId: string;
  title: string;
  body: string;
  href: string;
  read: boolean;
  createdAt: string;
  kind: NotificationKind;
}

export interface AuditEvent {
  id: string;
  at: string;
  actorId: string;
  area: AuditArea;
  summary: string;
  scope: AuditScope;
}

export interface AppState {
  currentUserId: string | null;
  accounts: UserAccount[];
  employees: Employee[];
  departments: Department[];
  locations: WorkLocation[];
  attendance: AttendanceRecord[];
  regularizations: RegularizationRequest[];
  leaveRequests: LeaveRequest[];
  compOff: CompOffGrant[];
  holidays: Holiday[];
  events: CompanyEvent[];
  expenses: ExpenseClaim[];
  insurance: InsuranceRecord[];
  tickets: Ticket[];
  assets: Asset[];
  documents: EmployeeDocument[];
  policies: Policy[];
  acknowledgements: PolicyAcknowledgement[];
  payrollRuns: PayrollRun[];
  payslips: Payslip[];
  notifications: AppNotification[];
  audits: AuditEvent[];
  settings: OrgSettings;
}

export type Result = { ok: true; id?: string } | { ok: false; message: string };

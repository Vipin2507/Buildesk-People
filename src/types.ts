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
  | "meetings.manage"
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
  | "users.manage"
  | "automation.manage";

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
export type PayrollStatus = "draft" | "calculated" | "in_review" | "verified" | "finalized" | "paid" | "failed";
export type PayrollValueSource = "attendance" | "employee" | "manual" | "imported" | "calculated" | "unconfigured";
export type PayrollRounding = "none" | "nearest_rupee" | "nearest_half";
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
  | "users"
  | "automation";
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
  /** When false, hidden from new assignments but kept for existing records. */
  active?: boolean;
}

export interface WorkLocation {
  id: string;
  name: string;
  kind: "office" | "remote" | "client";
  city: string;
  active?: boolean;
}

/** Configurable HR reference value managed in Settings → Masters. */
export interface MasterValue {
  id: string;
  name: string;
  /** Stable code for values that map to typed enums (e.g. work mode). */
  code?: string;
  description?: string;
  active: boolean;
  sortOrder?: number;
  updatedAt?: string;
  updatedBy?: string | null;
}

export type MasterKind =
  | "designations"
  | "employment_types"
  | "work_modes"
  | "regularization_reasons"
  | "asset_types"
  | "asset_conditions"
  | "policy_categories"
  | "emergency_relationships"
  | "event_types"
  | "payroll_earnings"
  | "payroll_deductions"
  | "hr_meeting_topics"
  | "notification_categories";

export type MastersCatalog = Record<MasterKind, MasterValue[]>;

export interface HalfDayPolicy {
  /** Company-declared half-day hours threshold. Null means not configured for hour-based rules. */
  thresholdHours: number | null;
  allowEmployeeRequest: boolean;
  effectiveDate: string | null;
  note: string;
}

export interface NotificationPrefs {
  birthdays: boolean;
  events: boolean;
  approvals: boolean;
  attendance: boolean;
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
  /** Configured monthly gross used for payroll. Statutory deductions are not calculated from this figure. */
  monthlyGross: number;
  /** Optional bank details for payroll payment. Masked in the UI unless payroll.manage is granted. */
  bankAccountName?: string;
  bankAccountNumber?: string;
  bankIfsc?: string;
  avatarColor: string;
  /** Set when a profile photo file is stored for this employee. The image itself is not kept in this record. */
  photoUpdatedAt?: string | null;
}

export interface LeaveType {
  id: string;
  name: string;
  paid: boolean;
  /** Null means the type has no annual cap, such as unpaid leave. */
  annual: number | null;
  allowHalfDay: boolean;
  /** When false, hidden from new requests but kept for historical leave. */
  active?: boolean;
}

export type PayslipPaperSize = "letter" | "a4";

export interface OrgSettings {
  orgName: string;
  currency: string;
  /** Company timezone label for display. The office punch clock remains Asia/Kolkata in this build. */
  timezone?: string;
  /** Legal name printed on payslips. Falls back to orgName when empty. */
  legalName?: string;
  /** Registered office address printed under the company name on payslips. */
  registeredAddress?: string;
  /** CIN or other registration identifier printed on payslips when configured. */
  registrationId?: string;
  /** Payslip page size. Defaults to US Letter to match the reference template. */
  payslipPaperSize?: PayslipPaperSize;
  /** Template id stamped on generated payslip files. */
  payslipTemplateVersion?: string;
  /** Optional note printed in the payslip note area. */
  payslipNotes?: string;
  workStart: string;
  /** Workday end as HH:MM (Asia/Kolkata). Used for logout reminders; optional until configured. */
  workEnd?: string;
  graceMinutes: number;
  weeklyOff: number[];
  payrollStartDay: number;
  payrollEndDay: number;
  /** Month number 1–12 when the financial year starts. Used only to group payroll history folders. */
  financialYearStartMonth?: number;
  /** When set, daily wage = monthly gross ÷ this divisor. Null means daily wage is not calculated. */
  payrollDailyWageDivisor?: number | null;
  payrollRounding?: PayrollRounding;
  leaveTypes: LeaveType[];
  expenseCategories: string[];
  ticketCategories: string[];
  rolePermissions: Record<Role, Permission[]>;
  /** When true, a punch is saved only after a one-time device position is captured. */
  attendanceLocationRequired: boolean;
  /** Days to keep punch coordinates with the attendance record. Null means no separate retention period is configured. */
  locationRetentionDays: number | null;
  halfDayPolicy?: HalfDayPolicy;
  notificationPrefs?: NotificationPrefs;
}

export type LocationCaptureStatus = "captured" | "denied" | "unavailable" | "not_requested" | "manual";

/** Device position for one punch. Coordinates are present only when status is captured. */
export interface PunchLocation {
  status: LocationCaptureStatus;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  capturedAt: string | null;
  /** Written place name for display. The stored position remains the device reading. */
  placeLabel?: string | null;
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
  clockInLocation?: PunchLocation | null;
  clockOutLocation?: PunchLocation | null;
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
  originalClockInLocation?: PunchLocation | null;
  originalClockOutLocation?: PunchLocation | null;
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
  /** YYYY-MM-DD. For annual recurrence, month-day repeats every year. */
  date: string;
  locationId: string | "all";
  /** once = that calendar date only; annual = same month-day every year (fixed national days). */
  recurrence?: "once" | "annual";
}

export interface CompanyEvent {
  id: string;
  title: string;
  date: string;
  /** Inclusive end date for multi-day events; omit or same as date for single-day. */
  endDate?: string;
  locationId: string | "all";
  description: string;
  kind: "event" | "festival";
  /** All company events are all-day in the current model (no timed slots). */
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

/** Standard helpdesk ticket vs HR meeting/call request. */
export type TicketKind = "support" | "hr_meeting";

export type HrMeetingRequestType = "teams" | "phone";

export type HrMeetingStatus =
  | "submitted"
  | "awaiting_hr"
  | "approved_sync_pending"
  | "scheduled"
  | "rescheduled_sync_pending"
  | "rejected"
  | "cancelled"
  | "sync_failed";

export type CalendarSyncStatus = "idle" | "pending" | "synced" | "failed" | "cancelled" | "not_connected";

export interface HrMeetingSlot {
  date: string;
  startTime: string;
  durationMinutes: number;
  timezone: string;
}

export interface HrMeetingDetails {
  requestType: HrMeetingRequestType;
  topic: string;
  preferred: HrMeetingSlot;
  alternative: HrMeetingSlot | null;
  confirmed: HrMeetingSlot | null;
  /** Original preferred slot preserved when HR reschedules. */
  originalPreferred: HrMeetingSlot;
  contactNote: string;
  meetingStatus: HrMeetingStatus;
  organizerEmail: string | null;
  organizerEmployeeId: string | null;
  graphEventId: string | null;
  joinUrl: string | null;
  webLink: string | null;
  calendarSyncStatus: CalendarSyncStatus;
  syncAttemptCount: number;
  lastSyncError: string | null;
  lastSyncedAt: string | null;
  idempotencyKey: string;
  hrResponse: string;
  pendingSyncAction: "create" | "update" | "cancel" | null;
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
  /** Defaults to support for older tickets. */
  kind?: TicketKind;
  meeting?: HrMeetingDetails | null;
}

/** Non-secret Microsoft 365 / Teams calendar connection settings (client secret stays in env). */
export interface Microsoft365Config {
  enabled: boolean;
  tenantId: string;
  clientId: string;
  defaultOrganizerEmail: string;
  allowedOrganizerEmails: string[];
  /** When true or credentials missing, UI shows Not connected / Demo mode — never fake join links. */
  demoMode: boolean;
  lastHealthCheck?: {
    ok: boolean;
    at: string;
    message: string;
  };
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
  /** Derived/manual register fields. Older runs may omit these; normalize before display. */
  fullDays?: number;
  halfDays?: number;
  weeklyOffs?: number;
  paidLeaveDays?: number;
  paidDays?: number;
  lopDays?: number;
  dailyWage?: number | null;
  overtime?: number;
  extras?: number;
  arrears?: number;
  grossEarnings?: number;
  pf?: number;
  esic?: number;
  penalties?: number;
  loan?: number;
  otherDeductions?: number;
  totalDeductions?: number;
  needsRecalc?: boolean;
  sources?: Partial<Record<string, PayrollValueSource>>;
}

export interface PayrollImportRecord {
  id: string;
  at: string;
  actorId: string;
  fileName: string;
  rowCount: number;
  warningCount: number;
  summary: string;
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
  calculatedAt?: string | null;
  verifiedAt?: string | null;
  verifiedBy?: string | null;
  verifyNote?: string;
  paymentReference?: string | null;
  paymentNote?: string | null;
  recalcRequired?: boolean;
  importHistory?: PayrollImportRecord[];
}

export interface PayslipComponent {
  key: string;
  label: string;
  amount: number;
  kind: "earning" | "deduction";
}

/** ready = approved run snapshot; generated = PDF created; published = visible to employee; superseded = replaced version. */
export type PayslipStatus = "ready" | "generated" | "published" | "superseded";

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
  /** When true, the employee with payroll.self may view/download this slip. */
  published?: boolean;
  publishedAt?: string | null;
  publishedBy?: string | null;
  generatedBy?: string | null;
  overtime?: number;
  extras?: number;
  arrears?: number;
  pf?: number;
  esic?: number;
  penalties?: number;
  loan?: number;
  otherDeductions?: number;
  totalDeductions?: number;
  grossEarnings?: number;
  paidDays?: number;
  lopDays?: number;
  status?: PayslipStatus;
  version?: number;
  templateVersion?: string;
  /** Opaque storage key for the PDF binary under data/payslips. */
  documentKey?: string | null;
  earningComponents?: PayslipComponent[];
  deductionComponents?: PayslipComponent[];
  companySnapshot?: {
    legalName: string;
    address: string;
    registrationId: string;
    currency: string;
    paperSize?: PayslipPaperSize;
    notes?: string;
  };
  employeeSnapshot?: {
    name: string;
    employeeCode: string;
    designation: string;
    department: string;
    location: string;
  };
  notes?: string;
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
  /** Configurable HR master lists. Normalized on read for older workspaces. */
  masters?: MastersCatalog;
  /** WhatsApp (WAHA) + email (n8n webhook) automation. Normalized on read for older workspaces. */
  automation?: import("./types/automation").AutomationConfig;
  /** Microsoft 365 / Teams calendar (non-secret fields). Client secret uses env only. */
  microsoft365?: Microsoft365Config;
}

export type Result = { ok: true; id?: string } | { ok: false; message: string };

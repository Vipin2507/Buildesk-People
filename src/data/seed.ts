import { DEFAULT_ROLE_PERMISSIONS } from "../lib/access";
import { normalizeAttendance, derivePunchStatus } from "../domain/attendance";
import { addDays, eachDate, todayIso, uid, weekday, wallNow } from "../domain/dates";
import { buildPayrollLines, periodWarnings, previousPeriod, currentPeriod } from "../domain/payroll";
import { projectLeaveAttendance, workingDaysFor } from "../domain/leave";
import type {
  AppNotification,
  AppState,
  Asset,
  AttendanceRecord,
  AuditEvent,
  CompanyEvent,
  CompOffGrant,
  Employee,
  EmployeeDocument,
  ExpenseClaim,
  HistoryEvent,
  Holiday,
  InsuranceRecord,
  LeaveRequest,
  PayrollRun,
  Payslip,
  Policy,
  RegularizationRequest,
  UserAccount,
  Ticket,
  WorkMode,
} from "../types";

const COLORS = ["#1d4ed8", "#0f766e", "#7c3aed", "#b45309", "#0369a1", "#4338ca", "#047857", "#be123c", "#0e7490", "#4f46e5", "#9f1239", "#155e75", "#6d28d9", "#3f6212", "#9a3412"];

/** Development seed for login accounts. Rerunning createSeed replaces state and keeps one row per email. */
export function seedLoginAccounts(stamp: string): UserAccount[] {
  const seeded = [
    { email: "shruti@cravingcode.in", displayName: "Shruti Jain", employeeId: "emp_shruti" },
    { email: "stuty@cravingcode.in", displayName: "Stuty Chauhan", employeeId: "emp_stuty" },
  ];
  const seen = new Set<string>();
  const accounts: UserAccount[] = [];
  for (const item of seeded) {
    const key = item.email.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const id = `usr_${key.slice(0, key.indexOf("@"))}`;
    accounts.push({
      id,
      email: key,
      displayName: item.displayName,
      role: "hr",
      status: "active",
      departmentId: "dep_people",
      employeeId: item.employeeId,
      createdAt: stamp,
      updatedAt: stamp,
      invitedAt: stamp,
      activatedAt: stamp,
      suspendedAt: null,
      deactivatedAt: null,
      passwordHash: null,
    });
  }
  return accounts;
}

function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seedDocuments(today: string): EmployeeDocument[] {
  return [
    { id: "doc_ananya_offer", employeeId: "emp_ananya", title: "Offer letter", kind: "Employment", sensitivity: "compensation", fileName: "ananya-rao-offer.txt", uploadedAt: atHour(addDays(today, -400), 10), uploadedBy: "emp_meera" },
    { id: "doc_ananya_appoint", employeeId: "emp_ananya", title: "Appointment letter", kind: "Employment", sensitivity: "standard", fileName: "ananya-rao-appointment.txt", uploadedAt: atHour(addDays(today, -390), 10), uploadedBy: "emp_meera" },
    { id: "doc_ananya_id", employeeId: "emp_ananya", title: "Identity proof", kind: "Personal", sensitivity: "sensitive", fileName: "ananya-rao-id.txt", uploadedAt: atHour(addDays(today, -380), 10), uploadedBy: "emp_meera" },
    { id: "doc_kabir_appoint", employeeId: "emp_kabir", title: "Appointment letter", kind: "Employment", sensitivity: "standard", fileName: "kabir-singh-appointment.txt", uploadedAt: atHour(addDays(today, -500), 10), uploadedBy: "emp_meera" },
  ];
}

function seedPolicies(today: string): Policy[] {
  const published = atHour(addDays(today, -20), 9);
  return [
    {
      id: "pol_conduct",
      title: "Code of conduct",
      category: "Conduct",
      status: "published",
      audience: { kind: "all" },
      updatedAt: published,
      versions: [
        { id: "pol_conduct_v1", version: "1.0", summary: "First published conduct expectations for every Buildesk employee.", content: "Treat colleagues, candidates, and clients with respect. Report concerns to HR. This version has been superseded by 2.0.", fileName: "code-of-conduct-v1.txt", effectiveDate: addDays(today, -400), publishedAt: atHour(addDays(today, -400), 9) },
        { id: "pol_conduct_v2", version: "2.0", summary: "Updated conduct policy, including how to raise a concern and what happens next.", content: "Buildesk expects professional, respectful behaviour at the office, on client sites, and in work tools. Speak to your manager or HR if you see harassment, discrimination, or a conflict of interest. Retaliation for a good-faith report is not allowed. This is a demo policy, not a legal document.", fileName: "code-of-conduct-v2.txt", effectiveDate: addDays(today, -20), publishedAt: published },
      ],
    },
    {
      id: "pol_blr",
      title: "Bengaluru workplace guidelines",
      category: "Workplace",
      status: "published",
      audience: { kind: "location", locationId: "loc_blr" },
      updatedAt: atHour(addDays(today, -10), 9),
      versions: [
        { id: "pol_blr_v1", version: "1.0", summary: "Desk, visitor, and meeting-room expectations for Bengaluru HQ.", content: "Bengaluru HQ is open on scheduled working days from 9:30 am. Book meeting rooms in the workplace calendar. Visitors sign in at reception. This policy applies to employees whose work location is Bengaluru HQ.", fileName: "bengaluru-workplace.txt", effectiveDate: addDays(today, -10), publishedAt: atHour(addDays(today, -10), 9) },
      ],
    },
    {
      id: "pol_mum",
      title: "Mumbai office guidelines",
      category: "Workplace",
      status: "published",
      audience: { kind: "location", locationId: "loc_mum" },
      updatedAt: atHour(addDays(today, -12), 9),
      versions: [
        { id: "pol_mum_v1", version: "1.0", summary: "Working arrangements for the Mumbai office.", content: "Mumbai office employees follow the Mumbai holiday calendar. Client meetings off-site should be noted with your manager. This policy does not apply to Bengaluru HQ.", fileName: "mumbai-office.txt", effectiveDate: addDays(today, -12), publishedAt: atHour(addDays(today, -12), 9) },
      ],
    },
    {
      id: "pol_hybrid",
      title: "Hybrid work draft",
      category: "Workplace",
      status: "draft",
      audience: { kind: "all" },
      updatedAt: atHour(addDays(today, -2), 15),
      versions: [
        { id: "pol_hybrid_v1", version: "0.1", summary: "Draft guidance for choosing office, remote, or client-site days.", content: "This draft is not published. Employees will not see it until HR publishes a version.", fileName: "hybrid-work-draft.txt", effectiveDate: addDays(today, 14), publishedAt: null },
      ],
    },
  ];
}

function atHour(iso: string, hour: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, hour, 12, 0).toISOString();
}

function walkWeekdays(from: string, step: number, count: number, weeklyOff: number[]): string {
  let cursor = from;
  let seen = 0;
  while (seen < count) {
    cursor = addDays(cursor, step);
    if (!weeklyOff.includes(weekday(cursor))) seen += 1;
  }
  return cursor;
}

function previousSaturday(today: string): string {
  let cursor = addDays(today, -1);
  while (weekday(cursor) !== 6) cursor = addDays(cursor, -1);
  return cursor;
}

function holidayTitle(date: string): string {
  const month = Number(date.slice(5, 7));
  if (month === 10 || month === 11) return "Diwali";
  if (month === 12 || month === 1) return "Year-end holiday";
  if (month === 3) return "Holi";
  if (month === 8) return "Independence Day";
  return "Company holiday";
}

function dob(today: string, offset: number, year: number): string {
  return `${year}-${addDays(today, offset).slice(5)}`;
}

function hist(actorId: string, action: string, comment: string, at: string): HistoryEvent {
  return { id: uid("hist"), at, actorId, action, comment };
}

function note(userId: string, title: string, body: string, href: string, kind: AppNotification["kind"], at: string, read = false): AppNotification {
  return { id: uid("ntf"), userId, title, body, href, read, createdAt: at, kind };
}

type Preset = "present" | "late" | "remote" | "client" | "incomplete" | "absent";

export function createSeed(): AppState {
  const today = todayIso();
  const settings = {
    orgName: "Buildesk",
    currency: "INR",
    workStart: "09:30",
    graceMinutes: 15,
    weeklyOff: [0, 6],
    payrollStartDay: 1,
    payrollEndDay: 30,
    leaveTypes: [
      { id: "casual", name: "Casual leave", paid: true, annual: 8, allowHalfDay: true },
      { id: "sick", name: "Sick leave", paid: true, annual: 10, allowHalfDay: true },
      { id: "earned", name: "Earned leave", paid: true, annual: 15, allowHalfDay: false },
      { id: "unpaid", name: "Unpaid leave", paid: false, annual: null, allowHalfDay: true },
      { id: "comp-off", name: "Comp-off", paid: true, annual: null, allowHalfDay: true },
    ],
    expenseCategories: ["Travel", "Meals", "Software", "Office supplies", "Other"],
    ticketCategories: ["HR", "Payroll", "IT", "Facilities", "Other"],
    rolePermissions: structuredClone(DEFAULT_ROLE_PERMISSIONS),
  };

  const departments = [
    { id: "dep_eng", name: "Engineering" },
    { id: "dep_design", name: "Design" },
    { id: "dep_people", name: "People" },
    { id: "dep_fin", name: "Finance" },
    { id: "dep_sales", name: "Sales" },
    { id: "dep_work", name: "Workplace" },
    { id: "dep_tech", name: "Technology" },
    { id: "dep_exec", name: "Executive" },
  ];

  const locations = [
    { id: "loc_blr", name: "Bengaluru HQ", kind: "office" as const, city: "Bengaluru" },
    { id: "loc_mum", name: "Mumbai office", kind: "office" as const, city: "Mumbai" },
    { id: "loc_remote", name: "Remote — India", kind: "remote" as const, city: "India" },
    { id: "loc_client", name: "Client site", kind: "client" as const, city: "Varies" },
  ];

  const nextWeekday = walkWeekdays(today, 1, 1, settings.weeklyOff);
  let mumbaiHoliday = walkWeekdays(today, 1, 12, settings.weeklyOff);
  if (mumbaiHoliday === nextWeekday) mumbaiHoliday = walkWeekdays(mumbaiHoliday, 1, 1, settings.weeklyOff);
  const pastHoliday = walkWeekdays(today, -1, 12, settings.weeklyOff);

  const holidays: Holiday[] = [
    { id: "hol_next", name: holidayTitle(nextWeekday), date: nextWeekday, locationId: "all" },
    { id: "hol_past", name: "Observed office holiday", date: pastHoliday, locationId: "all" },
    { id: "hol_mum", name: "Mumbai office holiday", date: mumbaiHoliday, locationId: "loc_mum" },
  ];

  const collect = (start: string, step: number, count: number, locationId: string) => {
    const days: string[] = [];
    let cursor = start;
    while (days.length < count) {
      cursor = addDays(cursor, step);
      const weekend = settings.weeklyOff.includes(weekday(cursor));
      const holiday = holidays.some((item) => item.date === cursor && (item.locationId === "all" || item.locationId === locationId));
      if (!weekend && !holiday) days.push(cursor);
    }
    return days;
  };
  const past = collect(today, -1, 24, "loc_blr");
  const future = collect(today, 1, 16, "loc_blr");

  const person = (input: Omit<Employee, "avatarColor" | "emergencyRelationship" | "emergencySecondaryName" | "emergencySecondaryRelationship" | "emergencySecondaryPhone"> & { avatarColor?: string }, index: number): Employee => ({
    avatarColor: COLORS[index % COLORS.length],
    emergencyRelationship: "Family",
    emergencySecondaryName: "",
    emergencySecondaryRelationship: "",
    emergencySecondaryPhone: "",
    ...input,
  });

  const employees: Employee[] = [
    person({ id: "emp_arjun", employeeCode: "BE-1001", firstName: "Arjun", lastName: "Mehta", email: "arjun.mehta@buildesk.com", role: "employee", demoLogin: false, jobTitle: "Chief Executive Officer", departmentId: "dep_exec", managerId: null, locationId: "loc_blr", employmentType: "full_time", status: "active", joiningDate: "2019-04-01", phone: "+91 90000 10001", personalEmail: "arjun.mehta@email.test", address: "Indiranagar, Bengaluru", emergencyName: "Nita Mehta", emergencyPhone: "+91 90000 20001", dateOfBirth: dob(today, 21, 1984), showBirthday: true, monthlyGross: 250000 }, 0),
    person({ id: "emp_vikram", employeeCode: "BE-1008", firstName: "Vikram", lastName: "Shah", email: "vikram.shah@buildesk.com", role: "manager", demoLogin: false, jobTitle: "Engineering Manager", departmentId: "dep_eng", managerId: "emp_arjun", locationId: "loc_blr", employmentType: "full_time", status: "active", joiningDate: "2021-06-14", phone: "+91 90000 10008", personalEmail: "vikram.shah@email.test", address: "Koramangala, Bengaluru", emergencyName: "Rhea Shah", emergencyPhone: "+91 90000 20008", dateOfBirth: dob(today, 48, 1988), showBirthday: true, monthlyGross: 180000 }, 1),
    person({ id: "emp_ananya", employeeCode: "BE-1042", firstName: "Ananya", lastName: "Rao", email: "ananya.rao@buildesk.com", role: "employee", demoLogin: false, jobTitle: "Software Engineer", departmentId: "dep_eng", managerId: "emp_vikram", locationId: "loc_blr", employmentType: "full_time", status: "active", joiningDate: "2023-02-06", phone: "+91 90000 10042", personalEmail: "ananya.rao@email.test", address: "HSR Layout, Bengaluru", emergencyName: "Lata Rao", emergencyPhone: "+91 90000 20042", dateOfBirth: dob(today, 26, 1996), showBirthday: true, monthlyGross: 125000 }, 2),
    person({ id: "emp_kabir", employeeCode: "BE-1048", firstName: "Kabir", lastName: "Singh", email: "kabir.singh@buildesk.com", role: "employee", demoLogin: false, jobTitle: "Software Engineer", departmentId: "dep_eng", managerId: "emp_vikram", locationId: "loc_blr", employmentType: "full_time", status: "active", joiningDate: "2022-11-21", phone: "+91 90000 10048", personalEmail: "kabir.singh@email.test", address: "Jayanagar, Bengaluru", emergencyName: "Aman Singh", emergencyPhone: "+91 90000 20048", dateOfBirth: dob(today, 5, 1994), showBirthday: true, monthlyGross: 118000 }, 3),
    person({ id: "emp_sana", employeeCode: "BE-1055", firstName: "Sana", lastName: "Qureshi", email: "sana.qureshi@buildesk.com", role: "employee", demoLogin: false, jobTitle: "QA Engineer", departmentId: "dep_eng", managerId: "emp_vikram", locationId: "loc_remote", employmentType: "full_time", status: "active", joiningDate: "2024-01-15", phone: "+91 90000 10055", personalEmail: "sana.qureshi@email.test", address: "Pune", emergencyName: "Imran Qureshi", emergencyPhone: "+91 90000 20055", dateOfBirth: dob(today, 2, 1997), showBirthday: true, monthlyGross: 96000 }, 4),
    person({ id: "emp_divya", employeeCode: "BE-1061", firstName: "Divya", lastName: "Menon", email: "divya.menon@buildesk.com", role: "employee", demoLogin: false, jobTitle: "Product Designer", departmentId: "dep_design", managerId: "emp_vikram", locationId: "loc_blr", employmentType: "full_time", status: "active", joiningDate: "2023-08-07", phone: "+91 90000 10061", personalEmail: "divya.menon@email.test", address: "Whitefield, Bengaluru", emergencyName: "Arun Menon", emergencyPhone: "+91 90000 20061", dateOfBirth: dob(today, 11, 1995), showBirthday: true, monthlyGross: 110000 }, 5),
    person({ id: "emp_omar", employeeCode: "BE-1070", firstName: "Omar", lastName: "Farooq", email: "omar.farooq@buildesk.com", role: "employee", demoLogin: false, jobTitle: "Software Engineer", departmentId: "dep_eng", managerId: "emp_vikram", locationId: "loc_blr", employmentType: "full_time", status: "active", joiningDate: "2022-03-28", phone: "+91 90000 10070", personalEmail: "omar.farooq@email.test", address: "Hebbal, Bengaluru", emergencyName: "Yusuf Farooq", emergencyPhone: "+91 90000 20070", dateOfBirth: dob(today, 44, 1993), showBirthday: true, monthlyGross: 122000 }, 6),
    person({ id: "emp_meera", employeeCode: "BE-1014", firstName: "Meera", lastName: "Iyer", email: "meera.iyer@buildesk.com", role: "hr", demoLogin: false, jobTitle: "HR Manager", departmentId: "dep_people", managerId: "emp_arjun", locationId: "loc_blr", employmentType: "full_time", status: "active", joiningDate: "2020-09-01", phone: "+91 90000 10014", personalEmail: "meera.iyer@email.test", address: "Malleshwaram, Bengaluru", emergencyName: "Karthik Iyer", emergencyPhone: "+91 90000 20014", dateOfBirth: dob(today, 33, 1989), showBirthday: true, monthlyGross: 145000 }, 7),
    person({ id: "emp_neha", employeeCode: "BE-1088", firstName: "Neha", lastName: "Kapoor", email: "neha.kapoor@buildesk.com", role: "employee", demoLogin: false, jobTitle: "HR Executive", departmentId: "dep_people", managerId: "emp_meera", locationId: "loc_blr", employmentType: "full_time", status: "active", joiningDate: "2024-05-20", phone: "+91 90000 10088", personalEmail: "neha.kapoor@email.test", address: "JP Nagar, Bengaluru", emergencyName: "Pooja Kapoor", emergencyPhone: "+91 90000 20088", dateOfBirth: dob(today, 3, 1998), showBirthday: false, monthlyGross: 82000 }, 8),
    person({ id: "emp_rohan", employeeCode: "BE-1022", firstName: "Rohan", lastName: "Desai", email: "rohan.desai@buildesk.com", role: "payroll", demoLogin: false, jobTitle: "Payroll Lead", departmentId: "dep_fin", managerId: "emp_arjun", locationId: "loc_blr", employmentType: "full_time", status: "active", joiningDate: "2021-01-11", phone: "+91 90000 10022", personalEmail: "rohan.desai@email.test", address: "Sadashivanagar, Bengaluru", emergencyName: "Asha Desai", emergencyPhone: "+91 90000 20022", dateOfBirth: dob(today, 28, 1987), showBirthday: true, monthlyGross: 155000 }, 9),
    person({ id: "emp_arun", employeeCode: "BE-1094", firstName: "Arun", lastName: "Patel", email: "arun.patel@buildesk.com", role: "employee", demoLogin: false, jobTitle: "Finance Associate", departmentId: "dep_fin", managerId: "emp_rohan", locationId: "loc_mum", employmentType: "contract", status: "active", joiningDate: "2025-04-01", phone: "+91 90000 10094", personalEmail: "arun.patel@email.test", address: "Andheri, Mumbai", emergencyName: "Kiran Patel", emergencyPhone: "+91 90000 20094", dateOfBirth: dob(today, 6, 1996), showBirthday: true, monthlyGross: 90000 }, 10),
    person({ id: "emp_priya", employeeCode: "BE-1033", firstName: "Priya", lastName: "Nair", email: "priya.nair@buildesk.com", role: "admin", demoLogin: false, jobTitle: "Systems Administrator", departmentId: "dep_tech", managerId: "emp_arjun", locationId: "loc_blr", employmentType: "full_time", status: "active", joiningDate: "2020-02-17", phone: "+91 90000 10033", personalEmail: "priya.nair@email.test", address: "Cooke Town, Bengaluru", emergencyName: "Dev Nair", emergencyPhone: "+91 90000 20033", dateOfBirth: dob(today, 8, 1991), showBirthday: true, monthlyGross: 138000 }, 11),
    person({ id: "emp_leela", employeeCode: "BE-1102", firstName: "Leela", lastName: "Krishnan", email: "leela.krishnan@buildesk.com", role: "employee", demoLogin: false, jobTitle: "Office Manager", departmentId: "dep_work", managerId: "emp_meera", locationId: "loc_blr", employmentType: "full_time", status: "active", joiningDate: "2022-07-04", phone: "+91 90000 10102", personalEmail: "leela.krishnan@email.test", address: "Basavanagudi, Bengaluru", emergencyName: "Mohan Krishnan", emergencyPhone: "+91 90000 20102", dateOfBirth: dob(today, 18, 1992), showBirthday: true, monthlyGross: 74000 }, 12),
    person({ id: "emp_ishita", employeeCode: "BE-1110", firstName: "Ishita", lastName: "Banerjee", email: "ishita.banerjee@buildesk.com", role: "employee", demoLogin: false, jobTitle: "Account Executive", departmentId: "dep_sales", managerId: "emp_arjun", locationId: "loc_mum", employmentType: "full_time", status: "active", joiningDate: "2023-10-09", phone: "+91 90000 10110", personalEmail: "ishita.banerjee@email.test", address: "Bandra, Mumbai", emergencyName: "Rina Banerjee", emergencyPhone: "+91 90000 20110", dateOfBirth: dob(today, 14, 1994), showBirthday: true, monthlyGross: 108000 }, 13),
    person({ id: "emp_rahul", employeeCode: "BE-0994", firstName: "Rahul", lastName: "Verma", email: "rahul.verma@buildesk.com", role: "employee", demoLogin: false, jobTitle: "Product Designer", departmentId: "dep_design", managerId: "emp_vikram", locationId: "loc_blr", employmentType: "full_time", status: "inactive", joiningDate: "2021-08-16", phone: "+91 90000 10994", personalEmail: "rahul.verma@email.test", address: "Bengaluru", emergencyName: "Anita Verma", emergencyPhone: "+91 90000 20994", dateOfBirth: dob(today, 9, 1993), showBirthday: false, monthlyGross: 0 }, 14),
    person({ id: "emp_shruti", employeeCode: "BE-1111", firstName: "Shruti", lastName: "Jain", email: "shruti@cravingcode.in", role: "hr", demoLogin: false, jobTitle: "HR admin", departmentId: "dep_people", managerId: "emp_meera", locationId: "loc_blr", employmentType: "full_time", status: "active", joiningDate: today, phone: "", personalEmail: "", address: "", emergencyName: "", emergencyPhone: "", dateOfBirth: "", showBirthday: false, monthlyGross: 0 }, 15),
    person({ id: "emp_stuty", employeeCode: "BE-1112", firstName: "Stuty", lastName: "Chauhan", email: "stuty@cravingcode.in", role: "hr", demoLogin: false, jobTitle: "HR admin", departmentId: "dep_people", managerId: "emp_meera", locationId: "loc_blr", employmentType: "full_time", status: "active", joiningDate: today, phone: "", personalEmail: "", address: "", emergencyName: "", emergencyPhone: "", dateOfBirth: "", showBirthday: false, monthlyGross: 0 }, 16),
  ];
  for (const id of ["emp_shruti", "emp_stuty"]) {
    const profile = employees.find((item) => item.id === id);
    if (profile) profile.emergencyRelationship = "";
  }
  const ananya = employees.find((item) => item.id === "emp_ananya");
  if (ananya) {
    ananya.emergencyRelationship = "Parent";
    ananya.emergencySecondaryName = "Arun Rao";
    ananya.emergencySecondaryRelationship = "Sibling";
    ananya.emergencySecondaryPhone = "+91 90000 30042";
  }

  const byId = (id: string) => employees.find((item) => item.id === id)!;
  const shell = {
    settings,
    holidays,
    employees,
    leaveRequests: [] as LeaveRequest[],
    compOff: [] as CompOffGrant[],
  } as AppState;

  const leave = (
    id: string,
    employeeId: string,
    typeId: string,
    start: string,
    end: string,
    status: LeaveRequest["status"],
    reason: string,
    submittedDaysAgo: number,
    review?: { reviewerId: string; comment: string; daysAgo: number },
  ): LeaveRequest => {
    const count = workingDaysFor(byId(employeeId), start, end, shell).length;
    const submittedAt = atHour(addDays(today, -submittedDaysAgo), 9);
    return {
      id,
      employeeId,
      typeId,
      startDate: start,
      endDate: end,
      partial: "none",
      reason,
      attachmentName: "",
      status,
      days: count,
      reviewerId: review?.reviewerId ?? null,
      reviewComment: review?.comment ?? "",
      submittedAt,
      reviewedAt: review ? atHour(addDays(today, -review.daysAgo), 16) : null,
      history: [
        hist(employeeId, "Submitted", reason, submittedAt),
        ...(review ? [hist(review.reviewerId, status === "approved" ? "Approved" : "Rejected", review.comment, atHour(addDays(today, -review.daysAgo), 16))] : []),
      ],
    };
  };

  const leaveRequests: LeaveRequest[] = [
    leave("lv_ananya_used", "emp_ananya", "casual", past[8], past[8], "approved", "Family function in Bengaluru.", 20, { reviewerId: "emp_vikram", comment: "Approved. Enjoy the day.", daysAgo: 18 }),
    leave("lv_omar", "emp_omar", "earned", past[0], future[2], "approved", "Travel planned with family.", 6, { reviewerId: "emp_vikram", comment: "Approved. Coverage is arranged.", daysAgo: 5 }),
    leave("lv_ananya_pending", "emp_ananya", "casual", future[7], future[8], "pending", "Attending a family ceremony.", 1),
    leave("lv_kabir_pending", "emp_kabir", "sick", future[4], future[4], "pending", "Medical appointment in the afternoon.", 1),
    leave("lv_divya_pending", "emp_divya", "unpaid", future[11], future[12], "pending", "Personal travel outside the casual leave balance.", 2),
    leave("lv_ishita_rejected", "emp_ishita", "casual", past[6], past[6], "rejected", "Wanted a day off before a client visit.", 12, { reviewerId: "emp_meera", comment: "Please move this outside the client workshop week.", daysAgo: 11 }),
  ];

  const saturday = previousSaturday(today);
  const compOff: CompOffGrant[] = [
    { id: "coff_ananya", employeeId: "emp_ananya", days: 1, earnedOn: saturday, expiresOn: addDays(saturday, 90), reason: "Weekend release support", status: "available", usedOn: null, leaveRequestId: null },
    { id: "coff_kabir", employeeId: "emp_kabir", days: 1, earnedOn: addDays(saturday, -14), expiresOn: addDays(saturday, 76), reason: "Incident support on a weekly off", status: "available", usedOn: null, leaveRequestId: null },
  ];

  const overrides = new Map<string, Preset>([
    [`emp_ananya|${past[1]}`, "incomplete"],
    [`emp_kabir|${past[2]}`, "late"],
    [`emp_ishita|${past[0]}`, "absent"],
    [`emp_divya|${past[3]}`, "incomplete"],
  ]);

  const approved = leaveRequests.filter((item) => item.status === "approved");
  const prev = previousPeriod(settings);
  const current = currentPeriod(settings);
  const historyDates = eachDate(prev.start, addDays(today, -1));
  const partialState = { ...shell, leaveRequests, attendance: [] } as AppState;
  const attendance: AttendanceRecord[] = [];

  employees.filter((item) => item.status !== "inactive").forEach((employee) => {
    historyDates.forEach((date) => {
      const weekend = settings.weeklyOff.includes(weekday(date));
      const holiday = holidays.some((item) => item.date === date && (item.locationId === "all" || item.locationId === employee.locationId));
      if (weekend || holiday) return;
      if (approved.some((item) => item.employeeId === employee.id && item.startDate <= date && item.endDate >= date)) return;
      const preset = overrides.get(`${employee.id}|${date}`) ?? presetFor(employee.id, date);
      attendance.push(makeRecord(partialState, employee, date, preset));
    });
  });

  let withLeave = attendance;
  approved.forEach((request) => {
    withLeave = projectLeaveAttendance({ ...partialState, attendance: withLeave }, request);
  });

  const events: CompanyEvent[] = [
    { id: "evt_townhall", title: "Monthly town hall", date: future[6], locationId: "all", description: "Product and people updates. Join the 30-minute video call.", kind: "event" },
    { id: "evt_lunch", title: "Bengaluru team lunch", date: future[3], locationId: "loc_blr", description: "Optional team lunch at the HQ cafeteria.", kind: "festival" },
  ];

  const expenses: ExpenseClaim[] = [
    expense("exp_ananya", "emp_ananya", "Travel", 2450, past[1], "Cab and lunch for the client visit in Whitefield.", "cab-receipt.pdf", "pending", null),
    expense("exp_kabir", "emp_kabir", "Travel", 1800, past[2], "Travel for the team offsite.", "offsite-cab.pdf", "approved", "emp_vikram"),
    expense("exp_sana", "emp_sana", "Meals", 640, addDays(prev.start, 8), "Team lunch during a release week.", "", "rejected", "emp_vikram"),
    expense("exp_divya", "emp_divya", "Software", 1499, addDays(prev.start, 4), "Design plugin used for the website refresh.", "plugin-invoice.pdf", "approved", "emp_vikram"),
    expense("exp_arun", "emp_arun", "Office supplies", 860, past[0], "Notebooks and printer paper for the Mumbai office.", "supplies.jpg", "pending", null),
  ];

  const tickets: Ticket[] = [
    ticket("tck_fan", "TCK-2408", "emp_ananya", "Laptop fan is loud on calls", "The fan on my laptop ramps up during video calls and makes it hard for others to hear me.", "IT", "medium", "in_progress", "emp_priya", "", 4, [
      ["emp_ananya", "Opened", "The fan on my laptop ramps up during video calls and makes it hard for others to hear me.", 4],
      ["emp_priya", "Comment", "I've ordered a replacement fan and will update you when it arrives.", 1],
    ]),
    ticket("tck_letter", "TCK-2411", "emp_kabir", "Employment verification letter", "Please share an employment verification letter for a rental agreement.", "HR", "low", "open", "emp_meera", "", 2, [
      ["emp_kabir", "Opened", "Please share an employment verification letter for a rental agreement.", 2],
    ]),
    ticket("tck_payslip", "TCK-2414", "emp_arun", "Question on October reimbursement", "My last payslip lists a reimbursement. I want to confirm which claim it came from.", "Payroll", "medium", "waiting", "emp_rohan", "", 3, [
      ["emp_arun", "Opened", "My last payslip lists a reimbursement. I want to confirm which claim it came from.", 3],
      ["emp_rohan", "Comment", "I'm checking the expense register and will reply with the claim date.", 1],
    ]),
    ticket("tck_ac", "TCK-2390", "emp_leela", "Meeting room AC is uneven", "The AC in the 4th floor meeting room cools only one side of the table.", "Facilities", "low", "resolved", "emp_meera", "", 15, [
      ["emp_leela", "Opened", "The AC in the 4th floor meeting room cools only one side of the table.", 15],
      ["emp_meera", "Comment", "The filter was cleaned and the room was checked on the next working day.", 12],
    ]),
  ];

  const assets: Asset[] = [
    asset("ast_lt_ananya", "BE-LT-102", "MacBook Pro 14", "laptop", "SN-MBP-102", "assigned", "good", "emp_ananya", past[10], true, "emp_meera"),
    asset("ast_ac_ananya", "BE-AC-102", "HQ access card", "access_card", "", "assigned", "good", "emp_ananya", past[12], true, "emp_leela"),
    asset("ast_lt_free", "BE-LT-118", "MacBook Pro 14", "laptop", "SN-MBP-118", "available", "good", null, null, false, "emp_meera"),
    asset("ast_ph_kabir", "BE-PH-014", "Work phone", "phone", "SN-PH-014", "assigned", "good", "emp_kabir", past[14], true, "emp_priya"),
    asset("ast_mon", "BE-MN-009", "Dell 27-inch monitor", "monitor", "SN-MN-009", "repair", "fair", null, null, false, "emp_priya"),
    asset("ast_ac_omar", "BE-AC-077", "HQ access card", "access_card", "", "assigned", "good", "emp_omar", past[16], true, "emp_leela"),
    asset("ast_old", "BE-LT-004", "Retired laptop", "laptop", "SN-OLD-004", "retired", "poor", null, null, false, "emp_priya"),
    asset("ast_lt_sana", "BE-LT-121", "ThinkPad T14", "laptop", "SN-TP-121", "assigned", "good", "emp_sana", past[4], false, "emp_priya"),
  ];

  const insurance: InsuranceRecord[] = [
    {
      id: "ins_ananya",
      employeeId: "emp_ananya",
      plan: "Buildesk Care Plus",
      policyNumber: "BSK-PL-1042",
      coverage: "Hospitalization cover for the employee and enrolled dependents. Demo plan, not a live policy.",
      renewalDate: addDays(today, 140),
      dependents: [{ id: "dep_lata", name: "Lata Rao", relationship: "Parent", dateOfBirth: "1970-04-12" }],
      notes: "Demo record. Policy documents are not stored in this preview.",
    },
    {
      id: "ins_kabir",
      employeeId: "emp_kabir",
      plan: "Buildesk Care Essential",
      policyNumber: "BSK-PL-1048",
      coverage: "Employee-only hospitalization cover. Demo plan, not a live policy.",
      renewalDate: addDays(today, 20),
      dependents: [],
      notes: "Renewal is coming up. HR should confirm the insurer's quote before renewing.",
    },
  ];

  const regularizations: RegularizationRequest[] = [
    regularization(partialState, withLeave, "reg_kabir", "emp_kabir", past[2], "09:25", "18:10", "I was at my desk on time, but the office badge reader did not record my entry.", "badge-reader-note.pdf", 2),
    regularization(partialState, withLeave, "reg_ishita", "emp_ishita", past[0], "09:40", "18:05", "I was at a client meeting in Mumbai and missed both punches.", "", 1),
  ];

  const base: AppState = {
    currentUserId: null,
    accounts: seedLoginAccounts(atHour(today, 9)),
    employees,
    departments,
    locations,
    attendance: withLeave,
    regularizations,
    leaveRequests,
    compOff,
    holidays,
    events,
    expenses,
    insurance,
    tickets,
    assets,
    documents: seedDocuments(today),
    policies: seedPolicies(today),
    acknowledgements: [{ id: "ack_ananya_conduct_1", policyId: "pol_conduct", version: "1.0", employeeId: "emp_ananya", at: atHour(addDays(today, -80), 11) }],
    payrollRuns: [],
    payslips: [],
    notifications: [],
    audits: [],
    settings,
  };

  const prevBuilt = buildPayrollLines(base, prev.start, prev.end);
  const prevWarnings = [...periodWarnings(prev.excluded, settings), ...prevBuilt.warnings.filter((item) => !item.includes("still open"))];
  const prevRun: PayrollRun = {
    id: `pay_${prev.start}`,
    periodStart: prev.start,
    periodEnd: prev.end,
    excludedDates: prev.excluded,
    status: "paid",
    createdAt: atHour(addDays(prev.end, 1), 11),
    createdBy: "emp_rohan",
    updatedAt: atHour(addDays(prev.end, 3), 17),
    finalizedAt: atHour(addDays(prev.end, 2), 15),
    finalizedBy: "emp_rohan",
    paidAt: atHour(addDays(prev.end, 3), 17),
    warnings: prevWarnings,
    lines: prevBuilt.lines,
  };

  const stampedExpenses = base.expenses.map((item) => {
    const include = item.status === "approved" && !item.payrollRunId && item.date >= prev.start && item.date <= prev.end;
    if (!include) return item;
    return {
      ...item,
      status: "paid" as const,
      payrollRunId: prevRun.id,
      history: [...item.history, hist("emp_rohan", "Paid", `Included in the payroll run for ${prev.start} to ${prev.end}.`, prevRun.paidAt || wallNow())],
    };
  });

  const currentBuilt = buildPayrollLines({ ...base, expenses: stampedExpenses }, current.start, current.end);
  const currentRun: PayrollRun = {
    id: `pay_${current.start}`,
    periodStart: current.start,
    periodEnd: current.end,
    excludedDates: current.excluded,
    status: "draft",
    createdAt: atHour(today, 9),
    createdBy: "emp_rohan",
    updatedAt: atHour(today, 9),
    finalizedAt: null,
    finalizedBy: null,
    paidAt: null,
    warnings: [...periodWarnings(current.excluded, settings), ...currentBuilt.warnings],
    lines: currentBuilt.lines,
  };

  const payslips: Payslip[] = prevRun.lines.map((line) => ({
    id: `slip_${prevRun.id}_${line.employeeId}`,
    runId: prevRun.id,
    employeeId: line.employeeId,
    periodStart: prevRun.periodStart,
    periodEnd: prevRun.periodEnd,
    monthlyGross: line.monthlyGross,
    adjustment: line.adjustment,
    adjustmentReason: line.adjustmentReason,
    reimbursement: line.reimbursement,
    payable: line.payable,
    presentDays: line.presentDays,
    leaveDays: line.leaveDays,
    unpaidLeaveDays: line.unpaidLeaveDays,
    absentDays: line.absentDays,
    generatedAt: prevRun.finalizedAt || prevRun.createdAt,
  }));

  const notifications: AppNotification[] = [
    note("emp_ananya", "Laptop ticket updated", "Priya Nair commented on the fan replacement.", "/tickets/tck_fan", "ticket", atHour(addDays(today, -1), 15)),
    note("emp_ananya", `${holidays[0].name} is coming up`, "Check the holiday calendar before you plan leave.", "/leave?tab=holidays", "event", atHour(today, 8)),
    note("emp_ananya", "October payslip is ready", "Your payslip for the previous payroll period is available.", "/payroll", "payroll", prevRun.paidAt || atHour(today, 8), true),
    note("emp_vikram", "Leave waiting for you", "Ananya Rao requested casual leave.", "/leave?tab=approvals", "leave", atHour(addDays(today, -1), 9)),
    note("emp_vikram", "Attendance correction waiting", "Kabir Singh asked to correct a late punch.", "/attendance?tab=corrections", "attendance", atHour(addDays(today, -2), 10)),
    note("emp_vikram", "Expense waiting for you", "Ananya Rao submitted a travel claim.", "/expenses?tab=approvals", "expense", atHour(addDays(today, -2), 11)),
    note("emp_vikram", "Upcoming birthday", "Sana Qureshi's birthday is on the team calendar.", "/people/emp_sana", "birthday", atHour(today, 8)),
    note("emp_meera", "Correction needs HR review", "Ishita Banerjee's missed punches are waiting. Her manager is not a reviewer.", "/attendance?tab=corrections", "attendance", atHour(addDays(today, -1), 10)),
    note("emp_meera", "HR ticket opened", "Kabir Singh asked for an employment verification letter.", "/tickets/tck_letter", "ticket", atHour(addDays(today, -2), 12)),
    note("emp_meera", "Insurance renewal coming up", "Kabir Singh's demo plan renews within 30 days.", "/expenses?tab=insurance", "event", atHour(today, 8)),
    note("emp_rohan", "Payroll draft is ready", "Review inputs for the current period, then send the run for review.", `/payroll/${currentRun.id}`, "payroll", atHour(today, 9)),
    note("emp_rohan", "Payroll ticket is waiting", "Arun Patel asked about a reimbursement line.", "/tickets/tck_payslip", "ticket", atHour(addDays(today, -1), 14)),
    note("emp_priya", "IT ticket in progress", "Ananya Rao is waiting on a laptop fan update.", "/tickets/tck_fan", "ticket", atHour(addDays(today, -1), 15)),
    note("emp_sana", "Acknowledge your laptop", "A ThinkPad was assigned to you and still needs acknowledgement.", "/assets?tab=mine", "asset", atHour(addDays(today, -4), 13)),
  ];

  const audits: AuditEvent[] = [
    { id: "aud_pay", at: prevRun.finalizedAt || prevRun.createdAt, actorId: "emp_rohan", area: "payroll", summary: `Finalized payroll for ${prev.start} to ${prev.end}.`, scope: "payroll" },
    { id: "aud_paid", at: prevRun.paidAt || prevRun.createdAt, actorId: "emp_rohan", area: "payroll", summary: `Marked payroll as paid for ${prev.start} to ${prev.end}.`, scope: "payroll" },
    { id: "aud_leave", at: leaveRequests[0].reviewedAt || leaveRequests[0].submittedAt, actorId: "emp_vikram", area: "leave", summary: "Approved casual leave for Ananya Rao.", scope: "general" },
    { id: "aud_asset", at: atHour(past[4], 13), actorId: "emp_priya", area: "assets", summary: "Assigned ThinkPad T14 to Sana Qureshi.", scope: "general" },
    { id: "aud_ins", at: atHour(addDays(today, -20), 11), actorId: "emp_meera", area: "insurance", summary: "Updated insurance enrollment for Ananya Rao.", scope: "insurance" },
  ];

  return normalizeAttendance({
    ...base,
    expenses: stampedExpenses,
    payrollRuns: [currentRun, prevRun],
    payslips,
    notifications,
    audits,
  });
}

function presetFor(employeeId: string, date: string): Preset {
  if (employeeId === "emp_sana") return "remote";
  const bucket = hash(`${employeeId}|${date}`) % 100;
  if (bucket < 6) return "absent";
  if (bucket < 12) return "late";
  if (bucket < 16) return "incomplete";
  if (bucket < 28) return "remote";
  if (bucket < 34) return "client";
  return "present";
}

function timeAt(base: string, salt: number, span: number): string {
  const [h, m] = base.split(":").map(Number);
  const total = (h || 0) * 60 + (m || 0) + (salt % span);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function makeRecord(state: AppState, employee: Employee, date: string, preset: Preset): AttendanceRecord {
  const salt = hash(`${employee.id}|${date}|t`);
  let clockIn: string | null = null;
  let clockOut: string | null = null;
  let workMode: WorkMode | null = "office";
  if (preset === "present") {
    clockIn = `${date}T${timeAt("09:12", salt, 12)}`;
    clockOut = `${date}T${timeAt("18:02", salt, 18)}`;
  } else if (preset === "late") {
    clockIn = `${date}T${timeAt("09:55", salt, 35)}`;
    clockOut = `${date}T${timeAt("18:12", salt, 15)}`;
  } else if (preset === "remote") {
    clockIn = `${date}T${timeAt("09:08", salt, 15)}`;
    clockOut = `${date}T${timeAt("18:00", salt, 16)}`;
    workMode = "remote";
  } else if (preset === "client") {
    clockIn = `${date}T${timeAt("09:20", salt, 15)}`;
    clockOut = `${date}T${timeAt("18:05", salt, 15)}`;
    workMode = "client";
  } else if (preset === "incomplete") {
    clockIn = `${date}T${timeAt("09:18", salt, 12)}`;
    clockOut = null;
    workMode = employee.locationId === "loc_remote" ? "remote" : "office";
  } else {
    clockIn = null;
    clockOut = null;
    workMode = null;
  }
  const status = preset === "absent" ? "absent" : derivePunchStatus(state, employee, date, clockIn, clockOut);
  return {
    id: `att_${employee.id}_${date}`,
    employeeId: employee.id,
    date,
    clockIn,
    clockOut,
    workMode,
    status: date < todayIso() && clockIn && !clockOut ? "incomplete" : status,
    source: "system",
    note: preset === "incomplete" ? "Clock-out was not recorded." : "",
  };
}

function expense(
  id: string,
  employeeId: string,
  category: string,
  amount: number,
  date: string,
  description: string,
  receiptName: string,
  status: ExpenseClaim["status"],
  reviewerId: string | null,
): ExpenseClaim {
  const submittedAt = atHour(date, 18);
  const history = [hist(employeeId, "Submitted", description, submittedAt)];
  if (status === "approved" && reviewerId) history.push(hist(reviewerId, "Approved", "Approved for reimbursement.", atHour(addDays(date, 1), 11)));
  if (status === "rejected" && reviewerId) history.push(hist(reviewerId, "Rejected", "The receipt does not show the items claimed.", atHour(addDays(date, 1), 11)));
  return { id, employeeId, category, amount, date, description, receiptName, status, payrollRunId: null, submittedAt, history: history.map((item, index) => ({ ...item, id: `${id}_h${index}` })) };
}

function ticket(
  id: string,
  number: string,
  employeeId: string,
  subject: string,
  description: string,
  category: string,
  priority: Ticket["priority"],
  status: Ticket["status"],
  assigneeId: string,
  attachmentName: string,
  daysAgo: number,
  events: Array<[string, string, string, number]>,
): Ticket {
  const createdAt = atHour(addDays(todayIso(), -daysAgo), 10);
  return {
    id,
    number,
    employeeId,
    subject,
    description,
    category,
    priority,
    status,
    assigneeId,
    attachmentName,
    createdAt,
    updatedAt: atHour(addDays(todayIso(), -events[events.length - 1][3]), 16),
    history: events.map(([actorId, action, comment, ago], index) => ({
      id: `${id}_h${index}`,
      at: atHour(addDays(todayIso(), -ago), 10 + index),
      actorId,
      action,
      comment,
    })),
  };
}

function asset(
  id: string,
  tag: string,
  name: string,
  type: Asset["type"],
  serial: string,
  status: Asset["status"],
  condition: Asset["condition"],
  assignedTo: string | null,
  assignedAt: string | null,
  acknowledged: boolean,
  actorId: string,
): Asset {
  const history: HistoryEvent[] = [hist(actorId, "Added to register", `${name} added to the asset register.`, atHour(assignedAt ?? addDays(todayIso(), -30), 10))];
  if (assignedTo && assignedAt) history.push(hist(actorId, "Assigned", `Assigned to employee ${assignedTo}.`, atHour(assignedAt, 12)));
  if (acknowledged && assignedTo) history.push(hist(assignedTo, "Acknowledged", "Receipt acknowledged.", atHour(assignedAt || todayIso(), 15)));
  if (status === "repair") history.push(hist(actorId, "Sent for repair", "Sent for repair and removed from the assignee.", atHour(addDays(todayIso(), -6), 11)));
  if (status === "retired") history.push(hist(actorId, "Retired", "Retired from the register.", atHour(addDays(todayIso(), -40), 11)));
  return {
    id,
    tag,
    name,
    type,
    serial,
    status,
    condition,
    brand: name.split(" ")[0] || "Buildesk",
    model: name,
    locationId: "loc_blr",
    remarks: status === "repair" ? "Waiting on a replacement part." : "",
    assignedTo: status === "assigned" ? assignedTo : null,
    assignedAt: status === "assigned" ? assignedAt : null,
    returnedAt: status === "assigned" ? null : status === "available" ? null : addDays(todayIso(), -6),
    acknowledged: status === "assigned" ? acknowledged : false,
    history: history.map((item, index) => ({ ...item, id: `${id}_h${index}` })),
  };
}

function regularization(
  state: AppState,
  attendance: AttendanceRecord[],
  id: string,
  employeeId: string,
  date: string,
  requestedIn: string,
  requestedOut: string,
  reason: string,
  attachmentName: string,
  daysAgo: number,
): RegularizationRequest {
  const record = attendance.find((item) => item.employeeId === employeeId && item.date === date);
  const submittedAt = atHour(addDays(todayIso(), -daysAgo), 17);
  void state;
  return {
    id,
    employeeId,
    date,
    requestedIn,
    requestedOut,
    reason,
    attachmentName,
    status: "pending",
    originalIn: record?.clockIn ?? null,
    originalOut: record?.clockOut ?? null,
    appliedIn: null,
    appliedOut: null,
    reviewerId: null,
    reviewComment: "",
    reviewedAt: null,
    submittedAt,
    history: [hist(employeeId, "Submitted", reason, submittedAt)],
  };
}

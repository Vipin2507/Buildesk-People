import { defaultAutomationConfig } from "./automationDefaults";
import { DEFAULT_ROLE_PERMISSIONS } from "../lib/access";
import { AVATAR_COLORS } from "../lib/palette";
import type { AppState, Employee, UserAccount } from "../types";

/** Initial login accounts. Each person chooses a password on first sign-in. */
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

function employee(input: Employee): Employee {
  return input;
}

/** Starting workspace for a new installation. No sample people or transactions. */
export function createSeed(): AppState {
  const stamp = "2026-11-07T09:00:00.000Z";
  return {
    currentUserId: null,
    accounts: seedLoginAccounts(stamp),
    employees: [
      employee({
        id: "emp_shruti",
        employeeCode: "BE-1111",
        firstName: "Shruti",
        lastName: "Jain",
        email: "shruti@cravingcode.in",
        role: "hr",
        jobTitle: "HR admin",
        departmentId: "dep_people",
        managerId: null,
        locationId: "loc_blr",
        employmentType: "full_time",
        status: "active",
        joiningDate: "2026-11-07",
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
        avatarColor: AVATAR_COLORS[0],
        photoUpdatedAt: null,
      }),
      employee({
        id: "emp_stuty",
        employeeCode: "BE-1112",
        firstName: "Stuty",
        lastName: "Chauhan",
        email: "stuty@cravingcode.in",
        role: "hr",
        jobTitle: "HR admin",
        departmentId: "dep_people",
        managerId: null,
        locationId: "loc_blr",
        employmentType: "full_time",
        status: "active",
        joiningDate: "2026-11-07",
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
        avatarColor: AVATAR_COLORS[1],
        photoUpdatedAt: null,
      }),
    ],
    departments: [
      { id: "dep_people", name: "People" },
      { id: "dep_eng", name: "Engineering" },
      { id: "dep_design", name: "Design" },
      { id: "dep_fin", name: "Finance" },
      { id: "dep_sales", name: "Sales" },
      { id: "dep_work", name: "Workplace" },
    ],
    locations: [
      { id: "loc_blr", name: "Bengaluru HQ", kind: "office", city: "Bengaluru" },
      { id: "loc_remote", name: "Remote — India", kind: "remote", city: "India" },
    ],
    attendance: [],
    regularizations: [],
    leaveRequests: [],
    compOff: [],
    holidays: [],
    events: [],
    expenses: [],
    insurance: [],
    tickets: [],
    assets: [],
    documents: [],
    policies: [],
    acknowledgements: [],
    payrollRuns: [],
    payslips: [],
    notifications: [],
    audits: [],
    settings: {
      orgName: "Craving Code",
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
      attendanceLocationRequired: false,
      locationRetentionDays: null,
    },
    automation: defaultAutomationConfig(),
  };
}

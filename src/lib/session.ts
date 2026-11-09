import { AVATAR_COLORS } from "./palette";
import type { AppState, Employee, UserAccount } from "../types";

export function sessionAccount(state: AppState): UserAccount | null {
  if (!state.currentUserId) return null;
  return state.accounts.find((item) => item.id === state.currentUserId) ?? null;
}

/** The signed-in account as the shape the rest of the app already reads. Permissions follow the account role. */
export function sessionEmployee(state: AppState): Employee | null {
  const account = sessionAccount(state);
  if (!account || account.status !== "active") return null;
  const linked = account.employeeId ? state.employees.find((item) => item.id === account.employeeId) ?? null : null;
  if (linked) return { ...linked, role: account.role };
  return {
    id: account.id,
    employeeCode: "",
    firstName: account.displayName || account.email,
    lastName: "",
    email: account.email,
    role: account.role,
    jobTitle: "",
    departmentId: account.departmentId ?? "",
    managerId: null,
    locationId: "",
    employmentType: "full_time",
    status: "active",
    joiningDate: "",
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
  };
}

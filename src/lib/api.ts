import { DEFAULT_ROLE_PERMISSIONS } from "./access";
import type { ToastTone } from "../store/mutations";
import type { AppState, Result, UserAccount } from "../types";

/** Empty shell used before a session exists. Workspace records stay on the server. */
export function signedOutState(accounts: UserAccount[]): AppState {
  return {
    currentUserId: null,
    accounts,
    employees: [],
    departments: [],
    locations: [],
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
      leaveTypes: [],
      expenseCategories: [],
      ticketCategories: [],
      rolePermissions: DEFAULT_ROLE_PERMISSIONS,
      attendanceLocationRequired: false,
      locationRetentionDays: null,
    },
  };
}

export interface ActionResponse {
  result?: Result;
  toast?: string;
  tone?: ToastTone;
  state?: AppState | null;
  message?: string;
  ok?: boolean;
  authenticated?: boolean;
  invited?: boolean;
  setup?: boolean;
  accountId?: string;
  accounts?: UserAccount[];
  placeLabel?: string | null;
}

export async function request(path: string, body?: unknown): Promise<{ status: number; payload: ActionResponse }> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "include",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as ActionResponse;
  return { status: response.status, payload };
}

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { request, signedOutState } from "../lib/api";
import { hasPermission } from "../lib/access";
import { sessionEmployee } from "../lib/session";
import type { AppState, Employee, Permission, Result } from "../types";
import * as m from "./mutations";
import type { ToastTone } from "./mutations";

export const STORAGE_KEY = "buildesk-people-demo-v1";

export interface Toast {
  id: string;
  message: string;
  tone: ToastTone;
}

interface StoreValue {
  state: AppState;
  user: Employee | null;
  can: (permission: Permission) => boolean;
  busy: string | null;
  toasts: Toast[];
  dismissToast: (id: string) => void;
  actions: {
    signIn: (email: string, password: string) => Promise<{ ok: true } | { ok: false; message: string; setup?: boolean; invited?: boolean }>;
    createPassword: (email: string, password: string, confirm: string) => Promise<Result>;
    changePassword: (currentPassword: string, password: string, confirm: string) => Promise<Result>;
    signOut: () => Promise<void>;
    resetDemo: () => Promise<void>;
    acceptInvitation: (email: string) => Promise<Result>;
    saveAccount: (input: Parameters<typeof m.saveAccount>[1]) => Promise<Result>;
    resendInvitation: (id: string) => Promise<Result>;
    suspendAccount: (id: string) => Promise<Result>;
    reactivateAccount: (id: string) => Promise<Result>;
    deactivateAccount: (id: string) => Promise<Result>;
    deleteAccount: (id: string) => Promise<Result>;
    clockIn: (mode: Parameters<typeof m.clockIn>[1]) => Promise<Result>;
    clockOut: () => Promise<Result>;
    submitRegularization: (input: Parameters<typeof m.submitRegularization>[1]) => Promise<Result>;
    decideRegularization: (id: string, decision: "approved" | "rejected", comment: string, times?: { requestedIn: string; requestedOut: string }) => Promise<Result>;
    submitLeave: (input: Parameters<typeof m.submitLeave>[1]) => Promise<Result>;
    decideLeave: (id: string, decision: "approved" | "rejected", comment: string) => Promise<Result>;
    grantCompOff: (input: Parameters<typeof m.grantCompOff>[1]) => Promise<Result>;
    saveHoliday: (input: Parameters<typeof m.saveHoliday>[1]) => Promise<Result>;
    deleteHoliday: (id: string) => Promise<Result>;
    saveEvent: (input: Parameters<typeof m.saveEvent>[1]) => Promise<Result>;
    deleteEvent: (id: string) => Promise<Result>;
    submitExpense: (input: Parameters<typeof m.submitExpense>[1]) => Promise<Result>;
    decideExpense: (id: string, decision: "approved" | "rejected", comment: string) => Promise<Result>;
    markExpensePaid: (id: string) => Promise<Result>;
    saveInsurance: (input: Parameters<typeof m.saveInsurance>[1]) => Promise<Result>;
    createTicket: (input: Parameters<typeof m.createTicket>[1]) => Promise<Result>;
    addTicketComment: (id: string, body: string) => Promise<Result>;
    updateTicket: (id: string, patch: Parameters<typeof m.updateTicket>[2]) => Promise<Result>;
    reopenTicket: (id: string) => Promise<Result>;
    saveAsset: (input: Parameters<typeof m.saveAsset>[1]) => Promise<Result>;
    saveDocument: (input: Parameters<typeof m.saveDocument>[1]) => Promise<Result>;
    savePolicy: (input: Parameters<typeof m.savePolicy>[1]) => Promise<Result>;
    publishPolicy: (id: string) => Promise<Result>;
    archivePolicy: (id: string) => Promise<Result>;
    acknowledgePolicy: (id: string) => Promise<Result>;
    assignAsset: (id: string, employeeId: string) => Promise<Result>;
    acknowledgeAsset: (id: string) => Promise<Result>;
    transitionAsset: (id: string, action: "return" | "repair" | "retire" | "transfer", comment: string, transferTo?: string) => Promise<Result>;
    saveEmployee: (draft: m.EmployeeDraft) => Promise<Result>;
    updateCompensation: (id: string, gross: number) => Promise<Result>;
    updateProfile: (draft: m.ProfileDraft) => Promise<Result>;
    createPayrollRun: (year: number, monthIndex: number) => Promise<Result>;
    refreshPayroll: (runId: string) => Promise<Result>;
    updatePayrollLine: (runId: string, employeeId: string, adjustment: number, reason: string) => Promise<Result>;
    advancePayroll: (runId: string, status: "in_review" | "finalized" | "paid") => Promise<Result>;
    markNotification: (id: string) => Promise<void>;
    markAllNotifications: () => Promise<void>;
    updateSettings: (patch: Parameters<typeof m.updateSettings>[1]) => Promise<Result>;
    updateLeaveType: (input: Parameters<typeof m.updateLeaveType>[1]) => Promise<Result>;
    addDepartment: (name: string) => Promise<Result>;
    deleteDepartment: (id: string) => Promise<Result>;
    addLocation: (input: Parameters<typeof m.addLocation>[1]) => Promise<Result>;
    deleteLocation: (id: string) => Promise<Result>;
    addCategory: (kind: "expense" | "ticket", name: string) => Promise<Result>;
    removeCategory: (kind: "expense" | "ticket", name: string) => Promise<Result>;
    setPermission: (role: Parameters<typeof m.setPermission>[1], permission: Permission, enabled: boolean) => Promise<Result>;
    resetPermissions: () => Promise<Result>;
  };
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(() => signedOutState([]));
  const [ready, setReady] = useState(false);
  const [offline, setOffline] = useState("");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const dismissToast = (id: string) => setToasts((current) => current.filter((item) => item.id !== id));

  const pushToast = (message: string, tone: ToastTone = "success") => {
    const id = `toast_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
    setToasts((current) => [...current, { id, message, tone }].slice(-4));
    window.setTimeout(() => dismissToast(id), 4600);
  };

  const adopt = (next: AppState | null | undefined) => {
    if (!next) return;
    stateRef.current = next;
    setState(next);
  };

  useEffect(() => {
    let cancelled = false;
    localStorage.removeItem(STORAGE_KEY);
    request("/api/bootstrap").then(({ status, payload }) => {
      if (cancelled) return;
      if (status !== 200) {
        setOffline(payload.message ?? "The Buildesk People server is not responding.");
        setReady(true);
        return;
      }
      if (payload.authenticated && payload.state) adopt(payload.state);
      else adopt(signedOutState(payload.accounts ?? []));
      setReady(true);
    }).catch(() => {
      if (!cancelled) {
        setOffline("The Buildesk People server is not responding.");
        setReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const run = async (action: string, input?: unknown): Promise<Result> => {
    try {
      const { status, payload } = await request("/api/actions", { action, input: input ?? {} });
      if (payload.toast) pushToast(payload.toast, payload.tone ?? (payload.result?.ok ? "success" : "error"));
      if (status === 401) {
        adopt(signedOutState(stateRef.current.accounts));
        return { ok: false, message: payload.message ?? "Sign in to continue." };
      }
      if (payload.state) adopt(payload.state);
      if (payload.result) return payload.result;
      return { ok: false, message: payload.message ?? "The server could not complete that request." };
    } catch {
      const message = "The Buildesk People server is not responding.";
      pushToast(message, "error");
      return { ok: false, message };
    }
  };

  const user = sessionEmployee(state);

  const actions: StoreValue["actions"] = {
    signIn: async (email, password) => {
      const { payload } = await request("/api/auth/signin", { email, password });
      if (payload.state) {
        adopt(payload.state);
        pushToast(`Signed in as ${payload.state.accounts.find((item) => item.id === payload.state?.currentUserId)?.displayName ?? email}.`, "info");
        return { ok: true };
      }
      return { ok: false, message: payload.message ?? "Sign-in failed.", setup: payload.setup, invited: payload.invited };
    },
    createPassword: async (email, password, confirm) => {
      const { payload } = await request("/api/auth/setup", { email, password, confirm });
      if (payload.state) {
        adopt(payload.state);
        pushToast("Password saved. You are signed in.", "success");
        return { ok: true };
      }
      return { ok: false, message: payload.message ?? "The password could not be saved." };
    },
    changePassword: async (currentPassword, password, confirm) => {
      const { status, payload } = await request("/api/auth/password", { currentPassword, password, confirm });
      if (payload.state) adopt(payload.state);
      if (status === 200 && payload.ok) {
        if (payload.toast) pushToast(payload.toast, "success");
        return { ok: true };
      }
      return { ok: false, message: payload.message ?? "The password could not be changed." };
    },
    signOut: async () => {
      await request("/api/auth/signout", {});
      adopt(signedOutState([]));
      const { payload } = await request("/api/bootstrap");
      if (!payload.authenticated) adopt(signedOutState(payload.accounts ?? []));
    },
    resetDemo: async () => {
      const { payload } = await request("/api/workspace/reset", {});
      if (payload.toast) pushToast(payload.toast, "info");
      if (payload.state) adopt(payload.state);
      else {
        const next = await request("/api/bootstrap");
        adopt(signedOutState(next.payload.accounts ?? []));
      }
    },
    acceptInvitation: async (email) => {
      const { payload } = await request("/api/auth/accept", { email });
      if (payload.state) {
        adopt(payload.state);
        pushToast("Invitation accepted. You are signed in.", "success");
        return { ok: true };
      }
      const message = payload.message ?? "This invitation is no longer pending.";
      pushToast(message, "error");
      return { ok: false, message };
    },
    saveAccount: (input) => run("saveAccount", input),
    resendInvitation: (id) => run("resendInvitation", { id }),
    suspendAccount: (id) => run("suspendAccount", { id }),
    reactivateAccount: (id) => run("reactivateAccount", { id }),
    deactivateAccount: (id) => run("deactivateAccount", { id }),
    deleteAccount: (id) => run("deleteAccount", { id }),
    clockIn: (mode) => run("clockIn", { mode }),
    clockOut: () => run("clockOut"),
    submitRegularization: (input) => run("submitRegularization", input),
    decideRegularization: (id, decision, comment, times) => run("decideRegularization", { id, decision, comment, times }),
    submitLeave: (input) => run("submitLeave", input),
    decideLeave: (id, decision, comment) => run("decideLeave", { id, decision, comment }),
    grantCompOff: (input) => run("grantCompOff", input),
    saveHoliday: (input) => run("saveHoliday", input),
    deleteHoliday: (id) => run("deleteHoliday", { id }),
    saveEvent: (input) => run("saveEvent", input),
    deleteEvent: (id) => run("deleteEvent", { id }),
    submitExpense: (input) => run("submitExpense", input),
    decideExpense: (id, decision, comment) => run("decideExpense", { id, decision, comment }),
    markExpensePaid: (id) => run("markExpensePaid", { id }),
    saveInsurance: (input) => run("saveInsurance", input),
    createTicket: (input) => run("createTicket", input),
    addTicketComment: (id, body) => run("addTicketComment", { id, body }),
    updateTicket: (id, patch) => run("updateTicket", { id, patch }),
    reopenTicket: (id) => run("reopenTicket", { id }),
    saveAsset: (input) => run("saveAsset", input),
    saveDocument: (input) => run("saveDocument", input),
    savePolicy: (input) => run("savePolicy", input),
    publishPolicy: (id) => run("publishPolicy", { id }),
    archivePolicy: (id) => run("archivePolicy", { id }),
    acknowledgePolicy: (id) => run("acknowledgePolicy", { id }),
    assignAsset: (id, employeeId) => run("assignAsset", { id, employeeId }),
    acknowledgeAsset: (id) => run("acknowledgeAsset", { id }),
    transitionAsset: (id, action, comment, transferTo) => run("transitionAsset", { id, action, comment, transferTo }),
    saveEmployee: (draft) => run("saveEmployee", draft),
    updateCompensation: (id, gross) => run("updateCompensation", { id, gross }),
    updateProfile: (draft) => run("updateProfile", draft),
    createPayrollRun: (year, monthIndex) => run("createPayrollRun", { year, monthIndex }),
    refreshPayroll: async (runId) => {
      setBusy("payroll");
      const result = await run("refreshPayrollRun", { runId });
      setBusy(null);
      return result;
    },
    updatePayrollLine: (runId, employeeId, adjustment, reason) => run("updatePayrollLine", { runId, employeeId, adjustment, reason }),
    advancePayroll: (runId, status) => run("advancePayroll", { runId, status }),
    markNotification: async (id) => { await run("markNotification", { id }); },
    markAllNotifications: async () => { await run("markAllNotifications"); },
    updateSettings: (patch) => run("updateSettings", patch),
    updateLeaveType: (input) => run("updateLeaveType", input),
    addDepartment: (name) => run("addDepartment", { name }),
    deleteDepartment: (id) => run("deleteDepartment", { id }),
    addLocation: (input) => run("addLocation", input),
    deleteLocation: (id) => run("deleteLocation", { id }),
    addCategory: (kind, name) => run("addCategory", { kind, name }),
    removeCategory: (kind, name) => run("removeCategory", { kind, name }),
    setPermission: (role, permission, enabled) => run("setPermission", { role, permission, enabled }),
    resetPermissions: () => run("resetPermissions"),
  };

  const value: StoreValue = {
    state,
    user,
    can: (permission) => hasPermission(state, user, permission),
    busy,
    toasts,
    dismissToast,
    actions,
  };

  if (!ready) {
    return <main className="signin-main"><h1>Loading Buildesk People…</h1><p>Connecting to the workspace server.</p></main>;
  }
  if (offline) {
    return <main className="signin-main"><h1>Server unavailable</h1><p>{offline}</p><p>Start the API and the app together with <code>npm run dev</code>.</p></main>;
  }
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useApp(): StoreValue {
  const value = useContext(StoreContext);
  if (!value) throw new Error("useApp must be used inside StoreProvider");
  return value;
}

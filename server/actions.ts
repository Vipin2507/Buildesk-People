import type { Outcome } from "../src/store/mutations.ts";
import * as m from "../src/store/mutations.ts";
import type { AppState } from "../src/types.ts";
import { deletePhoto } from "./photos.ts";

function noted(state: AppState, toast?: string): Outcome {
  return { state, result: { ok: true }, toast };
}

function rejected(state: AppState, message: string): Outcome {
  return { state, result: { ok: false, message }, toast: message, tone: "error" };
}

type Handler = (state: AppState, body: Record<string, any>) => Outcome;

export const actions: Record<string, Handler> = {
  clockIn: (state, body) => m.clockIn(state, body.mode, body.location),
  clockOut: (state, body) => m.clockOut(state, body.location),
  submitRegularization: (state, body) => m.submitRegularization(state, body),
  decideRegularization: (state, body) => m.decideRegularization(state, body.id, body.decision, body.comment, body.times),
  submitLeave: (state, body) => m.submitLeave(state, body),
  decideLeave: (state, body) => m.decideLeave(state, body.id, body.decision, body.comment),
  grantCompOff: (state, body) => m.grantCompOff(state, body),
  saveHoliday: (state, body) => m.saveHoliday(state, body),
  deleteHoliday: (state, body) => m.deleteHoliday(state, body.id),
  saveEvent: (state, body) => m.saveEvent(state, body),
  deleteEvent: (state, body) => m.deleteEvent(state, body.id),
  submitExpense: (state, body) => m.submitExpense(state, body),
  decideExpense: (state, body) => m.decideExpense(state, body.id, body.decision, body.comment),
  markExpensePaid: (state, body) => m.markExpensePaid(state, body.id),
  saveInsurance: (state, body) => m.saveInsurance(state, body),
  createTicket: (state, body) => m.createTicket(state, body),
  addTicketComment: (state, body) => m.addTicketComment(state, body.id, body.body),
  updateTicket: (state, body) => m.updateTicket(state, body.id, body.patch),
  reopenTicket: (state, body) => m.reopenTicket(state, body.id),
  saveAsset: (state, body) => m.saveAsset(state, body),
  assignAsset: (state, body) => m.assignAsset(state, body.id, body.employeeId),
  acknowledgeAsset: (state, body) => m.acknowledgeAsset(state, body.id),
  transitionAsset: (state, body) => m.transitionAsset(state, body.id, body.action, body.comment, body.transferTo),
  saveEmployee: (state, body) => m.saveEmployee(state, body),
  deleteEmployee: (state, body) => {
    const outcome = m.deleteEmployee(state, body.id);
    if (outcome.result.ok && typeof body.id === "string") deletePhoto(body.id);
    return outcome;
  },
  updateCompensation: (state, body) => m.updateCompensation(state, body.id, body.gross),
  updateProfile: (state, body) => m.updateProfile(state, body),
  createPayrollRun: (state, body) => m.createPayrollRun(state, body.year, body.monthIndex),
  refreshPayrollRun: (state, body) => m.refreshPayrollRun(state, body.runId),
  updatePayrollLine: (state, body) => m.updatePayrollLine(state, body.runId, body.employeeId, body.adjustment, body.reason),
  advancePayroll: (state, body) => m.advancePayroll(state, body.runId, body.status),
  saveDocument: (state, body) => m.saveDocument(state, body),
  savePolicy: (state, body) => m.savePolicy(state, body),
  publishPolicy: (state, body) => m.publishPolicy(state, body.id),
  archivePolicy: (state, body) => m.archivePolicy(state, body.id),
  acknowledgePolicy: (state, body) => m.acknowledgePolicy(state, body.id),
  updateSettings: (state, body) => m.updateSettings(state, body),
  updateLeaveType: (state, body) => m.updateLeaveType(state, body),
  addDepartment: (state, body) => m.addDepartment(state, body.name),
  deleteDepartment: (state, body) => m.deleteDepartment(state, body.id),
  addLocation: (state, body) => m.addLocation(state, body),
  deleteLocation: (state, body) => m.deleteLocation(state, body.id),
  addCategory: (state, body) => m.addCategory(state, body.kind, body.name),
  removeCategory: (state, body) => m.removeCategory(state, body.kind, body.name),
  setPermission: (state, body) => m.setPermission(state, body.role, body.permission, body.enabled),
  resetPermissions: (state) => m.resetPermissions(state),
  saveAccount: (state, body) => m.saveAccount(state, body),
  resendInvitation: (state, body) => m.resendInvitation(state, body.id),
  suspendAccount: (state, body) => m.suspendAccount(state, body.id),
  reactivateAccount: (state, body) => m.reactivateAccount(state, body.id),
  deactivateAccount: (state, body) => m.deactivateAccount(state, body.id),
  deleteAccount: (state, body) => m.deleteAccount(state, body.id),
  markNotification: (state, body) => noted(m.markNotification(state, body.id)),
  markAllNotifications: (state) => {
    if (!state.currentUserId) return rejected(state, "Sign in to continue.");
    return noted(m.markAllNotifications(state, state.currentUserId));
  },
};

import type { AppState } from "../src/types.ts";
import { queueHrMeetingSync } from "./hr-meeting-sync.ts";

const SYNC_ACTIONS = new Set([
  "approveHrMeeting",
  "rescheduleHrMeeting",
  "cancelHrMeeting",
  "retryHrMeetingSync",
]);

/** After HR decisions that need Graph calendar work, queue an idempotent sync job. */
export function afterActionHrMeetingSync(action: string, after: AppState, input: Record<string, unknown>): void {
  if (!SYNC_ACTIONS.has(action)) return;
  const id = typeof input.id === "string" ? input.id : typeof input.resultId === "string" ? input.resultId : "";
  if (!id) return;
  const ticket = after.tickets.find((item) => item.id === id);
  if (!ticket?.meeting?.pendingSyncAction) return;
  queueHrMeetingSync(id);
}

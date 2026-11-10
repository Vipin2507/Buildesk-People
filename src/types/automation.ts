/** WhatsApp + email automation for Buildesk People (rule-driven, channel-routed). */

export type AutomationChannel = "email" | "whatsapp";
export type AutomationProvider = "n8n-webhook" | "waha";
export type AutomationLogStatus = "success" | "failed" | "retrying";

/** HR-domain triggers. CRM booking/win-back triggers are intentionally omitted. */
export type AutomationTrigger =
  | "leave-submitted"
  | "leave-approved"
  | "leave-rejected"
  | "attendance-correction-submitted"
  | "attendance-correction-decided"
  | "expense-submitted"
  | "expense-approved"
  | "expense-rejected"
  | "expense-paid"
  | "ticket-created"
  | "ticket-updated"
  | "ticket-closed"
  | "ticket-reply-from-team"
  | "payroll-approved"
  | "payroll-paid"
  | "payslip-ready"
  | "policy-published"
  | "asset-assigned"
  | "whatsapp-broadcast"
  | "manual-test";

export type AutomationSettings = {
  n8nWebhookBase: string;
  automationsEnabled: boolean;
  emailCc?: string;
  emailFromAddress?: string;
  emailFromName?: string;
};

export type WahaHealthCheck = {
  status: "ok" | "error" | "unknown";
  checkedAt: string;
  latencyMs?: number;
  message?: string;
};

export type WahaConfig = {
  apiUrl: string;
  apiKey: string;
  sessionName: string;
  isEnabled: boolean;
  lastHealthCheck?: WahaHealthCheck;
};

export type AutomationEndpoint = {
  id: string;
  channel: AutomationChannel;
  label: string;
  provider: AutomationProvider;
  /** Path segment or full webhook URL for email / health. */
  webhookUrl: string;
  isEnabled: boolean;
};

export type AutomationRule = {
  id: string;
  name: string;
  description?: string;
  trigger: AutomationTrigger;
  channel: AutomationChannel;
  isActive: boolean;
  templateSubject?: string;
  templateBody: string;
  emailCc?: string;
  /** Optional delay before send for scheduled-style rules (minutes). */
  offsetMinutes?: number;
  createdAt: string;
  updatedAt: string;
};

export type AutomationLog = {
  id: string;
  channel: AutomationChannel;
  trigger: AutomationTrigger;
  status: AutomationLogStatus;
  requestPayload: Record<string, unknown>;
  responseSummary?: string;
  errorMessage?: string;
  attemptedAt: string;
  retryCount: number;
  ruleId?: string;
  employeeId?: string;
  ticketId?: string;
};

export type AutomationConfig = {
  settings: AutomationSettings;
  endpoints: AutomationEndpoint[];
  waha: WahaConfig;
  rules: AutomationRule[];
  logs: AutomationLog[];
  updatedAt: string;
};

export const AUTOMATION_LOG_CAP = 500;
export const WAHA_SEND_PAUSE_MS = 400;
export const BROADCAST_MAX_RECIPIENTS = 50;
export const MEDIA_MAX_BYTES = 25 * 1024 * 1024;

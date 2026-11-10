import { defaultAutomationConfig } from "../data/automationDefaults";
import type {
  AutomationConfig,
  AutomationLog,
  AutomationRule,
  AutomationTrigger,
  WahaConfig,
} from "../types/automation";
import { AUTOMATION_LOG_CAP } from "../types/automation";
import type { AppState } from "../types";

export const TRIGGER_LABELS: Record<AutomationTrigger, string> = {
  "leave-submitted": "Leave submitted",
  "leave-approved": "Leave approved",
  "leave-rejected": "Leave rejected",
  "attendance-correction-submitted": "Attendance correction submitted",
  "attendance-correction-decided": "Attendance correction decided",
  "expense-submitted": "Expense submitted",
  "expense-approved": "Expense approved",
  "expense-rejected": "Expense rejected",
  "expense-paid": "Expense reimbursed",
  "ticket-created": "Ticket created",
  "ticket-updated": "Ticket updated",
  "ticket-closed": "Ticket closed",
  "ticket-reply-from-team": "Ticket reply from team",
  "payroll-approved": "Payroll approved",
  "payroll-paid": "Payroll paid",
  "payslip-ready": "Payslip ready",
  "policy-published": "Policy published",
  "asset-assigned": "Asset assigned",
  "whatsapp-broadcast": "WhatsApp broadcast",
  "manual-test": "Manual test",
};

export const TEMPLATE_VARIABLE_HELP = [
  "{{employeeName}}",
  "{{managerName}}",
  "{{companyName}}",
  "{{startDate}}",
  "{{endDate}}",
  "{{leaveType}}",
  "{{comment}}",
  "{{ticketNumber}}",
  "{{subject}}",
  "{{priority}}",
  "{{ticketUrl}}",
  "{{replyPreview}}",
  "{{amount}}",
  "{{category}}",
  "{{periodLabel}}",
  "{{netPayable}}",
  "{{policyTitle}}",
  "{{assetName}}",
  "{{mobile}}",
];

export function renderAutomationTemplate(template: string, vars: Record<string, string | undefined>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key]?.trim() ?? "");
}

/** Normalize Indian mobiles toward WAHA chat ids when possible. */
export function normalizeIndiaPhone(phone: string | undefined | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D+/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  if (digits.length >= 10 && digits.length <= 15) return digits;
  return null;
}

export function phoneToWahaChatId(phone: string | undefined | null): string | null {
  const normalized = normalizeIndiaPhone(phone);
  if (!normalized) return null;
  if (normalized.includes("@")) return normalized;
  return `${normalized}@c.us`;
}

export function buildN8nWebhookUrl(base: string, segment: string): string {
  const trimmedBase = base.replace(/\/+$/, "");
  const path = segment.replace(/^\/+/, "");
  if (/^https?:\/\//i.test(path)) return path;
  if (!trimmedBase) return path;
  if (trimmedBase.endsWith("/webhook")) return `${trimmedBase}/${path}`;
  return `${trimmedBase}/webhook/${path}`;
}

export function matchingRules(config: AutomationConfig, trigger: AutomationTrigger): AutomationRule[] {
  if (!config.settings.automationsEnabled && trigger !== "whatsapp-broadcast" && trigger !== "manual-test") {
    return [];
  }
  return config.rules.filter((rule) => rule.isActive && rule.trigger === trigger);
}

export function appendAutomationLog(config: AutomationConfig, entry: AutomationLog): AutomationConfig {
  const logs = [entry, ...config.logs].slice(0, AUTOMATION_LOG_CAP);
  return { ...config, logs, updatedAt: new Date().toISOString() };
}

export function sanitizeLogPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...payload };
  if (typeof next.apiKey === "string") next.apiKey = "[redacted]";
  if (typeof next.messageBody === "string" && next.messageBody.length > 280) {
    next.messageBody = `${String(next.messageBody).slice(0, 280)}…`;
  }
  if (typeof next.text === "string" && next.text.length > 280) {
    next.text = `${String(next.text).slice(0, 280)}…`;
  }
  return next;
}

export function normalizeAutomationConfig(raw: AutomationConfig | undefined | null): AutomationConfig {
  const defaults = defaultAutomationConfig();
  if (!raw || typeof raw !== "object") return defaults;
  return {
    settings: {
      ...defaults.settings,
      ...raw.settings,
      n8nWebhookBase: raw.settings?.n8nWebhookBase ?? "",
      automationsEnabled: Boolean(raw.settings?.automationsEnabled),
    },
    endpoints: Array.isArray(raw.endpoints) && raw.endpoints.length > 0 ? raw.endpoints : defaults.endpoints,
    waha: {
      ...defaults.waha,
      ...raw.waha,
      apiKey: raw.waha?.apiKey ?? "",
      isEnabled: Boolean(raw.waha?.isEnabled),
    },
    rules: Array.isArray(raw.rules) && raw.rules.length > 0 ? raw.rules : defaults.rules,
    logs: Array.isArray(raw.logs) ? raw.logs.slice(0, AUTOMATION_LOG_CAP) : [],
    updatedAt: raw.updatedAt ?? defaults.updatedAt,
  };
}

export function ensureAutomation(state: AppState): AppState {
  return { ...state, automation: normalizeAutomationConfig(state.automation) };
}

export function wahaReady(waha: WahaConfig): boolean {
  return Boolean(waha.isEnabled && waha.apiUrl.trim() && waha.sessionName.trim());
}

export function emailEndpointReady(config: AutomationConfig): boolean {
  if (!config.settings.n8nWebhookBase.trim()) return false;
  return config.endpoints.some((item) => item.channel === "email" && item.provider === "n8n-webhook" && item.isEnabled);
}

/** Preview helper: WhatsApp markers → simple HTML for UI only. */
export function markersToPreviewHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .replace(/\*(.+?)\*/g, "<strong>$1</strong>")
    .replace(/_(.+?)_/g, "<em>$1</em>")
    .replace(/\n/g, "<br />");
}

export function wrapSelection(value: string, start: number, end: number, marker: "*" | "_"): { next: string; selectionStart: number; selectionEnd: number } {
  const selected = value.slice(start, end) || "text";
  const wrapped = `${marker}${selected}${marker}`;
  const next = `${value.slice(0, start)}${wrapped}${value.slice(end)}`;
  return { next, selectionStart: start + 1, selectionEnd: start + 1 + selected.length };
}

import {
  appendAutomationLog,
  buildN8nWebhookUrl,
  emailEndpointReady,
  matchingRules,
  normalizeAutomationConfig,
  phoneToWahaChatId,
  renderAutomationTemplate,
  sanitizeLogPayload,
  wahaReady,
} from "../src/domain/automation.ts";
import { nowIso, uid } from "../src/domain/dates.ts";
import type { AppState } from "../src/types.ts";
import type {
  AutomationConfig,
  AutomationLog,
  AutomationTrigger,
  WahaConfig,
} from "../src/types/automation.ts";
import { WAHA_SEND_PAUSE_MS } from "../src/types/automation.ts";
import { writeWorkspace } from "./db.ts";

export type DispatchTarget = {
  email?: string | null;
  phone?: string | null;
  employeeId?: string;
  ticketId?: string;
};

export type DispatchInput = {
  trigger: AutomationTrigger;
  vars: Record<string, string | undefined>;
  to: DispatchTarget;
  /** When true, ignore global kill switch (manual tests / broadcasts). */
  bypassGlobalSwitch?: boolean;
};

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sendWahaText(waha: WahaConfig, chatId: string, text: string): Promise<{ ok: boolean; status: number; text: string }> {
  const base = waha.apiUrl.replace(/\/+$/, "");
  const res = await fetch(`${base}/api/sendText`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Api-Key": waha.apiKey,
    },
    body: JSON.stringify({
      session: waha.sessionName,
      chatId,
      text,
    }),
  });
  const textBody = await res.text();
  return { ok: res.ok, status: res.status, text: textBody };
}

export async function checkWahaSession(waha: WahaConfig): Promise<{ ok: boolean; latencyMs: number; message: string }> {
  const started = Date.now();
  try {
    const base = waha.apiUrl.replace(/\/+$/, "");
    const res = await fetch(`${base}/api/sessions/${encodeURIComponent(waha.sessionName)}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-Api-Key": waha.apiKey,
      },
    });
    const body = await res.text();
    const latencyMs = Date.now() - started;
    if (!res.ok) return { ok: false, latencyMs, message: `WAHA HTTP ${res.status}: ${body.slice(0, 180)}` };
    return { ok: true, latencyMs, message: body.slice(0, 180) || "Session reachable." };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - started, message: error instanceof Error ? error.message : "WAHA unreachable." };
  }
}

export async function postN8nWebhook(url: string, payload: Record<string, unknown>): Promise<{ ok: boolean; status: number; text: string }> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      ...payload,
      delayHours: 0,
      waitAmount: 0,
    }),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

export async function checkN8nHealth(config: AutomationConfig): Promise<{ ok: boolean; message: string }> {
  const health = config.endpoints.find((item) => item.webhookUrl.includes("health")) ?? config.endpoints.find((item) => item.channel === "email");
  if (!config.settings.n8nWebhookBase.trim() || !health) {
    return { ok: false, message: "Configure n8n webhook base and an email endpoint first." };
  }
  const url = buildN8nWebhookUrl(config.settings.n8nWebhookBase, health.webhookUrl);
  try {
    const res = await fetch(url, { method: "GET" });
    if (res.ok) return { ok: true, message: `n8n health responded HTTP ${res.status}.` };
    const posted = await postN8nWebhook(url, { ping: true, source: "buildesk-people" });
    return {
      ok: posted.ok,
      message: posted.ok ? `n8n webhook accepted ping (HTTP ${posted.status}).` : `n8n HTTP ${posted.status}: ${posted.text.slice(0, 180)}`,
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "n8n unreachable." };
  }
}

function persistAutomation(state: AppState, automation: AutomationConfig): AppState {
  const next = { ...state, automation: { ...automation, updatedAt: nowIso() }, currentUserId: null };
  writeWorkspace(next);
  return next;
}

export async function dispatchAutomation(state: AppState, input: DispatchInput): Promise<AppState> {
  let config = normalizeAutomationConfig(state.automation);
  if (!input.bypassGlobalSwitch && !config.settings.automationsEnabled) return state;

  const rules = input.bypassGlobalSwitch
    ? config.rules.filter((rule) => rule.isActive && rule.trigger === input.trigger)
    : matchingRules(config, input.trigger);

  if (rules.length === 0) return state;

  for (const rule of rules) {
    const subject = rule.templateSubject ? renderAutomationTemplate(rule.templateSubject, input.vars) : undefined;
    const body = renderAutomationTemplate(rule.templateBody, input.vars);

    if (rule.channel === "whatsapp") {
      if (!wahaReady(config.waha)) {
        config = appendAutomationLog(config, failLog(rule, input, "WhatsApp channel is not enabled or WAHA is incomplete."));
        continue;
      }
      const chatId = phoneToWahaChatId(input.to.phone);
      if (!chatId) {
        config = appendAutomationLog(config, failLog(rule, input, "Invalid mobile for WhatsApp."));
        continue;
      }
      const payload = sanitizeLogPayload({ chatId, text: body, session: config.waha.sessionName, ruleId: rule.id });
      try {
        const result = await sendWahaText(config.waha, chatId, body);
        config = appendAutomationLog(config, {
          id: uid("alog"),
          channel: "whatsapp",
          trigger: input.trigger,
          status: result.ok ? "success" : "failed",
          requestPayload: payload,
          responseSummary: `HTTP ${result.status}`,
          errorMessage: result.ok ? undefined : result.text.slice(0, 280),
          attemptedAt: nowIso(),
          retryCount: 0,
          ruleId: rule.id,
          employeeId: input.to.employeeId,
          ticketId: input.to.ticketId,
        });
      } catch (error) {
        config = appendAutomationLog(config, failLog(rule, input, error instanceof Error ? error.message : "WhatsApp send failed.", payload));
      }
      await pause(WAHA_SEND_PAUSE_MS);
      continue;
    }

    if (!emailEndpointReady(config)) {
      config = appendAutomationLog(config, failLog(rule, input, "Email channel is not enabled or n8n base URL is missing."));
      continue;
    }
    const recipient = input.to.email?.trim();
    if (!recipient) {
      config = appendAutomationLog(config, failLog(rule, input, "Recipient email is missing."));
      continue;
    }
    const emailEp = config.endpoints.find((item) => item.channel === "email" && item.isEnabled && item.provider === "n8n-webhook" && !item.webhookUrl.includes("health"));
    if (!emailEp) {
      config = appendAutomationLog(config, failLog(rule, input, "No enabled email endpoint."));
      continue;
    }
    const url = buildN8nWebhookUrl(config.settings.n8nWebhookBase, emailEp.webhookUrl);
    const payload = sanitizeLogPayload({
      recipientEmail: recipient,
      emailSubject: subject ?? rule.name,
      messageBody: body,
      emailCc: [config.settings.emailCc, rule.emailCc].filter(Boolean).join(", "),
      emailFromAddress: config.settings.emailFromAddress,
      emailFromName: config.settings.emailFromName,
      trigger: input.trigger,
      ruleId: rule.id,
      ...input.vars,
    });
    try {
      const result = await postN8nWebhook(url, payload);
      config = appendAutomationLog(config, {
        id: uid("alog"),
        channel: "email",
        trigger: input.trigger,
        status: result.ok ? "success" : "failed",
        requestPayload: payload,
        responseSummary: `HTTP ${result.status}`,
        errorMessage: result.ok ? undefined : result.text.slice(0, 280),
        attemptedAt: nowIso(),
        retryCount: 0,
        ruleId: rule.id,
        employeeId: input.to.employeeId,
        ticketId: input.to.ticketId,
      });
    } catch (error) {
      config = appendAutomationLog(config, failLog(rule, input, error instanceof Error ? error.message : "Email webhook failed.", payload));
    }
  }

  return persistAutomation(state, config);
}

function failLog(
  rule: { id: string; channel: AutomationLog["channel"] },
  input: DispatchInput,
  message: string,
  payload: Record<string, unknown> = {},
): AutomationLog {
  return {
    id: uid("alog"),
    channel: rule.channel,
    trigger: input.trigger,
    status: "failed",
    requestPayload: sanitizeLogPayload(payload),
    errorMessage: message,
    attemptedAt: nowIso(),
    retryCount: 0,
    ruleId: rule.id,
    employeeId: input.to.employeeId,
    ticketId: input.to.ticketId,
  };
}

/** Fire-and-forget after a successful mutation. Reloads workspace so logs do not wipe concurrent edits. */
export function queueAutomation(trigger: AutomationTrigger, vars: Record<string, string | undefined>, to: DispatchTarget, bypass = false): void {
  void (async () => {
    try {
      const { readWorkspace } = await import("./db.ts");
      const latest = readWorkspace();
      await dispatchAutomation(latest, { trigger, vars, to, bypassGlobalSwitch: bypass });
    } catch {
      // Automation failures are recorded in logs when possible; never block the primary action.
    }
  })();
}

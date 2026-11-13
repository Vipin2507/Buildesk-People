import type { AutomationConfig, AutomationRule } from "../types/automation";

const stamp = "1970-01-01T00:00:00.000Z";

function rule(
  id: string,
  name: string,
  trigger: AutomationRule["trigger"],
  channel: AutomationRule["channel"],
  templateBody: string,
  templateSubject?: string,
  description?: string,
): AutomationRule {
  return {
    id,
    name,
    description,
    trigger,
    channel,
    isActive: false,
    templateSubject,
    templateBody,
    createdAt: stamp,
    updatedAt: stamp,
  };
}

/** Seed rules are inactive until channels are configured and an admin enables them. */
export function defaultAutomationConfig(): AutomationConfig {
  return {
    settings: {
      n8nWebhookBase: "",
      automationsEnabled: false,
      emailCc: "",
      emailFromAddress: "",
      emailFromName: "Buildesk People",
    },
    endpoints: [
      {
        id: "ep_email_people",
        channel: "email",
        label: "People email (n8n)",
        provider: "n8n-webhook",
        webhookUrl: "buildesk-people",
        isEnabled: false,
      },
      {
        id: "ep_email_health",
        channel: "email",
        label: "n8n health",
        provider: "n8n-webhook",
        webhookUrl: "buildesk-health",
        isEnabled: false,
      },
    ],
    waha: {
      apiUrl: "http://127.0.0.1:3000",
      apiKey: "",
      sessionName: "default",
      isEnabled: false,
    },
    rules: [
      rule(
        "rule_leave_submitted_email",
        "Leave submitted → manager email",
        "leave-submitted",
        "email",
        "Hi {{managerName}},\n\n{{employeeName}} submitted leave from {{startDate}} to {{endDate}} ({{leaveType}}).\n\nOpen Buildesk People to review.",
        "Leave request from {{employeeName}}",
        "Email the manager when someone submits leave.",
      ),
      rule(
        "rule_leave_decided_wa",
        "Leave decided → employee WhatsApp",
        "leave-approved",
        "whatsapp",
        "Hi {{employeeName}}, your leave from {{startDate}} to {{endDate}} was *approved*.",
        undefined,
        "WhatsApp the employee when leave is approved. Add a separate rule for leave-rejected if needed.",
      ),
      rule(
        "rule_leave_rejected_wa",
        "Leave rejected → employee WhatsApp",
        "leave-rejected",
        "whatsapp",
        "Hi {{employeeName}}, your leave from {{startDate}} to {{endDate}} was *not approved*. {{comment}}",
      ),
      rule(
        "rule_ticket_created_email",
        "Ticket created → assignee email",
        "ticket-created",
        "email",
        "A new ticket {{ticketNumber}} was opened by {{employeeName}}.\n\nSubject: {{subject}}\nPriority: {{priority}}\n\n{{ticketUrl}}",
        "New ticket {{ticketNumber}}",
      ),
      rule(
        "rule_ticket_reply_wa",
        "Team reply → requester WhatsApp",
        "ticket-reply-from-team",
        "whatsapp",
        "Update on ticket {{ticketNumber}}: {{subject}}\n\n{{replyPreview}}",
      ),
      rule(
        "rule_expense_approved_email",
        "Expense approved → employee email",
        "expense-approved",
        "email",
        "Hi {{employeeName}}, your expense claim for {{amount}} ({{category}}) was approved.",
        "Expense approved",
      ),
      rule(
        "rule_payroll_paid_wa",
        "Payroll paid → employee WhatsApp",
        "payroll-paid",
        "whatsapp",
        "Hi {{employeeName}}, payroll for {{periodLabel}} has been marked paid. Your payslip is available in Buildesk People.",
      ),
      rule(
        "rule_payslip_ready_email",
        "Payslip ready → employee email",
        "payslip-ready",
        "email",
        "Hi {{employeeName}}, your payslip for {{periodLabel}} is ready in Buildesk People.\n\nNet payable: {{netPayable}}",
        "Payslip ready · {{periodLabel}}",
      ),
      rule(
        "rule_policy_published_email",
        "Policy published → company email digests",
        "policy-published",
        "email",
        "A new policy was published: *{{policyTitle}}*. Please open Buildesk People to read and acknowledge it.",
        "New policy: {{policyTitle}}",
      ),
      rule(
        "rule_asset_assigned_wa",
        "Asset assigned → employee WhatsApp",
        "asset-assigned",
        "whatsapp",
        "Hi {{employeeName}}, {{assetName}} was assigned to you. Please acknowledge it in Buildesk People.",
      ),
      {
        ...rule(
          "rule_attendance_login_reminder_wa",
          "Login reminder → team WhatsApp",
          "attendance-login-reminder",
          "whatsapp",
          "Hi {{employeeName}}, reminder from {{companyName}}: please clock in by {{workStart}}. This note was sent at {{reminderTime}} (15 minutes before login).",
          undefined,
          "Sends to active team members 15 minutes before the configured workday start. Skips weekly offs, holidays, and anyone already clocked in.",
        ),
        offsetMinutes: 15,
        isActive: true,
      },
      {
        ...rule(
          "rule_attendance_logout_reminder_wa",
          "Logout reminder → team WhatsApp",
          "attendance-logout-reminder",
          "whatsapp",
          "Hi {{employeeName}}, reminder from {{companyName}}: please clock out around {{workEnd}}. This note was sent at {{reminderTime}} (15 minutes before logout).",
          undefined,
          "Sends to active team members 15 minutes before the configured workday end. Skips weekly offs, holidays, and anyone already clocked out.",
        ),
        offsetMinutes: 15,
        isActive: true,
      },
    ],
    logs: [],
    updatedAt: stamp,
  };
}

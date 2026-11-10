import { formatMoney, fullName, rangeLabel } from "../src/lib/format.ts";
import type { AppState } from "../src/types.ts";
import { queueAutomation } from "./automation.ts";

/** After a successful domain mutation, enqueue matching WhatsApp/email rules. */
export function afterActionAutomation(action: string, before: AppState, after: AppState, input: Record<string, unknown>): void {
  const companyName = after.settings.orgName;

  if (action === "submitLeave") {
    const leave = [...after.leaveRequests].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)).find((item) => item.status === "pending");
    if (!leave) return;
    const employee = after.employees.find((item) => item.id === leave.employeeId);
    const manager = employee?.managerId ? after.employees.find((item) => item.id === employee.managerId) : undefined;
    const leaveType = after.settings.leaveTypes.find((item) => item.id === leave.typeId)?.name ?? "Leave";
    queueAutomation(
      "leave-submitted",
      {
        employeeName: employee ? fullName(employee) : "",
        managerName: manager ? fullName(manager) : "Manager",
        companyName,
        startDate: leave.startDate,
        endDate: leave.endDate,
        leaveType,
      },
      { email: manager?.email, phone: manager?.phone, employeeId: leave.employeeId },
    );
    return;
  }

  if (action === "decideLeave") {
    const id = String(input.id ?? "");
    const leave = after.leaveRequests.find((item) => item.id === id);
    if (!leave || leave.status === "pending") return;
    const employee = after.employees.find((item) => item.id === leave.employeeId);
    const leaveType = after.settings.leaveTypes.find((item) => item.id === leave.typeId)?.name ?? "Leave";
    const trigger = leave.status === "approved" ? "leave-approved" : "leave-rejected";
    queueAutomation(
      trigger,
      {
        employeeName: employee ? fullName(employee) : "",
        companyName,
        startDate: leave.startDate,
        endDate: leave.endDate,
        leaveType,
        comment: leave.reviewComment ?? "",
      },
      { email: employee?.email, phone: employee?.phone, employeeId: leave.employeeId },
    );
    return;
  }

  if (action === "createTicket") {
    const id = typeof input.resultId === "string" ? input.resultId : after.tickets[0]?.id;
    const ticket = after.tickets.find((item) => item.id === id) ?? after.tickets[0];
    if (!ticket) return;
    const employee = after.employees.find((item) => item.id === ticket.employeeId);
    const assignee = ticket.assigneeId ? after.employees.find((item) => item.id === ticket.assigneeId) : undefined;
    queueAutomation(
      "ticket-created",
      {
        employeeName: employee ? fullName(employee) : "",
        companyName,
        ticketNumber: ticket.number,
        subject: ticket.subject,
        priority: ticket.priority,
        ticketUrl: `/tickets/${ticket.id}`,
      },
      { email: assignee?.email ?? employee?.email, phone: assignee?.phone, employeeId: ticket.employeeId, ticketId: ticket.id },
    );
    return;
  }

  if (action === "addTicketComment") {
    const id = String(input.id ?? "");
    const ticket = after.tickets.find((item) => item.id === id);
    const beforeTicket = before.tickets.find((item) => item.id === id);
    if (!ticket || !beforeTicket) return;
    const last = ticket.history[ticket.history.length - 1];
    const actor = after.employees.find((item) => item.id === last?.actorId);
    const owner = after.employees.find((item) => item.id === ticket.employeeId);
    if (!actor || !owner || actor.id === owner.id) return;
    if (!after.accounts.some((item) => item.employeeId === actor.id && (item.role === "hr" || item.role === "admin" || item.role === "payroll"))) {
      // Still allow manager/assignee replies
    }
    queueAutomation(
      "ticket-reply-from-team",
      {
        employeeName: fullName(owner),
        companyName,
        ticketNumber: ticket.number,
        subject: ticket.subject,
        replyPreview: (last?.comment ?? "").slice(0, 200),
        ticketUrl: `/tickets/${ticket.id}`,
      },
      { email: owner.email, phone: owner.phone, employeeId: owner.id, ticketId: ticket.id },
    );
    return;
  }

  if (action === "decideExpense") {
    const id = String(input.id ?? "");
    const expense = after.expenses.find((item) => item.id === id);
    if (!expense || expense.status === "pending") return;
    const employee = after.employees.find((item) => item.id === expense.employeeId);
    const trigger = expense.status === "approved" ? "expense-approved" : "expense-rejected";
    queueAutomation(
      trigger,
      {
        employeeName: employee ? fullName(employee) : "",
        companyName,
        amount: formatMoney(expense.amount, after.settings.currency),
        category: expense.category,
      },
      { email: employee?.email, phone: employee?.phone, employeeId: expense.employeeId },
    );
    return;
  }

  if (action === "markExpensePaid") {
    const id = String(input.id ?? "");
    const expense = after.expenses.find((item) => item.id === id);
    if (!expense || expense.status !== "paid") return;
    const employee = after.employees.find((item) => item.id === expense.employeeId);
    queueAutomation(
      "expense-paid",
      {
        employeeName: employee ? fullName(employee) : "",
        companyName,
        amount: formatMoney(expense.amount, after.settings.currency),
        category: expense.category,
      },
      { email: employee?.email, phone: employee?.phone, employeeId: expense.employeeId },
    );
    return;
  }

  if (action === "advancePayroll") {
    const runId = String(input.runId ?? "");
    const run = after.payrollRuns.find((item) => item.id === runId);
    if (!run) return;
    const periodLabel = rangeLabel(run.periodStart, run.periodEnd);
    if (input.status === "finalized") {
      for (const line of run.lines) {
        const employee = after.employees.find((item) => item.id === line.employeeId);
        if (!employee) continue;
        queueAutomation(
          "payroll-approved",
          {
            employeeName: fullName(employee),
            companyName,
            periodLabel,
            netPayable: formatMoney(line.payable, after.settings.currency),
          },
          { email: employee.email, phone: employee.phone, employeeId: employee.id },
        );
        queueAutomation(
          "payslip-ready",
          {
            employeeName: fullName(employee),
            companyName,
            periodLabel,
            netPayable: formatMoney(line.payable, after.settings.currency),
          },
          { email: employee.email, phone: employee.phone, employeeId: employee.id },
        );
      }
    }
    if (input.status === "paid") {
      for (const line of run.lines) {
        const employee = after.employees.find((item) => item.id === line.employeeId);
        if (!employee) continue;
        queueAutomation(
          "payroll-paid",
          {
            employeeName: fullName(employee),
            companyName,
            periodLabel,
            netPayable: formatMoney(line.payable, after.settings.currency),
          },
          { email: employee.email, phone: employee.phone, employeeId: employee.id },
        );
      }
    }
    return;
  }

  if (action === "publishPolicy") {
    const id = String(input.id ?? "");
    const policy = after.policies.find((item) => item.id === id);
    if (!policy) return;
    for (const employee of after.employees.filter((item) => item.status !== "inactive")) {
      queueAutomation(
        "policy-published",
        {
          employeeName: fullName(employee),
          companyName,
          policyTitle: policy.title,
        },
        { email: employee.email, phone: employee.phone, employeeId: employee.id },
      );
    }
    return;
  }

  if (action === "assignAsset") {
    const id = String(input.id ?? "");
    const asset = after.assets.find((item) => item.id === id);
    if (!asset?.assignedTo) return;
    const employee = after.employees.find((item) => item.id === asset.assignedTo);
    if (!employee) return;
    queueAutomation(
      "asset-assigned",
      {
        employeeName: fullName(employee),
        companyName,
        assetName: asset.name,
      },
      { email: employee.email, phone: employee.phone, employeeId: employee.id },
    );
  }
}

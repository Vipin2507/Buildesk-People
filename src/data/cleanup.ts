import type { AppState, Employee } from "../types";

/** People and records shipped with the original sample company. */
const DEMO_EMPLOYEES = new Set([
  "emp_arjun",
  "emp_vikram",
  "emp_ananya",
  "emp_kabir",
  "emp_sana",
  "emp_divya",
  "emp_omar",
  "emp_meera",
  "emp_neha",
  "emp_rohan",
  "emp_arun",
  "emp_priya",
  "emp_leela",
  "emp_ishita",
  "emp_rahul",
]);

const SEEDED_IDS = new Set([
  "pol_conduct",
  "pol_blr",
  "pol_mum",
  "pol_hybrid",
  "hol_next",
  "hol_past",
  "hol_mum",
  "evt_townhall",
  "evt_lunch",
  "doc_ananya_offer",
  "doc_ananya_appoint",
  "doc_ananya_id",
  "doc_kabir_appoint",
  "ins_ananya",
  "ins_kabir",
  "ack_ananya_conduct_1",
  "ast_lt_ananya",
  "ast_ac_ananya",
  "ast_lt_free",
  "ast_ph_kabir",
  "ast_mon",
  "ast_ac_omar",
  "ast_old",
  "ast_lt_sana",
  "tck_fan",
  "tck_letter",
  "tck_payslip",
  "tck_ac",
  "lv_ananya_used",
  "lv_omar",
  "lv_ananya_pending",
  "lv_kabir_pending",
  "lv_divya_pending",
  "lv_ishita_rejected",
  "coff_ananya",
  "coff_kabir",
  "exp_ananya",
  "exp_kabir",
  "exp_sana",
  "exp_divya",
  "exp_arun",
  "reg_kabir",
  "reg_ishita",
  "aud_pay",
  "aud_paid",
  "aud_leave",
  "aud_asset",
  "aud_ins",
]);

function withoutDemoFlag(employee: Employee): { employee: Employee; changed: boolean } {
  if (!("demoLogin" in employee)) return { employee, changed: false };
  const next = { ...employee };
  delete (next as { demoLogin?: boolean }).demoLogin;
  return { employee: next, changed: true };
}

/** Drop the sample company. Records for remaining people stay. */
export function removeDemoContent(state: AppState): { state: AppState; changed: boolean } {
  const demoIds = new Set(
    state.employees
      .filter((item) => DEMO_EMPLOYEES.has(item.id) || item.email.toLowerCase().endsWith("@buildesk.com"))
      .map((item) => item.id),
  );
  let changed = demoIds.size > 0;
  const employees = state.employees
    .filter((item) => !demoIds.has(item.id))
    .map((item) => {
      const cleaned = withoutDemoFlag(item);
      let next = cleaned.employee;
      if (cleaned.changed) changed = true;
      if (next.managerId && (demoIds.has(next.managerId) || !state.employees.some((person) => person.id === next.managerId && !demoIds.has(person.id)))) {
        next = { ...next, managerId: null };
        changed = true;
      }
      return next;
    });
  const unusedSampleDepartments = state.departments.filter((item) => (item.id === "dep_tech" || item.id === "dep_exec") && !employees.some((person) => person.departmentId === item.id));
  const unusedSampleLocations = state.locations.filter((item) => (item.id === "loc_mum" || item.id === "loc_client") && !employees.some((person) => person.locationId === item.id));
  if (unusedSampleDepartments.length > 0 || unusedSampleLocations.length > 0) changed = true;
  if (state.attendance.some((item) => item.source === "system")) changed = true;
  if (!changed) return { state, changed: false };

  const kept = (id: string | null | undefined) => !id || !demoIds.has(id);
  const seeded = (id: string) => SEEDED_IDS.has(id);
  const payrollRuns = state.payrollRuns
    .map((run) => ({ ...run, lines: run.lines.filter((line) => kept(line.employeeId)) }))
    .filter((run) => run.lines.length > 0 && !(demoIds.has(run.createdBy) && /^pay_\d{4}-\d{2}-\d{2}$/.test(run.id)));
  const runIds = new Set(payrollRuns.map((run) => run.id));
  const settings = state.settings.orgName === "Buildesk" ? { ...state.settings, orgName: "Craving Code" } : state.settings;
  const droppedDepartments = new Set(unusedSampleDepartments.map((item) => item.id));
  const droppedLocations = new Set(unusedSampleLocations.map((item) => item.id));
  const departments = state.departments.filter((item) => !droppedDepartments.has(item.id));
  const locations = state.locations.filter((item) => !droppedLocations.has(item.id));

  return {
    changed: true,
    state: {
      ...state,
      settings,
      employees,
      departments,
      locations,
      attendance: state.attendance.filter((item) => kept(item.employeeId) && item.source !== "system"),
      regularizations: state.regularizations.filter((item) => kept(item.employeeId) && !seeded(item.id)),
      leaveRequests: state.leaveRequests.filter((item) => kept(item.employeeId) && !seeded(item.id)),
      compOff: state.compOff.filter((item) => kept(item.employeeId) && !seeded(item.id)),
      holidays: state.holidays.filter((item) => !seeded(item.id)),
      events: state.events.filter((item) => !seeded(item.id)),
      expenses: state.expenses.filter((item) => kept(item.employeeId) && !seeded(item.id)),
      insurance: state.insurance.filter((item) => kept(item.employeeId) && !seeded(item.id)),
      tickets: state.tickets
        .filter((item) => kept(item.employeeId) && !seeded(item.id))
        .map((item) => (kept(item.assigneeId) ? item : { ...item, assigneeId: null })),
      assets: state.assets
        .filter((item) => !seeded(item.id))
        .map((item) => (item.assignedTo && demoIds.has(item.assignedTo) ? { ...item, assignedTo: null, status: item.status === "assigned" ? "available" : item.status } : item)),
      documents: state.documents.filter((item) => kept(item.employeeId) && !seeded(item.id)),
      policies: state.policies.filter((item) => !seeded(item.id)),
      acknowledgements: state.acknowledgements.filter((item) => kept(item.employeeId) && !seeded(item.id) && !SEEDED_IDS.has(item.policyId)),
      payrollRuns,
      payslips: state.payslips.filter((item) => kept(item.employeeId) && runIds.has(item.runId)),
      notifications: state.notifications.filter((item) => kept(item.userId)),
      audits: state.audits.filter((item) => kept(item.actorId) && !seeded(item.id)),
      accounts: state.accounts.filter((item) => !item.employeeId || kept(item.employeeId)),
    },
  };
}

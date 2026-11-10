import { useState } from "react";
import { Banner, Button, DatePicker, DecisionDialog, EmptyState, Field, PageHeader, StatusBadge, Tabs } from "../components/ui";
import { canReview } from "../lib/access";
import { addDays, todayIso } from "../domain/dates";
import { formatDate, formatMoney, fullName } from "../lib/format";
import { useTab } from "../lib/useTab";
import type { InsuranceDraft } from "../store/mutations";
import { useApp } from "../store/store";
import type { ExpenseClaim } from "../types";

export function Expenses() {
  const { state, user, can } = useApp();
  if (!user) return null;
  const approvals = state.expenses.filter((item) => item.status === "pending" && canReview(state, user, item.employeeId, "expense")).length;
  const tabs = [
    { id: "mine", label: "My claims" },
    ...(can("expenses.review") ? [{ id: "approvals", label: "Approvals", count: approvals }] : []),
    ...(can("expenses.pay") ? [{ id: "pay", label: "Reimbursement" }] : []),
    { id: "insurance", label: "Insurance" },
  ];
  const [tab, setTab] = useTab(tabs.map((item) => item.id), "mine");
  return (
    <div>
      <PageHeader title="Expenses and insurance" subtitle="Submit claims, track reimbursement, and view insurance that you are allowed to see." />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === "mine" && <MyClaims />}
      {tab === "approvals" && <Approvals />}
      {tab === "pay" && <PayQueue />}
      {tab === "insurance" && <Insurance />}
    </div>
  );
}

function MyClaims() {
  const { state, user, actions } = useApp();
  const [category, setCategory] = useState(state.settings.expenseCategories[0] ?? "Travel");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayIso());
  const [description, setDescription] = useState("");
  const [receiptName, setReceipt] = useState("");
  const [error, setError] = useState("");
  if (!user) return null;
  const mine = state.expenses.filter((item) => item.employeeId === user.id);
  return (
    <div className="grid-2">
      <section className="panel">
        <h2>My claims</h2>
        {mine.length === 0 && <EmptyState title="No claims yet" body="Submit travel, meals, or other agreed expenses." />}
        {mine.map((item) => <ClaimRow key={item.id} item={item} />)}
      </section>
      <section className="panel">
        <h2>Submit a claim</h2>
        <form noValidate onSubmit={async (event) => {
          event.preventDefault();
          const result = await actions.submitExpense({ category, amount: Number(amount), date, description, receiptName });
          if (!result.ok) setError(result.message);
          else { setError(""); setDescription(""); setAmount(""); setReceipt(""); }
        }}>
          {error && <Banner tone="error">{error}</Banner>}
          <Field label="Category">
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              {state.settings.expenseCategories.map((item) => <option key={item}>{item}</option>)}
            </select>
          </Field>
          <Field label={`Amount (${state.settings.currency})`}><input type="number" min={1} value={amount} onChange={(event) => setAmount(event.target.value)} /></Field>
          <Field label="Date"><DatePicker value={date} onChange={setDate} /></Field>
          <Field label="Description"><textarea value={description} onChange={(event) => setDescription(event.target.value)} /></Field>
          <Field label="Receipt" hint="The file name is stored. The file itself is not uploaded.">
            <input type="file" accept="image/*,.pdf" onChange={(event) => setReceipt(event.target.files?.[0]?.name ?? "")} />
          </Field>
          <Button type="submit">Submit claim</Button>
        </form>
      </section>
    </div>
  );
}

function ClaimRow({ item }: { item: ExpenseClaim }) {
  const { state } = useApp();
  return (
    <div className="notice">
      <div>
        <strong>{item.category} · {formatMoney(item.amount, state.settings.currency)}</strong>
        <div className="muted">{formatDate(item.date)} · {item.description}</div>
        {item.history.slice(-1)[0]?.comment && <div className="faint">{item.history[item.history.length - 1].action}: {item.history[item.history.length - 1].comment}</div>}
      </div>
      <StatusBadge value={item.status} />
    </div>
  );
}

function Approvals() {
  const { state, user, actions } = useApp();
  const [active, setActive] = useState<ExpenseClaim | null>(null);
  const [decision, setDecision] = useState<"approved" | "rejected">("approved");
  if (!user) return null;
  const rows = state.expenses.filter((item) => item.status === "pending" && canReview(state, user, item.employeeId, "expense"));
  return (
    <section className="panel">
      <h2>Claims to review</h2>
      {rows.length === 0 && <EmptyState title="No claims waiting" body="Pending claims from your team appear here." />}
      {rows.map((item) => (
        <div key={item.id} className="notice">
          <div>
            <strong>{fullName(state.employees.find((person) => person.id === item.employeeId)!)} · {formatMoney(item.amount, state.settings.currency)}</strong>
            <div className="muted">{item.category} · {formatDate(item.date)} · {item.description}</div>
          </div>
          <div className="actions">
            <Button size="sm" onClick={() => { setActive(item); setDecision("approved"); }}>Approve</Button>
            <Button size="sm" variant="danger" onClick={() => { setActive(item); setDecision("rejected"); }}>Reject</Button>
          </div>
        </div>
      ))}
      <DecisionDialog
        open={Boolean(active)}
        title={decision === "approved" ? "Approve expense" : "Reject expense"}
        body={active ? `${active.category} · ${formatMoney(active.amount, state.settings.currency)} · ${active.description}` : ""}
        confirmLabel={decision === "approved" ? "Approve" : "Reject"}
        tone={decision === "approved" ? "primary" : "danger"}
        requireComment={decision === "rejected"}
        onClose={() => setActive(null)}
        onConfirm={async (comment) => {
          if (!active) return;
          const result = await actions.decideExpense(active.id, decision, comment);
          if (result.ok) setActive(null);
        }}
      />
    </section>
  );
}

function PayQueue() {
  const { state, actions } = useApp();
  const [confirm, setConfirm] = useState<ExpenseClaim | null>(null);
  const rows = state.expenses.filter((item) => item.status === "approved" || item.status === "paid");
  return (
    <section className="panel">
      <h2>Reimbursement</h2>
      <p className="muted">Approved claims can be marked paid here, or included when payroll is finalized. Paid claims are not added to a later run.</p>
      {rows.map((item) => (
        <div key={item.id} className="notice">
          <div>
            <strong>{fullName(state.employees.find((person) => person.id === item.employeeId)!)} · {formatMoney(item.amount, state.settings.currency)}</strong>
            <div className="muted">{item.category} · {formatDate(item.date)}{item.payrollRunId ? " · included in a payroll run" : ""}</div>
          </div>
          {item.status === "approved" ? <Button size="sm" onClick={() => setConfirm(item)}>Mark paid</Button> : <StatusBadge value="paid" />}
        </div>
      ))}
      <DecisionDialog
        open={Boolean(confirm)}
        title="Mark expense paid"
        body="This records reimbursement outside payroll. It does not send money to a bank."
        confirmLabel="Mark paid"
        requireComment={false}
        onClose={() => setConfirm(null)}
        onConfirm={() => { if (confirm) { actions.markExpensePaid(confirm.id); setConfirm(null); } }}
      />
    </section>
  );
}

function Insurance() {
  const { state, user, can, actions } = useApp();
  const [employeeId, setEmployee] = useState(user?.id ?? "");
  const existing = state.insurance.find((item) => item.employeeId === (can("insurance.manage") ? employeeId : user?.id));
  const [draft, setDraft] = useState<InsuranceDraft | null>(null);
  const [error, setError] = useState("");
  if (!user) return null;
  const viewId = can("insurance.manage") ? employeeId : user.id;
  const record = state.insurance.find((item) => item.employeeId === viewId);
  const form = draft ?? {
    employeeId: viewId,
    plan: record?.plan ?? "",
    policyNumber: record?.policyNumber ?? "",
    coverage: record?.coverage ?? "",
    renewalDate: record?.renewalDate ?? addDays(todayIso(), 365),
    notes: record?.notes ?? "",
    dependents: record?.dependents.map((item) => ({ name: item.name, relationship: item.relationship, dateOfBirth: item.dateOfBirth })) ?? [],
  };
  return (
    <section className="panel narrow">
      <h2>Insurance</h2>
      <Banner tone="info">Insurance records are visible only to the employee and authorized HR. Policy documents and medical files are not stored.</Banner>
      {can("insurance.manage") && (
        <Field label="Employee">
          <select value={employeeId} onChange={(event) => { setEmployee(event.target.value); setDraft(null); }}>
            {state.employees.filter((item) => item.status !== "inactive").map((item) => <option key={item.id} value={item.id}>{fullName(item)}</option>)}
          </select>
        </Field>
      )}
      {!record && !can("insurance.manage") && <EmptyState title="You're not enrolled" body="Contact HR if you expected a plan to be listed here." />}
      {record && !can("insurance.manage") && (
        <dl className="dl">
          <dt>Plan</dt><dd>{record.plan}</dd>
          <dt>Policy</dt><dd>{record.policyNumber}</dd>
          <dt>Coverage</dt><dd>{record.coverage}</dd>
          <dt>Renewal</dt><dd>{formatDate(record.renewalDate)}</dd>
          <dt>Dependents</dt><dd>{record.dependents.length ? record.dependents.map((item) => `${item.name} (${item.relationship})`).join(", ") : "None enrolled"}</dd>
        </dl>
      )}
      {can("insurance.manage") && (
        <form noValidate onSubmit={async (event) => {
          event.preventDefault();
          const result = await actions.saveInsurance({ ...form, employeeId: viewId });
          if (!result.ok) setError(result.message);
          else { setError(""); setDraft(null); }
        }}>
          {error && <Banner tone="error">{error}</Banner>}
          {!existing && <p className="muted">This employee has no enrollment yet.</p>}
          <Field label="Plan"><input value={form.plan} onChange={(event) => setDraft({ ...form, plan: event.target.value })} /></Field>
          <Field label="Policy number"><input value={form.policyNumber} onChange={(event) => setDraft({ ...form, policyNumber: event.target.value })} /></Field>
          <Field label="Coverage"><textarea value={form.coverage} onChange={(event) => setDraft({ ...form, coverage: event.target.value })} /></Field>
          <Field label="Renewal date"><DatePicker value={form.renewalDate} onChange={(renewalDate) => setDraft({ ...form, renewalDate })} /></Field>
          <Field label="Notes"><textarea value={form.notes} onChange={(event) => setDraft({ ...form, notes: event.target.value })} /></Field>
          <h3>Dependents</h3>
          {form.dependents.map((item, index) => (
            <div key={index} className="form-grid">
              <Field label="Name"><input value={item.name} onChange={(event) => updateDependent(form, index, { name: event.target.value }, setDraft)} /></Field>
              <Field label="Relationship"><input value={item.relationship} onChange={(event) => updateDependent(form, index, { relationship: event.target.value }, setDraft)} /></Field>
              <Field label="Date of birth"><DatePicker value={item.dateOfBirth} onChange={(dateOfBirth) => updateDependent(form, index, { dateOfBirth }, setDraft)} max={todayIso()} /></Field>
            </div>
          ))}
          <div className="actions">
            <Button variant="secondary" onClick={() => setDraft({ ...form, dependents: [...form.dependents, { name: "", relationship: "", dateOfBirth: "" }] })}>Add dependent</Button>
            <Button type="submit">Save enrollment</Button>
          </div>
        </form>
      )}
    </section>
  );
}

function updateDependent(form: InsuranceDraft, index: number, patch: Partial<InsuranceDraft["dependents"][number]>, setDraft: (value: InsuranceDraft) => void) {
  setDraft({ ...form, dependents: form.dependents.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) });
}

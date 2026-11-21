import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Banner, Button, Field } from "../../components/ui";
import { isValidEmail } from "../../lib/auth";
import { platformRequest } from "../../lib/platform-api";
import type { PlatformPlan } from "../../types/platform";

const STEPS = ["Company", "Admin", "Plan", "Review"];

export function PlatformCreateWorkspace() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [plans, setPlans] = useState<PlatformPlan[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    companyName: "",
    slug: "",
    adminEmail: "",
    adminDisplayName: "",
    planId: "",
    trialDays: 30,
    notes: "",
  });

  useEffect(() => {
    document.title = "Create workspace · Platform Admin";
    void platformRequest("/api/platform/plans").then(({ payload }) => {
      const list = (payload.plans as PlatformPlan[]) || [];
      setPlans(list);
      if (list[0] && !form.planId) setForm((current) => ({ ...current, planId: list[0].id }));
    });
  }, []);

  const slugify = (name: string) =>
    name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);

  const next = () => {
    if (step === 0) {
      if (!form.companyName.trim()) {
        setError("Enter a company name.");
        return;
      }
      if (!form.slug.trim()) setForm((current) => ({ ...current, slug: slugify(current.companyName) }));
    }
    if (step === 1) {
      if (!isValidEmail(form.adminEmail)) {
        setError("Enter a valid admin email.");
        return;
      }
      if (!form.adminDisplayName.trim()) {
        setError("Enter the admin display name.");
        return;
      }
    }
    if (step === 2 && !form.planId) {
      setError("Choose a plan.");
      return;
    }
    setError("");
    setStep((value) => Math.min(value + 1, STEPS.length - 1));
  };

  const provision = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const { payload } = await platformRequest("/api/platform/workspaces", {
      companyName: form.companyName.trim(),
      slug: form.slug.trim() || undefined,
      adminEmail: form.adminEmail.trim(),
      adminDisplayName: form.adminDisplayName.trim(),
      planId: form.planId,
      trialDays: form.trialDays,
      notes: form.notes,
      inviteOnly: true,
    });
    setBusy(false);
    if (!payload.ok) {
      setError(String(payload.message || "Provisioning failed."));
      return;
    }
    const workspace = payload.workspace as { id: string };
    navigate(`/admin/workspaces/${encodeURIComponent(workspace.id)}`, { replace: true });
  };

  return (
    <div className="platform-page">
      <header className="platform-page-head">
        <div>
          <p className="platform-eyebrow"><Link to="/admin/workspaces">Workspaces</Link></p>
          <h1>Create workspace</h1>
          <p className="lede">Provision an isolated client database and invite the first admin.</p>
        </div>
      </header>

      <ol className="platform-steps">
        {STEPS.map((label, index) => (
          <li key={label} className={index === step ? "is-active" : index < step ? "is-done" : undefined}>{label}</li>
        ))}
      </ol>

      {error ? <Banner tone="error">{error}</Banner> : null}

      <form className="platform-panel platform-form" onSubmit={step === STEPS.length - 1 ? provision : (event) => { event.preventDefault(); next(); }}>
        {step === 0 ? (
          <>
            <Field label="Company name">
              <input
                value={form.companyName}
                onChange={(event) => setForm({ ...form, companyName: event.target.value, slug: form.slug || slugify(event.target.value) })}
                autoFocus
              />
            </Field>
            <Field label="Workspace slug">
              <input value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value.toLowerCase() })} />
            </Field>
          </>
        ) : null}
        {step === 1 ? (
          <>
            <Field label="Admin email">
              <input type="email" value={form.adminEmail} onChange={(event) => setForm({ ...form, adminEmail: event.target.value })} />
            </Field>
            <Field label="Admin display name">
              <input value={form.adminDisplayName} onChange={(event) => setForm({ ...form, adminDisplayName: event.target.value })} />
            </Field>
            <p className="muted">The admin receives an invite-style first login: they sign in with this email and create a password. No default production password is set.</p>
          </>
        ) : null}
        {step === 2 ? (
          <>
            <Field label="Plan">
              <select value={form.planId} onChange={(event) => setForm({ ...form, planId: event.target.value })}>
                {plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>{plan.name} · {plan.employeeLimit} employees</option>
                ))}
              </select>
            </Field>
            <Field label="Trial days">
              <input type="number" min={0} value={form.trialDays} onChange={(event) => setForm({ ...form, trialDays: Number(event.target.value) || 0 })} />
            </Field>
            <Field label="Notes">
              <textarea rows={3} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
            </Field>
          </>
        ) : null}
        {step === 3 ? (
          <ul className="platform-status-list">
            <li><span>Company</span><strong>{form.companyName}</strong></li>
            <li><span>Slug</span><strong>{form.slug || slugify(form.companyName)}</strong></li>
            <li><span>Admin</span><strong>{form.adminDisplayName} · {form.adminEmail}</strong></li>
            <li><span>Plan</span><strong>{plans.find((item) => item.id === form.planId)?.name || form.planId}</strong></li>
            <li><span>Trial days</span><strong>{form.trialDays}</strong></li>
          </ul>
        ) : null}

        <div className="platform-actions">
          {step > 0 ? (
            <Button type="button" variant="ghost" onClick={() => setStep((value) => value - 1)}>Back</Button>
          ) : null}
          <Button variant="primary" type="submit" disabled={busy}>
            {step === STEPS.length - 1 ? (busy ? "Provisioning…" : "Provision workspace") : "Continue"}
          </Button>
        </div>
      </form>
    </div>
  );
}

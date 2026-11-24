import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Banner, Button, Field } from "../../components/ui";
import { isValidEmail } from "../../lib/auth";
import { platformRequest } from "../../lib/platform-api";
import type { ClientWorkspace, PlatformPlan } from "../../types/platform";

const STEPS = ["Company", "Admin", "Plan", "Review", "Done"];

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}

export function PlatformCreateWorkspace() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [plans, setPlans] = useState<PlatformPlan[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [slugTouched, setSlugTouched] = useState(false);
  const [created, setCreated] = useState<(ClientWorkspace & { setupMessage?: string }) | null>(null);
  const [form, setForm] = useState({
    companyName: "",
    slug: "",
    adminEmail: "",
    adminDisplayName: "",
    planId: "",
    status: "active" as "active" | "trial",
    trialDays: 30,
    expiresAt: "",
    notes: "",
  });

  useEffect(() => {
    document.title = "Create workspace · Platform Admin";
    void platformRequest("/api/platform/plans").then(({ payload }) => {
      const list = ((payload.plans as PlatformPlan[]) || []).filter((plan) => plan.status === "active");
      setPlans(list);
      setForm((current) => (current.planId || !list[0] ? current : { ...current, planId: list[0].id }));
    });
  }, []);

  const goNext = () => {
    if (step === 0) {
      if (!form.companyName.trim()) {
        setError("Enter a company name.");
        return;
      }
      const slug = (form.slug.trim() || slugify(form.companyName)).toLowerCase();
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length < 2) {
        setError("Use a slug with lowercase letters, numbers, and hyphens only.");
        return;
      }
      setForm((current) => ({ ...current, slug }));
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
    if (step === 2) {
      if (!form.planId) {
        setError("Choose a plan.");
        return;
      }
      if (form.status === "trial" && (!form.trialDays || form.trialDays < 1)) {
        setError("Enter trial length in days (at least 1).");
        return;
      }
    }
    setError("");
    setStep((value) => Math.min(value + 1, 3));
  };

  const provision = async (event: FormEvent) => {
    event.preventDefault();
    if (step < 3) {
      goNext();
      return;
    }
    setBusy(true);
    setError("");
    const payloadBody: Record<string, unknown> = {
      companyName: form.companyName.trim(),
      slug: form.slug.trim() || slugify(form.companyName),
      adminEmail: form.adminEmail.trim(),
      adminDisplayName: form.adminDisplayName.trim(),
      planId: form.planId,
      status: form.status,
      notes: form.notes,
      inviteOnly: true,
    };
    if (form.status === "trial") {
      payloadBody.trialDays = form.trialDays;
    } else if (form.expiresAt) {
      payloadBody.expiresAt = form.expiresAt;
    }
    const { payload } = await platformRequest("/api/platform/workspaces", payloadBody);
    setBusy(false);
    if (!payload.ok) {
      setError(String(payload.message || "Provisioning failed. You can fix the details and try again."));
      return;
    }
    const workspace = payload.workspace as ClientWorkspace;
    setCreated({ ...workspace, setupMessage: String(payload.message || "") });
    setStep(4);
  };

  const selectedPlan = plans.find((item) => item.id === form.planId);

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
          <li
            key={label}
            className={index === step ? "is-active" : index < step ? "is-done" : undefined}
          >
            {label}
          </li>
        ))}
      </ol>

      {error ? <Banner tone="error">{error}</Banner> : null}

      {step === 4 && created ? (
        <section className="platform-panel">
          <Banner tone="success">Workspace provisioned successfully.</Banner>
          <h2 style={{ marginTop: 21 }}>{created.companyName}</h2>
          <ul className="platform-status-list">
            <li><span>Slug</span><strong><code>{created.slug}</code></strong></li>
            <li><span>Status</span><strong>{created.status}</strong></li>
            <li><span>Plan</span><strong>{selectedPlan?.name || created.planId}</strong></li>
            <li><span>Admin</span><strong>{created.adminDisplayName} · {created.adminEmail}</strong></li>
            <li><span>Expiry</span><strong>{created.expiresAt || "None"}</strong></li>
          </ul>
          <p className="lede" style={{ marginTop: 13 }}>
            {created.setupMessage || "The client admin can sign in at /signin with their email and create a password."}
          </p>
          <div className="platform-actions" style={{ marginTop: 21 }}>
            <Button
              variant="primary"
              type="button"
              onClick={() => navigate(`/admin/workspaces/${encodeURIComponent(created.id)}`, { replace: true })}
            >
              Open workspace
            </Button>
            <Link className="btn btn-ghost" to="/admin/workspaces">Back to list</Link>
            <Button
              variant="ghost"
              type="button"
              onClick={() => {
                setCreated(null);
                setStep(0);
                setSlugTouched(false);
                setForm({
                  companyName: "",
                  slug: "",
                  adminEmail: "",
                  adminDisplayName: "",
                  planId: plans[0]?.id || "",
                  status: "active",
                  trialDays: 30,
                  expiresAt: "",
                  notes: "",
                });
              }}
            >
              Create another
            </Button>
          </div>
        </section>
      ) : (
        <form className="platform-panel platform-form" onSubmit={provision}>
          {step === 0 ? (
            <>
              <Field label="Company name" required>
                <input
                  value={form.companyName}
                  onChange={(event) => {
                    const companyName = event.target.value;
                    setForm((current) => ({
                      ...current,
                      companyName,
                      slug: slugTouched ? current.slug : slugify(companyName),
                    }));
                  }}
                  autoFocus
                  placeholder="Acme India Pvt Ltd"
                />
              </Field>
              <Field label="Workspace slug" hint="Used in platform records. Lowercase letters, numbers, and hyphens." required>
                <input
                  value={form.slug}
                  onChange={(event) => {
                    setSlugTouched(true);
                    setForm({ ...form, slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") });
                  }}
                  placeholder="acme-india"
                />
              </Field>
            </>
          ) : null}

          {step === 1 ? (
            <>
              <Field label="Admin email" required>
                <input
                  type="email"
                  value={form.adminEmail}
                  onChange={(event) => setForm({ ...form, adminEmail: event.target.value })}
                  placeholder="hr.admin@client.com"
                  autoFocus
                />
              </Field>
              <Field label="Admin display name" required>
                <input
                  value={form.adminDisplayName}
                  onChange={(event) => setForm({ ...form, adminDisplayName: event.target.value })}
                  placeholder="Priya Sharma"
                />
              </Field>
              <p className="muted">
                No default password is created. The admin signs in at the normal Buildesk People login with this email and chooses a password on first access.
              </p>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <Field label="Plan" required>
                <select value={form.planId} onChange={(event) => setForm({ ...form, planId: event.target.value })}>
                  {plans.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.name} · up to {plan.employeeLimit} employees
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Account type" required>
                <select
                  value={form.status}
                  onChange={(event) => setForm({ ...form, status: event.target.value as "active" | "trial" })}
                >
                  <option value="active">Active subscription</option>
                  <option value="trial">Trial</option>
                </select>
              </Field>
              {form.status === "trial" ? (
                <Field label="Trial length (days)" required>
                  <input
                    type="number"
                    min={1}
                    value={form.trialDays}
                    onChange={(event) => setForm({ ...form, trialDays: Number(event.target.value) || 0 })}
                  />
                </Field>
              ) : (
                <Field label="Subscription expiry (optional)" hint="Leave blank for no expiry date.">
                  <input
                    type="date"
                    value={form.expiresAt}
                    onChange={(event) => setForm({ ...form, expiresAt: event.target.value })}
                  />
                </Field>
              )}
              <Field label="Platform notes">
                <textarea
                  rows={3}
                  value={form.notes}
                  onChange={(event) => setForm({ ...form, notes: event.target.value })}
                  placeholder="Internal notes for operators"
                />
              </Field>
            </>
          ) : null}

          {step === 3 ? (
            <ul className="platform-status-list">
              <li><span>Company</span><strong>{form.companyName}</strong></li>
              <li><span>Slug</span><strong>{form.slug || slugify(form.companyName)}</strong></li>
              <li><span>Admin</span><strong>{form.adminDisplayName} · {form.adminEmail}</strong></li>
              <li><span>Plan</span><strong>{selectedPlan?.name || form.planId}</strong></li>
              <li><span>Account type</span><strong>{form.status === "trial" ? `Trial (${form.trialDays} days)` : "Active"}</strong></li>
              <li>
                <span>Expiry</span>
                <strong>
                  {form.status === "trial"
                    ? `${form.trialDays} days from today`
                    : form.expiresAt || "None"}
                </strong>
              </li>
              {form.notes ? <li><span>Notes</span><strong>{form.notes}</strong></li> : null}
            </ul>
          ) : null}

          <div className="platform-actions">
            {step > 0 ? (
              <Button type="button" variant="ghost" onClick={() => { setError(""); setStep((value) => value - 1); }}>
                Back
              </Button>
            ) : null}
            <Button variant="primary" type="submit" disabled={busy}>
              {step === 3 ? (busy ? "Provisioning…" : "Provision workspace") : "Continue"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

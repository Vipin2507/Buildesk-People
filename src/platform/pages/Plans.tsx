import { useEffect, useState, type FormEvent } from "react";
import { Banner, Button, Field } from "../../components/ui";
import { platformRequest } from "../../lib/platform-api";
import { HRMS_MODULES, type PlatformPlan } from "../../types/platform";

export function PlatformPlans() {
  const [plans, setPlans] = useState<PlatformPlan[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    id: "",
    code: "",
    name: "",
    employeeLimit: 25,
    storageMb: 1024,
    modules: [...HRMS_MODULES] as string[],
    notes: "",
  });

  const load = async () => {
    const { payload } = await platformRequest("/api/platform/plans");
    setPlans((payload.plans as PlatformPlan[]) || []);
  };

  useEffect(() => {
    document.title = "Plans · Platform Admin";
    void load();
  }, []);

  const edit = (plan: PlatformPlan) => {
    setForm({
      id: plan.id,
      code: plan.code,
      name: plan.name,
      employeeLimit: plan.employeeLimit,
      storageMb: plan.storageMb,
      modules: [...plan.modules],
      notes: plan.notes,
    });
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const { payload } = await platformRequest("/api/platform/plans", form);
    if (!payload.ok) {
      setError(String(payload.message || "Save failed."));
      return;
    }
    setMessage("Plan saved.");
    setError("");
    setForm({ id: "", code: "", name: "", employeeLimit: 25, storageMb: 1024, modules: [...HRMS_MODULES], notes: "" });
    await load();
  };

  return (
    <div className="platform-page">
      <header className="platform-page-head">
        <div>
          <h1>Plans & Entitlements</h1>
          <p className="lede">Employee limits and module entitlements enforced server-side on client workspaces.</p>
        </div>
      </header>
      {message ? <Banner tone="success">{message}</Banner> : null}
      {error ? <Banner tone="error">{error}</Banner> : null}

      <div className="platform-split">
        <section className="platform-panel">
          <h2>Plans</h2>
          <ul className="platform-audit-list">
            {plans.map((plan) => (
              <li key={plan.id}>
                <button type="button" className="btn btn-ghost" onClick={() => edit(plan)}>
                  {plan.name} · {plan.employeeLimit} employees · {plan.status}
                </button>
              </li>
            ))}
          </ul>
        </section>
        <form className="platform-panel platform-form" onSubmit={save}>
          <h2>{form.id ? "Edit plan" : "New plan"}</h2>
          <Field label="Code">
            <input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} required />
          </Field>
          <Field label="Name">
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
          </Field>
          <Field label="Employee limit">
            <input type="number" min={1} value={form.employeeLimit} onChange={(event) => setForm({ ...form, employeeLimit: Number(event.target.value) || 1 })} />
          </Field>
          <Field label="Storage (MB)">
            <input type="number" min={100} value={form.storageMb} onChange={(event) => setForm({ ...form, storageMb: Number(event.target.value) || 100 })} />
          </Field>
          <fieldset className="platform-modules">
            <legend>Modules</legend>
            {HRMS_MODULES.map((module) => (
              <label key={module}>
                <input
                  type="checkbox"
                  checked={form.modules.includes(module)}
                  onChange={(event) => {
                    setForm({
                      ...form,
                      modules: event.target.checked
                        ? [...form.modules, module]
                        : form.modules.filter((item) => item !== module),
                    });
                  }}
                />
                {module}
              </label>
            ))}
          </fieldset>
          <Field label="Notes">
            <textarea rows={3} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
          </Field>
          <Button variant="primary" type="submit">Save plan</Button>
        </form>
      </div>
    </div>
  );
}

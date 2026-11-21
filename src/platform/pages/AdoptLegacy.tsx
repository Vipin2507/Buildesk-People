import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Banner, Button, Field } from "../../components/ui";
import { platformRequest } from "../../lib/platform-api";
import type { PlatformPlan } from "../../types/platform";

export function PlatformAdoptLegacy() {
  const navigate = useNavigate();
  const [plans, setPlans] = useState<PlatformPlan[]>([]);
  const [companyName, setCompanyName] = useState("Existing organization");
  const [slug, setSlug] = useState("legacy-org");
  const [planId, setPlanId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = "Adopt legacy · Platform Admin";
    void platformRequest("/api/platform/plans").then(({ payload }) => {
      const list = (payload.plans as PlatformPlan[]) || [];
      setPlans(list);
      if (list[0]) setPlanId(list[0].id);
    });
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const { payload } = await platformRequest("/api/platform/workspaces/adopt-legacy", {
      companyName,
      slug,
      planId,
    });
    setBusy(false);
    if (!payload.ok) {
      setError(String(payload.message || "Adoption failed."));
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
          <h1>Adopt legacy database</h1>
          <p className="lede">
            Registers the existing single-tenant <code>data/buildesk.sqlite</code> as a workspace without copying or deleting records.
            Take a backup first. Set <code>BUILDESK_LEGACY_SINGLE_TENANT=false</code> only after verifying login.
          </p>
        </div>
      </header>
      {error ? <Banner tone="error">{error}</Banner> : null}
      <form className="platform-panel platform-form" onSubmit={submit}>
        <Field label="Company name">
          <input value={companyName} onChange={(event) => setCompanyName(event.target.value)} />
        </Field>
        <Field label="Slug">
          <input value={slug} onChange={(event) => setSlug(event.target.value)} />
        </Field>
        <Field label="Plan">
          <select value={planId} onChange={(event) => setPlanId(event.target.value)}>
            {plans.map((plan) => (
              <option key={plan.id} value={plan.id}>{plan.name}</option>
            ))}
          </select>
        </Field>
        <Button variant="primary" type="submit" disabled={busy}>{busy ? "Adopting…" : "Adopt legacy workspace"}</Button>
      </form>
    </div>
  );
}

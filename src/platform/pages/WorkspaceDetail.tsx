import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Banner, Button, Field } from "../../components/ui";
import { platformRequest } from "../../lib/platform-api";
import type { ClientWorkspace, PlatformPlan } from "../../types/platform";

type Detail = ClientWorkspace & {
  planName: string;
  employeeLimit: number;
  modules: string[];
  usage: { ok: boolean; employees: number; accounts: number; storageBytes: number; message?: string };
};

export function PlatformWorkspaceDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [workspace, setWorkspace] = useState<Detail | null>(null);
  const [plans, setPlans] = useState<PlatformPlan[]>([]);
  const [tab, setTab] = useState<"overview" | "configuration" | "lifecycle">("overview");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmSlug, setConfirmSlug] = useState("");
  const [form, setForm] = useState({ companyName: "", planId: "", notes: "", expiresAt: "", status: "" });

  const load = async () => {
    const [{ payload }, plansRes] = await Promise.all([
      platformRequest(`/api/platform/workspaces/${encodeURIComponent(id)}`),
      platformRequest("/api/platform/plans"),
    ]);
    if (!payload.ok) {
      setError(String(payload.message || "Workspace not found."));
      return;
    }
    const detail = payload.workspace as Detail;
    setWorkspace(detail);
    setForm({
      companyName: detail.companyName,
      planId: detail.planId,
      notes: detail.notes,
      expiresAt: detail.expiresAt || "",
      status: detail.status,
    });
    setPlans((plansRes.payload.plans as PlatformPlan[]) || []);
  };

  useEffect(() => {
    document.title = "Workspace · Platform Admin";
    void load();
  }, [id]);

  if (error && !workspace) {
    return (
      <div className="platform-page">
        <p className="error-text">{error}</p>
        <Link to="/admin/workspaces">Back to workspaces</Link>
      </div>
    );
  }
  if (!workspace) return <div className="platform-page"><p className="muted">Loading…</p></div>;

  const saveConfig = async (event: FormEvent) => {
    event.preventDefault();
    const { payload } = await platformRequest(
      `/api/platform/workspaces/${encodeURIComponent(id)}`,
      {
        companyName: form.companyName,
        planId: form.planId,
        notes: form.notes,
        expiresAt: form.expiresAt || null,
        status: form.status,
      },
      "PATCH",
    );
    if (!payload.ok) {
      setError(String(payload.message || "Update failed."));
      return;
    }
    setMessage("Workspace updated.");
    setError("");
    await load();
  };

  const runAction = async (action: string, extra: Record<string, unknown> = {}) => {
    const { payload } = await platformRequest(`/api/platform/workspaces/${encodeURIComponent(id)}/action`, {
      action,
      ...extra,
    });
    if (!payload.ok) {
      setError(String(payload.message || "Action failed."));
      return;
    }
    setMessage(String(payload.message || "Done."));
    setError("");
    if (action === "delete") {
      navigate("/admin/workspaces", { replace: true });
      return;
    }
    await load();
  };

  return (
    <div className="platform-page">
      <header className="platform-page-head">
        <div>
          <p className="platform-eyebrow"><Link to="/admin/workspaces">Workspaces</Link></p>
          <h1>{workspace.companyName}</h1>
          <p className="lede"><code>{workspace.slug}</code> · {workspace.status} · {workspace.planName}</p>
        </div>
        <div className="platform-actions">
          <Button type="button" variant="ghost" onClick={() => void runAction("extend", { days: 30 })}>Extend 30 days</Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => void runAction("reset-admin-access")}
          >
            Reset admin access
          </Button>
        </div>
      </header>

      {message ? <Banner tone="success">{message}</Banner> : null}
      {error ? <Banner tone="error">{error}</Banner> : null}

      <div className="platform-tabs">
        {(["overview", "configuration", "lifecycle"] as const).map((item) => (
          <button key={item} type="button" className={tab === item ? "is-active" : undefined} onClick={() => setTab(item)}>
            {item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <div className="platform-split">
          <section className="platform-panel">
            <h2>Usage</h2>
            {workspace.usage.ok ? (
              <ul className="platform-status-list">
                <li><span>Employees</span><strong>{workspace.usage.employees} / {workspace.employeeLimit || "∞"}</strong></li>
                <li><span>Accounts</span><strong>{workspace.usage.accounts}</strong></li>
                <li><span>Database size</span><strong>{Math.round(workspace.usage.storageBytes / 1024)} KB</strong></li>
              </ul>
            ) : (
              <p className="error-text">{workspace.usage.message || "Database unavailable"}</p>
            )}
            <h2>Modules</h2>
            <p>{workspace.modules.join(", ") || "—"}</p>
          </section>
          <section className="platform-panel">
            <h2>Contact</h2>
            <p><strong>{workspace.adminDisplayName}</strong></p>
            <p>{workspace.adminEmail}</p>
            <p className="muted">Provisioning: {workspace.provisioningStatus}</p>
            {workspace.provisioningError ? <p className="error-text">{workspace.provisioningError}</p> : null}
          </section>
        </div>
      ) : null}

      {tab === "configuration" ? (
        <form className="platform-panel platform-form" onSubmit={saveConfig}>
          <Field label="Company name">
            <input value={form.companyName} onChange={(event) => setForm({ ...form, companyName: event.target.value })} />
          </Field>
          <Field label="Plan">
            <select value={form.planId} onChange={(event) => setForm({ ...form, planId: event.target.value })}>
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>{plan.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
              <option value="active">Active</option>
              <option value="trial">Trial</option>
              <option value="suspended">Suspended</option>
              <option value="expired">Expired</option>
              <option value="archived">Archived</option>
            </select>
          </Field>
          <Field label="Expires on">
            <input type="date" value={form.expiresAt} onChange={(event) => setForm({ ...form, expiresAt: event.target.value })} />
          </Field>
          <Field label="Platform notes">
            <textarea rows={4} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
          </Field>
          <Button variant="primary" type="submit">Save configuration</Button>
        </form>
      ) : null}

      {tab === "lifecycle" ? (
        <section className="platform-panel">
          <h2>Lifecycle actions</h2>
          <div className="platform-actions" style={{ marginBottom: 21 }}>
            <Button type="button" variant="ghost" onClick={() => {
              setForm({ ...form, status: "suspended" });
              void platformRequest(`/api/platform/workspaces/${encodeURIComponent(id)}`, { status: "suspended" }, "PATCH").then(() => load());
            }}>Suspend</Button>
            <Button type="button" variant="ghost" onClick={() => {
              void platformRequest(`/api/platform/workspaces/${encodeURIComponent(id)}`, { status: "active" }, "PATCH").then(() => load());
            }}>Reactivate</Button>
            <Button type="button" variant="ghost" onClick={() => {
              void platformRequest(`/api/platform/workspaces/${encodeURIComponent(id)}`, { status: "archived" }, "PATCH").then(() => load());
            }}>Archive</Button>
          </div>
          <h2>Permanent delete</h2>
          <p className="lede">This removes the tenant database and cannot be undone. Type the slug <code>{workspace.slug}</code> to confirm.</p>
          <Field label="Confirm slug">
            <input value={confirmSlug} onChange={(event) => setConfirmSlug(event.target.value)} />
          </Field>
          <Button
            type="button"
            variant="danger"
            disabled={confirmSlug !== workspace.slug}
            onClick={() => void runAction("delete", { confirmSlug })}
          >
            Permanently delete workspace
          </Button>
        </section>
      ) : null}
    </div>
  );
}

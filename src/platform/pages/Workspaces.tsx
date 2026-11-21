import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { platformRequest } from "../../lib/platform-api";
import type { ClientWorkspace } from "../../types/platform";

type Row = ClientWorkspace & {
  planName: string;
  employeeLimit: number;
  usage: { ok: boolean; employees: number; accounts: number; message?: string };
};

export function PlatformWorkspaces() {
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async (query = q, statusFilter = status) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (statusFilter !== "all") params.set("status", statusFilter);
    const { status: http, payload } = await platformRequest(`/api/platform/workspaces?${params}`);
    setLoading(false);
    if (http === 401) {
      setError("Session expired.");
      return;
    }
    if (!payload.ok) {
      setError(String(payload.message || "Could not load workspaces."));
      return;
    }
    setError("");
    setRows((payload.workspaces as Row[]) || []);
  };

  useEffect(() => {
    document.title = "Workspaces · Platform Admin";
    void load();
  }, []);

  return (
    <div className="platform-page">
      <header className="platform-page-head">
        <div>
          <h1>Client Workspaces</h1>
          <p className="lede">Search and manage isolated client HRMS databases.</p>
        </div>
        <div className="platform-actions">
          <Link className="btn btn-ghost" to="/admin/workspaces/adopt">Adopt legacy data</Link>
          <Link className="btn btn-primary" to="/admin/workspaces/new">Create workspace</Link>
        </div>
      </header>

      <form
        className="platform-filters"
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
      >
        <input
          placeholder="Search company, slug, or admin email"
          value={q}
          onChange={(event) => setQ(event.target.value)}
        />
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="trial">Trial</option>
          <option value="suspended">Suspended</option>
          <option value="expired">Expired</option>
          <option value="archived">Archived</option>
          <option value="provisioning">Provisioning</option>
        </select>
        <button className="btn btn-primary" type="submit">Filter</button>
      </form>

      {error ? <p className="error-text">{error}</p> : null}
      {loading ? <p className="muted">Loading…</p> : null}

      {!loading && rows.length === 0 ? (
        <p className="muted">No workspaces match these filters.</p>
      ) : (
        <div className="platform-table-wrap">
          <table className="platform-table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Slug</th>
                <th>Status</th>
                <th>Plan</th>
                <th>Admin</th>
                <th>Usage</th>
                <th>Expiry</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td><Link to={`/admin/workspaces/${encodeURIComponent(row.id)}`}>{row.companyName}</Link></td>
                  <td><code>{row.slug}</code></td>
                  <td><span className={`platform-pill status-${row.status}`}>{row.status}</span></td>
                  <td>{row.planName}</td>
                  <td>{row.adminEmail}</td>
                  <td>
                    {row.usage.ok
                      ? `${row.usage.employees}/${row.employeeLimit || "∞"} employees`
                      : row.usage.message || "Unavailable"}
                  </td>
                  <td>{row.expiresAt || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

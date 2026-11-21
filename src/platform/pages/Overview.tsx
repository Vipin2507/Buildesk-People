import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { platformRequest } from "../../lib/platform-api";

type OverviewData = {
  totals: {
    workspaces: number;
    operators: number;
    plans: number;
    approachingExpiry: number;
    dbUnavailable: number;
    provisioningFailed: number;
  };
  byStatus: Record<string, number>;
  recentAudits: Array<{ id: string; at: string; summary: string; action: string }>;
};

export function PlatformOverview() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    document.title = "Overview · Platform Admin";
    void platformRequest("/api/platform/overview").then(({ status, payload }) => {
      if (status === 401) {
        setError("Session expired.");
        return;
      }
      if (!payload.ok) {
        setError(String(payload.message || "Could not load overview."));
        return;
      }
      setData(payload as unknown as OverviewData);
    });
  }, []);

  if (error) return <div className="platform-page"><p className="error-text">{error}</p></div>;
  if (!data) return <div className="platform-page"><p className="muted">Loading overview…</p></div>;

  const cards = [
    { label: "Workspaces", value: data.totals.workspaces },
    { label: "Active operators", value: data.totals.operators },
    { label: "Plans", value: data.totals.plans },
    { label: "Expiring soon", value: data.totals.approachingExpiry },
    { label: "DB unavailable", value: data.totals.dbUnavailable },
    { label: "Provisioning failed", value: data.totals.provisioningFailed },
  ];

  return (
    <div className="platform-page">
      <header className="platform-page-head">
        <div>
          <h1>Overview</h1>
          <p className="lede">Operational health across client workspaces. No payroll or personal HR data is shown here.</p>
        </div>
        <Link className="btn btn-primary" to="/admin/workspaces/new">Create workspace</Link>
      </header>

      <div className="platform-split">
        <section className="platform-panel">
          <h2>Workspace status</h2>
          <div className="platform-metric-grid">
            {cards.map((card) => (
              <div key={card.label} className="platform-metric">
                <span>{card.label}</span>
                <strong>{card.value}</strong>
              </div>
            ))}
          </div>
          <ul className="platform-status-list">
            {Object.entries(data.byStatus).map(([status, count]) => (
              <li key={status}><span>{status}</span><strong>{count}</strong></li>
            ))}
          </ul>
        </section>
        <section className="platform-panel">
          <h2>Recent activity</h2>
          {data.recentAudits.length === 0 ? (
            <p className="muted">No platform events yet.</p>
          ) : (
            <ul className="platform-audit-list">
              {data.recentAudits.map((item) => (
                <li key={item.id}>
                  <time dateTime={item.at}>{new Date(item.at).toLocaleString()}</time>
                  <span>{item.summary}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

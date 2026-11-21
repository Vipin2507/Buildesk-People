import { useEffect, useState } from "react";
import { platformRequest } from "../../lib/platform-api";
import type { PlatformAuditEvent } from "../../types/platform";

export function PlatformAudits() {
  const [audits, setAudits] = useState<PlatformAuditEvent[]>([]);

  useEffect(() => {
    document.title = "Audit log · Platform Admin";
    void platformRequest("/api/platform/audits").then(({ payload }) => {
      setAudits((payload.audits as PlatformAuditEvent[]) || []);
    });
  }, []);

  return (
    <div className="platform-page">
      <header className="platform-page-head">
        <div>
          <h1>Audit Log</h1>
          <p className="lede">Platform control-plane events. Secrets and tenant HR payloads are not stored here.</p>
        </div>
      </header>
      <div className="platform-table-wrap">
        <table className="platform-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Action</th>
              <th>Summary</th>
              <th>Target</th>
            </tr>
          </thead>
          <tbody>
            {audits.map((item) => (
              <tr key={item.id}>
                <td>{new Date(item.at).toLocaleString()}</td>
                <td><code>{item.action}</code></td>
                <td>{item.summary}</td>
                <td>{item.targetType}:{item.targetId}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

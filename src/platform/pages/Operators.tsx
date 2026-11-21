import { useEffect, useState, type FormEvent } from "react";
import { Banner, Button, Field, PasswordInput } from "../../components/ui";
import { isValidEmail } from "../../lib/auth";
import { platformRequest } from "../../lib/platform-api";
import { usePlatform } from "../store";

type OperatorRow = {
  id: string;
  email: string;
  displayName: string;
  role: "owner" | "operator";
  status: string;
};

export function PlatformOperators() {
  const { operator: self, refresh } = usePlatform();
  const [operators, setOperators] = useState<OperatorRow[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [invite, setInvite] = useState({ email: "", displayName: "", role: "operator" as "owner" | "operator" });
  const [passwordForm, setPasswordForm] = useState({ currentPassword: "", password: "", confirm: "" });

  const load = async () => {
    const { payload } = await platformRequest("/api/platform/operators");
    setOperators((payload.operators as OperatorRow[]) || []);
  };

  useEffect(() => {
    document.title = "Operators · Platform Admin";
    void load();
  }, []);

  const inviteOperator = async (event: FormEvent) => {
    event.preventDefault();
    if (!isValidEmail(invite.email)) {
      setError("Enter a valid email.");
      return;
    }
    const { payload } = await platformRequest("/api/platform/operators", invite);
    if (!payload.ok) {
      setError(String(payload.message || "Invite failed."));
      return;
    }
    setMessage(String(payload.message || "Operator invited."));
    setError("");
    setInvite({ email: "", displayName: "", role: "operator" });
    await load();
  };

  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    if (!self) return;
    const { payload } = await platformRequest(
      `/api/platform/operators/${encodeURIComponent(self.id)}`,
      { selfPassword: true, ...passwordForm },
      "PATCH",
    );
    if (!payload.ok) {
      setError(String(payload.message || "Password change failed."));
      return;
    }
    setMessage("Password updated.");
    setError("");
    setPasswordForm({ currentPassword: "", password: "", confirm: "" });
  };

  const setStatus = async (id: string, status: string) => {
    if (!window.confirm(`Confirm changing operator access to “${status}”?`)) return;
    const { payload } = await platformRequest(`/api/platform/operators/${encodeURIComponent(id)}`, { status }, "PATCH");
    if (!payload.ok) {
      setError(String(payload.message || "Update failed."));
      return;
    }
    setMessage("Operator updated.");
    await load();
    await refresh();
  };

  return (
    <div className="platform-page">
      <header className="platform-page-head">
        <div>
          <h1>Platform Operators</h1>
          <p className="lede">Control-plane identities only. They cannot open client HRMS sessions with these credentials.</p>
        </div>
      </header>
      {message ? <Banner tone="success">{message}</Banner> : null}
      {error ? <Banner tone="error">{error}</Banner> : null}

      <div className="platform-split">
        <section className="platform-panel">
          <h2>Operators</h2>
          <div className="platform-table-wrap">
            <table className="platform-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {operators.map((item) => (
                  <tr key={item.id}>
                    <td>{item.displayName}</td>
                    <td>{item.email}</td>
                    <td>{item.role}</td>
                    <td>{item.status}</td>
                    <td>
                      {self?.role === "owner" && item.id !== self.id ? (
                        item.status === "active" ? (
                          <button type="button" className="btn btn-ghost" onClick={() => void setStatus(item.id, "disabled")}>Disable</button>
                        ) : (
                          <button type="button" className="btn btn-ghost" onClick={() => void setStatus(item.id, "active")}>Activate</button>
                        )
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <div className="platform-stack">
          {self?.role === "owner" ? (
            <form className="platform-panel platform-form" onSubmit={inviteOperator}>
              <h2>Invite operator</h2>
              <Field label="Email">
                <input type="email" value={invite.email} onChange={(event) => setInvite({ ...invite, email: event.target.value })} />
              </Field>
              <Field label="Display name">
                <input value={invite.displayName} onChange={(event) => setInvite({ ...invite, displayName: event.target.value })} />
              </Field>
              <Field label="Role">
                <select value={invite.role} onChange={(event) => setInvite({ ...invite, role: event.target.value as "owner" | "operator" })}>
                  <option value="operator">Operator</option>
                  <option value="owner">Owner</option>
                </select>
              </Field>
              <Button variant="primary" type="submit">Send invite</Button>
            </form>
          ) : null}
          <form className="platform-panel platform-form" onSubmit={changePassword}>
            <h2>Change my password</h2>
            <Field label="Current password">
              <PasswordInput value={passwordForm.currentPassword} onChange={(event) => setPasswordForm({ ...passwordForm, currentPassword: event.target.value })} />
            </Field>
            <Field label="New password">
              <PasswordInput value={passwordForm.password} onChange={(event) => setPasswordForm({ ...passwordForm, password: event.target.value })} />
            </Field>
            <Field label="Confirm">
              <PasswordInput value={passwordForm.confirm} onChange={(event) => setPasswordForm({ ...passwordForm, confirm: event.target.value })} />
            </Field>
            <Button variant="primary" type="submit">Update password</Button>
          </form>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate } from "react-router-dom";
import { Banner, Button, Field, PasswordInput } from "../components/ui";
import { isValidEmail } from "../lib/auth";
import { useApp } from "../store/store";

export function SignIn() {
  const { user, actions } = useApp();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [setupEmail, setSetupEmail] = useState<string | null>(null);
  const [invited, setInvited] = useState(false);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    document.title = "Sign in · Buildesk People";
  }, []);
  if (user) return <Navigate to="/" replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = email.trim();
    if (!value) {
      setError("Enter your work email.");
      return;
    }
    if (!isValidEmail(value)) {
      setError("Enter a valid work email.");
      return;
    }
    setLoading(true);
    const result = await actions.signIn(value, password);
    setLoading(false);
    setPassword("");
    if (!result.ok && result.setup) {
      setSetupEmail(value);
      setInvited(Boolean(result.invited));
      setError("");
      return;
    }
    setError(result.ok ? "" : result.message);
  };

  const createPassword = async (event: FormEvent) => {
    event.preventDefault();
    if (!setupEmail) return;
    if (password !== confirm) {
      setError("Those passwords do not match.");
      return;
    }
    setLoading(true);
    const result = await actions.createPassword(setupEmail, password, confirm);
    setLoading(false);
    if (!result.ok) {
      setPassword("");
      setConfirm("");
      setError(result.message);
    }
  };

  return (
    <div className="signin">
      <aside className="signin-side">
        <div>
          <div className="signin-brand">
            <div className="brand-mark">B</div>
            <strong>Buildesk People</strong>
          </div>
          <h1>The people workspace</h1>
          <p>Attendance, leave, payroll, and the requests employees make every day.</p>
        </div>
      </aside>
      <main className="signin-main">
        {setupEmail ? (
          <form className="signin-card" noValidate onSubmit={createPassword}>
            <h2>Create a password</h2>
            <p className="lede">{invited ? `${setupEmail} has a pending invitation. Choose a password to activate it.` : `${setupEmail} does not have a password yet. Choose one to finish signing in.`}</p>
            <Field label="New password" error={error}>
              <PasswordInput name="new-password" autoComplete="new-password" autoFocus value={password} onChange={(event) => { setPassword(event.target.value); if (error) setError(""); }} />
            </Field>
            <Field label="Confirm password">
              <PasswordInput name="confirm-password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} />
            </Field>
            <Button type="submit" disabled={loading}>{loading ? "Saving…" : "Save password and sign in"}</Button>
            <p className="signin-help"><button type="button" className="btn btn-ghost" onClick={() => { setSetupEmail(null); setPassword(""); setConfirm(""); setError(""); }}>Back</button></p>
          </form>
        ) : (
          <form className="signin-card" noValidate onSubmit={submit}>
            <h2>Sign in</h2>
            <p className="lede">Enter the work email and password for your account.</p>
            {error && <Banner tone="error">{error}</Banner>}
            <Field label="Work email">
              <input
                type="email"
                name="email"
                autoComplete="username"
                autoFocus
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  if (error) setError("");
                }}
              />
            </Field>
            <Field label="Password">
              <PasswordInput
                name="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  if (error) setError("");
                }}
              />
            </Field>
            <Button type="submit" disabled={loading}>{loading ? "Signing in…" : "Sign in"}</Button>
            <p className="signin-help">
              <Link to="/forgot-password">Can't sign in?</Link>
            </p>
          </form>
        )}
      </main>
    </div>
  );
}

export function ForgotPassword() {
  const { user } = useApp();
  useEffect(() => {
    document.title = "Can't sign in · Buildesk People";
  }, []);
  if (user) return <Navigate to="/" replace />;
  return (
    <div className="signin">
      <aside className="signin-side">
        <div>
          <div className="signin-brand">
            <div className="brand-mark">B</div>
            <strong>Buildesk People</strong>
          </div>
          <h1>The people workspace</h1>
          <p>Attendance, leave, payroll, and the requests employees make every day.</p>
        </div>
      </aside>
      <main className="signin-main">
        <div className="signin-card">
          <h2>Can't sign in?</h2>
          <p className="lede">Sign in with your work email and password. Passwords are not emailed from this workspace.</p>
          <p>The first sign-in asks you to choose a password. After that, the email alone does not open a session. A suspended account has to be reactivated by an administrator.</p>
          <Link className="btn btn-primary" to="/signin">Back to sign in</Link>
        </div>
      </main>
    </div>
  );
}

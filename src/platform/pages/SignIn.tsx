import { useEffect, useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { Banner, Button, Field, PasswordInput } from "../../components/ui";
import { isValidEmail } from "../../lib/auth";
import { usePlatform } from "../store";

export function PlatformSignIn() {
  const { ready, operator, signIn, completeSetup } = usePlatform();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [setup, setSetup] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    document.title = "Platform Admin · Buildesk";
  }, []);

  if (ready && operator) return <Navigate to="/admin" replace />;
  if (!ready) return <div className="platform-loading">Loading…</div>;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!isValidEmail(email)) {
      setError("Enter a valid email.");
      return;
    }
    setLoading(true);
    if (setup) {
      const result = await completeSetup(email.trim(), password, confirm);
      setLoading(false);
      setError(result.ok ? "" : result.message);
      return;
    }
    const result = await signIn(email.trim(), password);
    setLoading(false);
    if (!result.ok && /invitation|password/i.test(result.message)) {
      // Keep generic sign-in errors; setup is a separate mode.
    }
    setError(result.ok ? "" : result.message);
  };

  return (
    <div className="platform-signin">
      <form className="platform-signin-card" noValidate onSubmit={submit}>
        <p className="platform-eyebrow">Buildesk People</p>
        <h1>Platform Admin</h1>
        <p className="lede">
          {setup
            ? "Complete your operator invitation by choosing a password."
            : "Sign in with your platform operator account. This is separate from client HRMS logins."}
        </p>
        {error ? <Banner tone="error">{error}</Banner> : null}
        <Field label="Email">
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              if (error) setError("");
            }}
          />
        </Field>
        <Field label={setup ? "New password" : "Password"}>
          <PasswordInput
            autoComplete={setup ? "new-password" : "current-password"}
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              if (error) setError("");
            }}
          />
        </Field>
        {setup ? (
          <Field label="Confirm password">
            <PasswordInput
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => {
                setConfirm(event.target.value);
                if (error) setError("");
              }}
            />
          </Field>
        ) : null}
        <Button variant="primary" type="submit" disabled={loading}>
          {loading ? "Please wait…" : setup ? "Activate account" : "Sign in"}
        </Button>
        <button
          type="button"
          className="btn btn-ghost platform-linkish"
          onClick={() => {
            setSetup((value) => !value);
            setError("");
            setPassword("");
            setConfirm("");
          }}
        >
          {setup ? "Back to sign in" : "Complete an invitation"}
        </button>
      </form>
    </div>
  );
}

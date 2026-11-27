import { useState } from "react";
import type { FormEvent } from "react";
import { api, ApiError } from "../api/client";

interface Props {
  onSuccess: () => void;
}

const MIN_LENGTH = 12;

export default function Setup({ onSuccess }: Props) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (password.length < MIN_LENGTH) {
      setError(`Use at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    if (!code.trim()) {
      setError("Enter the setup code from the container log.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.setupPassword(password, code.trim());
      setPassword("");
      setConfirm("");
      onSuccess();
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setError("Too many attempts. Try again later.");
      } else if (err instanceof ApiError && err.status === 401) {
        setError("That setup code is not right. Copy it from the latest lines of the container log.");
      } else if (err instanceof ApiError && err.status === 403) {
        setError("Set up over HTTPS, or from your home network.");
      } else if (err instanceof ApiError && err.status === 409) {
        setError("A password is already set. Reload the page to sign in.");
      } else if (err instanceof ApiError && err.status === 0) {
        setError("Could not reach the server. Check that it is running.");
      } else {
        setError("Setup failed. Try again in a moment.");
      }
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <div className="login-panel">
        <h1>MAL-Sync Docker</h1>
        <p className="login-intro">Set your password. This is a one-time step.</p>
        <p className="muted">
          The setup code is printed in the container log (on Unraid: Docker tab, the container's menu, Logs). It
          proves you control this server. A new code is made each time the container starts until you finish here.
        </p>
        <form onSubmit={handleSubmit} noValidate>
          <input type="text" name="username" autoComplete="username" tabIndex={-1} aria-hidden="true" className="sr-only" />
          <label htmlFor="setup-code">Setup code</label>
          <input
            id="setup-code"
            name="setup-code"
            type="text"
            autoComplete="off"
            spellCheck={false}
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <label htmlFor="setup-password">New password</label>
          <input
            id="setup-password"
            name="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-describedby="setup-error"
          />
          <label htmlFor="setup-confirm">Confirm password</label>
          <input
            id="setup-confirm"
            name="confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            aria-describedby="setup-error"
          />
          <div className="field-error">
            <p id="setup-error" role="alert">
              {error}
            </p>
          </div>
          <button type="submit" className="block" disabled={submitting}>
            {submitting ? "Saving..." : "Set password"}
          </button>
        </form>
      </div>
    </main>
  );
}

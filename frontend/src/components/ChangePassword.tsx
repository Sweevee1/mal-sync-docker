import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api, ApiError } from "../api/client";

const MIN_LENGTH = 12;

export default function ChangePassword() {
  const [managedByEnv, setManagedByEnv] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api
      .getSession()
      .then((s) => setManagedByEnv(s.passwordManagedByEnv === true))
      .catch(() => {});
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (next.length < MIN_LENGTH) {
      setMessage({ ok: false, text: `Use at least ${MIN_LENGTH} characters.` });
      return;
    }
    if (next !== confirm) {
      setMessage({ ok: false, text: "The two new passwords do not match." });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await api.changePassword(current, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      setMessage({ ok: true, text: "Password changed. Other browsers have been signed out." });
    } catch (err) {
      const text =
        err instanceof ApiError && (err.status === 401 || err.status === 409 || err.status === 429)
          ? err.message
          : "Could not change the password. Try again in a moment.";
      setMessage({ ok: false, text });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card">
      <h2>Password</h2>
      {managedByEnv ? (
        <p className="muted">
          Your password comes from the ADMIN_PASSWORD_HASH variable. Remove that variable and restart the container to
          manage the password here. The current password keeps working after you remove it.
        </p>
      ) : (
        <form className="stacked-form" onSubmit={handleSubmit}>
          <input type="text" name="username" autoComplete="username" tabIndex={-1} aria-hidden="true" className="sr-only" />
          <label>
            Current password
            <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </label>
          <label>
            New password
            <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          </label>
          <label>
            Confirm new password
            <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </label>
          <button type="submit" className="secondary" disabled={saving || !current || !next}>
            {saving ? "Saving..." : "Change password"}
          </button>
        </form>
      )}
      {message && (
        <p className={message.ok ? "form-status form-status-ok" : "form-status form-status-error"} role="status">
          {message.text}
        </p>
      )}
    </section>
  );
}

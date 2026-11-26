import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { api, ApiError } from "../api/client";

interface Props {
  notice?: string | null;
  onSuccess: () => void;
}

function waitText(seconds: number): string {
  if (seconds < 60) return `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {off && <path d="M4 4l16 16" />}
    </svg>
  );
}

export default function Login({ notice, onSuccess }: Props) {
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [throttledUntil, setThrottledUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (throttledUntil === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [throttledUntil]);

  const remaining = throttledUntil === null ? 0 : Math.max(0, Math.ceil((throttledUntil - now) / 1000));
  const throttled = remaining > 0;

  useEffect(() => {
    if (throttledUntil !== null && remaining === 0) {
      setThrottledUntil(null);
      setError(null);
    }
  }, [throttledUntil, remaining]);

  const bucket = !throttled ? null : remaining > 60 ? 61 : remaining > 30 ? 60 : remaining > 10 ? 30 : 10;
  const [announcement, setAnnouncement] = useState("");
  const prevBucket = useRef<number | null>(null);

  useEffect(() => {
    if (bucket !== null) {
      setAnnouncement(`Too many attempts. Try again in ${waitText(remaining)}.`);
    } else if (prevBucket.current !== null) {
      setAnnouncement("You can try signing in again.");
    }
    prevBucket.current = bucket;
    // Only coarse bucket changes are announced, not every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bucket]);

  const countdown = throttled ? `Too many attempts. Try again in ${waitText(remaining)}.` : null;
  const message = countdown ?? error;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting || throttled) return;
    if (!password) {
      setError("Enter your password.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.login(password);
      setPassword("");
      onSuccess();
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        const seconds = err.retryAfterSeconds ?? 60;
        setNow(Date.now());
        setThrottledUntil(Date.now() + seconds * 1000);
      } else if (err instanceof ApiError && err.status === 401) {
        setError("That password is not right.");
      } else if (err instanceof ApiError && err.status === 403) {
        setError("Sign in over HTTPS, or from your home network.");
      } else if (err instanceof ApiError && err.status === 0) {
        setError("Could not reach the server. Check that it is running.");
      } else {
        setError("Sign in failed. Try again in a moment.");
      }
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <div className="login-panel">
        <h1>MAL-Sync Docker</h1>
        <p className={notice ? "login-intro login-intro-tight" : "login-intro"}>Sign in to manage your MyAnimeList sync.</p>
        {notice && (
          <p className="login-notice" role="status">
            {notice}
          </p>
        )}
        <form onSubmit={handleSubmit} noValidate>
          <input type="text" name="username" autoComplete="username" tabIndex={-1} aria-hidden="true" className="sr-only" />
          <label htmlFor="login-password">Password</label>
          <div className="password-field">
            <input
              id="login-password"
              name="password"
              type={visible ? "text" : "password"}
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={message ? true : undefined}
              aria-describedby="login-error"
            />
            <button
              type="button"
              className="icon-button"
              onClick={() => setVisible((v) => !v)}
              aria-label="Show password"
              aria-pressed={visible}
            >
              <EyeIcon off={visible} />
            </button>
          </div>
          <div className="field-error">
            <p id="login-error" role="alert">
              {throttled ? "" : error}
            </p>
            {countdown && <p aria-hidden="true">{countdown}</p>}
            <p className="sr-only" role="status">
              {announcement}
            </p>
          </div>
          <button type="submit" className="block" disabled={submitting || throttled}>
            {submitting ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}

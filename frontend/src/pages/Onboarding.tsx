import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { StatusResponse } from "../api/types";
import ServiceIcon from "../components/ServiceIcon";

const PASSWORD_PLACEHOLDER = "<your password>";
const USERNAME_PLACEHOLDER = "<your username>";

// Single quotes stop the shell from expanding anything inside the value, so a
// password containing $, backticks, spaces or quotes survives intact.
function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildKitsuCurl(username: string, password: string) {
  return `curl -X POST https://kitsu.io/api/oauth/token \\
  -d grant_type=password \\
  --data-urlencode ${shellQuote(`username=${username}`)} \\
  --data-urlencode ${shellQuote(`password=${password}`)}`;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // navigator.clipboard is missing on plain HTTP origins other than localhost.
    const area = document.createElement("textarea");
    area.value = text;
    area.className = "offscreen";
    area.setAttribute("readonly", "");
    document.body.appendChild(area);
    area.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      document.body.removeChild(area);
    }
  }
}

const MAL_APP_DESCRIPTION = "Self-hosted tool that syncs your MyAnimeList lists to AniList and Kitsu.";
const ANILIST_APP_NAME = "MAL-Sync-Docker";

interface Message {
  ok: boolean;
  text: string;
}

function FormMessage({ message }: { message: Message | null }) {
  if (!message) return null;
  return (
    <p className={message.ok ? "form-status form-status-ok" : "form-status form-status-error"} role="status">
      {message.text}
    </p>
  );
}

export default function Onboarding() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await api.getStatus());
      setLoadError(null);
    } catch (err: any) {
      setLoadError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const [malClientId, setMalClientId] = useState("");
  const [malClientStatus, setMalClientStatus] = useState<Message | null>(null);
  const [malClientSaving, setMalClientSaving] = useState(false);

  async function handleMalClientSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMalClientSaving(true);
    setMalClientStatus(null);
    try {
      await api.setMalClient(malClientId.trim());
      setMalClientStatus({ ok: true, text: "Saved." });
      setMalClientId("");
      await load();
    } catch (err: any) {
      setMalClientStatus({ ok: false, text: `Could not save the Client ID. ${err.message}` });
    } finally {
      setMalClientSaving(false);
    }
  }

  const [anilistClientId, setAnilistClientId] = useState("");
  const [anilistClientSecret, setAnilistClientSecret] = useState("");
  const [anilistClientStatus, setAnilistClientStatus] = useState<Message | null>(null);
  const [anilistClientSaving, setAnilistClientSaving] = useState(false);

  async function handleAnilistClientSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAnilistClientSaving(true);
    setAnilistClientStatus(null);
    try {
      await api.setAnilistClient(anilistClientId.trim(), anilistClientSecret.trim());
      setAnilistClientStatus({ ok: true, text: "Saved." });
      setAnilistClientId("");
      await load();
    } catch (err: any) {
      setAnilistClientStatus({ ok: false, text: `Could not save the Client ID and secret. ${err.message}` });
    } finally {
      setAnilistClientSecret("");
      setAnilistClientSaving(false);
    }
  }

  const [kitsuTab, setKitsuTab] = useState<"password" | "token">("token");

  const [kitsuUsername, setKitsuUsername] = useState("");
  const [kitsuPassword, setKitsuPassword] = useState("");
  const [kitsuStatus, setKitsuStatus] = useState<Message | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [kitsuCliUsername, setKitsuCliUsername] = useState("");
  const [kitsuCliPassword, setKitsuCliPassword] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const copyTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(copyTimer.current), []);

  const [kitsuAccessToken, setKitsuAccessToken] = useState("");
  const [kitsuRefreshToken, setKitsuRefreshToken] = useState("");
  const [kitsuExpiresIn, setKitsuExpiresIn] = useState("");
  const [tokenStatus, setTokenStatus] = useState<Message | null>(null);
  const [tokenSubmitting, setTokenSubmitting] = useState(false);

  async function handleKitsuSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!status?.isSecure) return;
    setSubmitting(true);
    setKitsuStatus(null);
    try {
      await api.connectKitsu(kitsuUsername, kitsuPassword);
      setKitsuStatus({ ok: true, text: "Connected to Kitsu." });
      await load();
    } catch (err: any) {
      setKitsuStatus({ ok: false, text: `Could not connect to Kitsu. ${err.message}` });
    } finally {
      setKitsuPassword("");
      setSubmitting(false);
    }
  }

  async function handleKitsuTokenSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTokenSubmitting(true);
    setTokenStatus(null);
    try {
      const expiresInSeconds = kitsuExpiresIn.trim() ? Number(kitsuExpiresIn) : null;
      await api.connectKitsuToken(kitsuAccessToken.trim(), kitsuRefreshToken.trim(), expiresInSeconds);
      setTokenStatus({ ok: true, text: "Connected to Kitsu." });
      setKitsuAccessToken("");
      setKitsuRefreshToken("");
      setKitsuExpiresIn("");
      await load();
    } catch (err: any) {
      setTokenStatus({ ok: false, text: `Could not connect to Kitsu. ${err.message}` });
    } finally {
      setTokenSubmitting(false);
    }
  }

  async function handleCopy() {
    const ok = await copyText(buildKitsuCurl(kitsuCliUsername.trim(), kitsuCliPassword));
    setCopyState(ok ? "copied" : "failed");
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopyState("idle"), 2500);
  }

  function selectTab(tab: "password" | "token") {
    setKitsuTab(tab);
    setKitsuCliPassword("");
    setKitsuPassword("");
  }

  if (!status) {
    if (loadError) {
      return (
        <div>
          <h1>Connect Services</h1>
          <div className="alert alert-error" role="alert">
            <p>Could not load the connection status. {loadError}</p>
            <button type="button" className="secondary" onClick={load}>
              Try again
            </button>
          </div>
        </div>
      );
    }
    return (
      <div>
        <h1>Connect Services</h1>
        <p className="muted" role="status">
          Loading...
        </p>
      </div>
    );
  }

  const isSecure = status.isSecure;
  const malCallback = `${status.oauthCallbackBase}/api/auth/mal/callback`;
  const anilistCallback = `${status.oauthCallbackBase}/api/auth/anilist/callback`;
  const curlReady = kitsuCliUsername.trim() !== "" && kitsuCliPassword !== "";

  return (
    <div>
      <h1>Connect Services</h1>
      <p className="muted lead">
        MyAnimeList is the source. Connect it first, then AniList and Kitsu. Your lists are pushed to them on a
        schedule, or when you press Sync now.
      </p>

      <section className="card">
        <h2>
          <ServiceIcon service="mal" /> MyAnimeList
        </h2>
        <p>
          Create an app at{" "}
          <a href="https://myanimelist.net/apiconfig" target="_blank" rel="noreferrer">
            myanimelist.net/apiconfig
          </a>
          . Set App Type to "other" and use these values.
        </p>
        <p className="field-label">App Redirect URL</p>
        <pre className="code-block">{malCallback}</pre>
        <p className="field-label">App Description</p>
        <pre className="code-block">{MAL_APP_DESCRIPTION}</pre>
        <p className="field-label">Homepage URL</p>
        <pre className="code-block">{status.oauthCallbackBase}</pre>
        {status.services.mal.clientConfigured ? (
          <>
            <p className="muted">A Client ID is saved.</p>
            <form className="stacked-form" onSubmit={handleMalClientSubmit}>
              <label>
                Client ID
                <input
                  value={malClientId}
                  onChange={(e) => setMalClientId(e.target.value)}
                  placeholder="Paste a new Client ID to replace it"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <button type="submit" className="secondary" disabled={malClientSaving || !malClientId.trim()}>
                {malClientSaving ? "Saving..." : "Replace Client ID"}
              </button>
            </form>
            <FormMessage message={malClientStatus} />
            <a className="btn section-action" href="/api/auth/mal/start">
              Connect MyAnimeList
            </a>
          </>
        ) : (
          <>
            <form className="stacked-form" onSubmit={handleMalClientSubmit}>
              <label>
                Client ID
                <input
                  value={malClientId}
                  onChange={(e) => setMalClientId(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  required
                />
              </label>
              <button type="submit" disabled={malClientSaving}>
                {malClientSaving ? "Saving..." : "Save Client ID"}
              </button>
            </form>
            <FormMessage message={malClientStatus} />
          </>
        )}
      </section>

      <section className="card">
        <h2>
          <ServiceIcon service="anilist" /> AniList
        </h2>
        <p>
          Create an app at{" "}
          <a href="https://anilist.co/settings/developer" target="_blank" rel="noreferrer">
            anilist.co/settings/developer
          </a>{" "}
          with these values.
        </p>
        <p className="field-label">Name</p>
        <pre className="code-block">{ANILIST_APP_NAME}</pre>
        <p className="field-label">Redirect URL</p>
        <pre className="code-block">{anilistCallback}</pre>
        <p>
          <strong>Before connecting,</strong> set your AniList scoring format to "Point (10)" at{" "}
          <a href="https://anilist.co/settings" target="_blank" rel="noreferrer">
            anilist.co/settings
          </a>
          . This app copies MAL's 0 to 10 scores as they are and does not convert between formats.
        </p>
        {status.services.anilist.clientConfigured ? (
          <>
            <p className="muted">A Client ID and secret are saved.</p>
            <form className="stacked-form" onSubmit={handleAnilistClientSubmit}>
              <label>
                Client ID
                <input
                  value={anilistClientId}
                  onChange={(e) => setAnilistClientId(e.target.value)}
                  placeholder="Paste a new Client ID to replace it"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <label>
                Client Secret
                <input
                  type="password"
                  value={anilistClientSecret}
                  onChange={(e) => setAnilistClientSecret(e.target.value)}
                  placeholder="Paste a new secret to replace it"
                  autoComplete="off"
                />
              </label>
              <button
                type="submit"
                className="secondary"
                disabled={anilistClientSaving || !anilistClientId.trim() || !anilistClientSecret.trim()}
              >
                {anilistClientSaving ? "Saving..." : "Replace Client ID and secret"}
              </button>
            </form>
            <FormMessage message={anilistClientStatus} />
            <a className="btn section-action" href="/api/auth/anilist/start">
              Connect AniList
            </a>
          </>
        ) : (
          <>
            <form className="stacked-form" onSubmit={handleAnilistClientSubmit}>
              <label>
                Client ID
                <input
                  value={anilistClientId}
                  onChange={(e) => setAnilistClientId(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  required
                />
              </label>
              <label>
                Client Secret
                <input
                  type="password"
                  value={anilistClientSecret}
                  onChange={(e) => setAnilistClientSecret(e.target.value)}
                  autoComplete="off"
                  required
                />
              </label>
              <button type="submit" disabled={anilistClientSaving}>
                {anilistClientSaving ? "Saving..." : "Save Client ID and secret"}
              </button>
            </form>
            <FormMessage message={anilistClientStatus} />
          </>
        )}
      </section>

      <section className="card">
        <h2>
          <ServiceIcon service="kitsu" /> Kitsu
        </h2>
        <p>Kitsu does not need an app. Connect with your own login in one of two ways.</p>

        <div className="tab-bar" role="tablist" aria-label="Kitsu connection method">
          <button
            type="button"
            role="tab"
            aria-selected={kitsuTab === "token"}
            className={kitsuTab === "token" ? "tab active" : "tab"}
            onClick={() => selectTab("token")}
          >
            Local login
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={kitsuTab === "password"}
            className={kitsuTab === "password" ? "tab active" : "tab"}
            onClick={() => selectTab("password")}
          >
            Password (HTTPS)
          </button>
        </div>

        {kitsuTab === "password" ? (
          <div role="tabpanel">
            {isSecure ? (
              <p className="muted">
                Your password goes to this server once, to get a Kitsu token. It is stored encrypted and used again
                only to renew that token.
              </p>
            ) : (
              <p className="muted">
                This is turned off because the page is not on HTTPS, so your password would travel unencrypted. Use
                Local login instead, or put this app behind an HTTPS reverse proxy and set{" "}
                <code>TRUST_PROXY=true</code>.
              </p>
            )}
            <form className="stacked-form" onSubmit={handleKitsuSubmit}>
              <label>
                Username or email
                <input
                  value={kitsuUsername}
                  onChange={(e) => setKitsuUsername(e.target.value)}
                  autoComplete="off"
                  disabled={!isSecure}
                  required
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  value={kitsuPassword}
                  onChange={(e) => setKitsuPassword(e.target.value)}
                  autoComplete="off"
                  disabled={!isSecure}
                  required
                />
              </label>
              <button type="submit" disabled={!isSecure || submitting}>
                {submitting ? "Connecting..." : "Connect Kitsu"}
              </button>
            </form>
            <FormMessage message={kitsuStatus} />
          </div>
        ) : (
          <div role="tabpanel">
            <p className="muted">Type your Kitsu login to build the command below. Nothing here is sent to this server.</p>
            <div className="stacked-form">
              <label>
                Kitsu username or email
                <input
                  value={kitsuCliUsername}
                  onChange={(e) => setKitsuCliUsername(e.target.value)}
                  autoComplete="off"
                />
              </label>
              <label>
                Kitsu password
                <input
                  type="password"
                  value={kitsuCliPassword}
                  onChange={(e) => setKitsuCliPassword(e.target.value)}
                  autoComplete="off"
                />
              </label>
            </div>
            <p className="muted">
              Run this command on your own machine. It talks to Kitsu directly, so your password never reaches this
              server. The password stays hidden here, but Copy puts the full command on your clipboard.
            </p>
            <pre className="code-block">
              {buildKitsuCurl(kitsuCliUsername.trim() || USERNAME_PLACEHOLDER, PASSWORD_PLACEHOLDER)}
            </pre>
            <div className="button-row">
              <button type="button" className="secondary" onClick={handleCopy} disabled={!curlReady}>
                {copyState === "copied" ? "Copied" : "Copy command"}
              </button>
              <span className="muted" role="status">
                {copyState === "copied" && "Copied to your clipboard."}
                {copyState === "failed" && "Copy failed. Your browser blocked clipboard access."}
                {copyState === "idle" && !curlReady && "Fill in both fields to copy the command."}
              </span>
            </div>
            <p className="muted">
              The reply is JSON with <code>access_token</code>, <code>refresh_token</code> and{" "}
              <code>expires_in</code> (in seconds). Paste them below. With a refresh token, this app renews the access
              token on its own. Without one, or once it stops working, come back and paste fresh tokens.
            </p>
            <form className="stacked-form" onSubmit={handleKitsuTokenSubmit}>
              <label>
                Access token
                <input
                  type="password"
                  value={kitsuAccessToken}
                  onChange={(e) => setKitsuAccessToken(e.target.value)}
                  autoComplete="off"
                  required
                />
              </label>
              <label>
                Refresh token (optional, recommended)
                <input
                  type="password"
                  value={kitsuRefreshToken}
                  onChange={(e) => setKitsuRefreshToken(e.target.value)}
                  autoComplete="off"
                />
              </label>
              <label>
                Expires in, seconds (optional)
                <input
                  type="number"
                  min={1}
                  value={kitsuExpiresIn}
                  onChange={(e) => setKitsuExpiresIn(e.target.value)}
                />
              </label>
              <button type="submit" disabled={tokenSubmitting}>
                {tokenSubmitting ? "Connecting..." : "Connect Kitsu"}
              </button>
            </form>
            <FormMessage message={tokenStatus} />
          </div>
        )}
      </section>
    </div>
  );
}

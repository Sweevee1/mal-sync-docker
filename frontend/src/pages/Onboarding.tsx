import { useEffect, useState } from "react";
import { api } from "../api/client";

const KITSU_CURL = `curl -X POST https://kitsu.io/api/oauth/token \\
  -d grant_type=password \\
  -d username=YOUR_KITSU_USERNAME \\
  -d password=YOUR_KITSU_PASSWORD`;

export default function Onboarding() {
  // null while we haven't confirmed the connection is HTTPS yet; treated the
  // same as false so the password tab stays hidden until we know for sure.
  const [isSecure, setIsSecure] = useState<boolean | null>(null);

  useEffect(() => {
    api
      .getStatus()
      .then((s) => setIsSecure(s.isSecure))
      .catch(() => setIsSecure(false));
  }, []);

  const [kitsuTab, setKitsuTab] = useState<"password" | "token">("token");

  const [kitsuUsername, setKitsuUsername] = useState("");
  const [kitsuPassword, setKitsuPassword] = useState("");
  const [kitsuStatus, setKitsuStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [kitsuAccessToken, setKitsuAccessToken] = useState("");
  const [kitsuRefreshToken, setKitsuRefreshToken] = useState("");
  const [kitsuExpiresIn, setKitsuExpiresIn] = useState("");
  const [tokenStatus, setTokenStatus] = useState<string | null>(null);
  const [tokenSubmitting, setTokenSubmitting] = useState(false);

  async function handleKitsuSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setKitsuStatus(null);
    try {
      await api.connectKitsu(kitsuUsername, kitsuPassword);
      setKitsuStatus("Connected to Kitsu.");
      setKitsuPassword("");
    } catch (err: any) {
      setKitsuStatus(`Failed: ${err.message}`);
    } finally {
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
      setTokenStatus("Connected to Kitsu.");
      setKitsuAccessToken("");
      setKitsuRefreshToken("");
      setKitsuExpiresIn("");
    } catch (err: any) {
      setTokenStatus(`Failed: ${err.message}`);
    } finally {
      setTokenSubmitting(false);
    }
  }

  return (
    <div>
      <h1>Connect Services</h1>
      <p className="muted">
        MyAnimeList is the source of truth. Once connected, its anime and manga lists are pushed to AniList and
        Kitsu on your configured schedule (or whenever you hit "Sync now").
      </p>

      <section className="card">
        <h2>1. MyAnimeList</h2>
        <p>
          Register a client at{" "}
          <a href="https://myanimelist.net/apiconfig" target="_blank" rel="noreferrer">
            myanimelist.net/apiconfig
          </a>
          . Choose App Type "other": no client secret is needed, since this app uses the PKCE flow. Put the client ID
          in this app's <code>MAL_CLIENT_ID</code> environment variable and set the redirect URI to match{" "}
          <code>MAL_REDIRECT_URI</code>.
        </p>
        <button onClick={() => (window.location.href = "/api/auth/mal/start")}>Connect MyAnimeList</button>
      </section>

      <section className="card">
        <h2>2. AniList</h2>
        <p>
          Register an app at{" "}
          <a href="https://anilist.co/settings/developer" target="_blank" rel="noreferrer">
            anilist.co/settings/developer
          </a>
          , then set <code>ANILIST_CLIENT_ID</code> and <code>ANILIST_CLIENT_SECRET</code>.
        </p>
        <p>
          <strong>Important:</strong> before connecting, set your AniList scoring format to "Point (10)" at{" "}
          <a href="https://anilist.co/settings" target="_blank" rel="noreferrer">
            anilist.co/settings
          </a>
          . This app pushes MAL's 0-10 scores as-is, without converting between scoring formats.
        </p>
        <button onClick={() => (window.location.href = "/api/auth/anilist/start")}>Connect AniList</button>
      </section>

      <section className="card">
        <h2>3. Kitsu</h2>
        <p>No app registration is needed for Kitsu.</p>

        <div className="tab-bar">
          {isSecure && (
            <button
              type="button"
              className={kitsuTab === "password" ? "tab active" : "tab"}
              onClick={() => setKitsuTab("password")}
            >
              Username &amp; password
            </button>
          )}
          <button
            type="button"
            className={kitsuTab === "token" ? "tab active" : "tab"}
            onClick={() => setKitsuTab("token")}
          >
            Paste a token
          </button>
        </div>

        {!isSecure && (
          <p className="muted">
            Password login is unavailable on this connection because it isn't HTTPS, so it would send your Kitsu
            password in the clear. Use the token method below, or put this app behind an HTTPS reverse proxy and
            set <code>TRUST_PROXY=true</code> to unlock password login.
          </p>
        )}

        {kitsuTab === "password" && isSecure ? (
          <>
            <p className="muted">
              Your password is sent directly to this server and used once to obtain a Kitsu API token. It's
              encrypted at rest and only used again automatically if that token needs to be refreshed.
            </p>
            <form className="stacked-form" onSubmit={handleKitsuSubmit}>
              <label>
                Username or email
                <input value={kitsuUsername} onChange={(e) => setKitsuUsername(e.target.value)} required />
              </label>
              <label>
                Password
                <input
                  type="password"
                  value={kitsuPassword}
                  onChange={(e) => setKitsuPassword(e.target.value)}
                  required
                />
              </label>
              <button type="submit" disabled={submitting}>
                {submitting ? "Connecting..." : "Connect Kitsu"}
              </button>
            </form>
            {kitsuStatus && <p>{kitsuStatus}</p>}
          </>
        ) : (
          <>
            <p className="muted">
              Run this yourself, from your own machine, against Kitsu's real HTTPS endpoint, so your password never
              reaches this server at all:
            </p>
            <pre className="code-block">{KITSU_CURL}</pre>
            <p className="muted">
              The response is JSON with <code>access_token</code>, <code>refresh_token</code>, and{" "}
              <code>expires_in</code> (seconds). Paste them below. If you provide a refresh token, this app can
              renew the access token on its own; if not, or once the refresh token stops working, you'll need to
              come back and paste a fresh one.
            </p>
            <form className="stacked-form" onSubmit={handleKitsuTokenSubmit}>
              <label>
                Access token
                <input value={kitsuAccessToken} onChange={(e) => setKitsuAccessToken(e.target.value)} required />
              </label>
              <label>
                Refresh token (optional, recommended)
                <input value={kitsuRefreshToken} onChange={(e) => setKitsuRefreshToken(e.target.value)} />
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
            {tokenStatus && <p>{tokenStatus}</p>}
          </>
        )}
      </section>
    </div>
  );
}

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { StatusResponse } from "../api/types";
import ServiceStatusCard from "../components/ServiceStatusCard";
import LiveSyncLog from "../components/LiveSyncLog";

const OAUTH_ERRORS: Record<string, string> = {
  state_invalid: "The sign-in expired or did not match. Start the connection again from the beginning.",
  mal_failed: "MyAnimeList did not accept the connection. Check the Client ID on Connect Services, then try again.",
  anilist_failed:
    "AniList did not accept the connection. Check the Client ID and secret on Connect Services, then try again.",
};
const OAUTH_ERROR_FALLBACK = "Sign-in with the service did not complete.";

const OAUTH_CONNECTED: Record<string, string> = {
  mal: "MyAnimeList is connected.",
  anilist: "AniList is connected.",
};

const SERVICE_NAMES = { MAL: "MyAnimeList", ANILIST: "AniList", KITSU: "Kitsu" } as const;

const RUN_STATUS_LABELS = {
  RUNNING: "Running",
  SUCCESS: "Succeeded",
  PARTIAL_FAILURE: "Partly failed",
  FAILED: "Failed",
} as const;

const RUN_STATUS_CLASS = {
  RUNNING: "badge badge-neutral",
  SUCCESS: "badge badge-ok",
  PARTIAL_FAILURE: "badge badge-warn",
  FAILED: "badge badge-error",
} as const;

export default function Dashboard() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [intervalInput, setIntervalInput] = useState<string>("");
  const [savingInterval, setSavingInterval] = useState(false);
  const [intervalSaved, setIntervalSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.getStatus();
      setStatus(data);
      setSyncing(data.syncing);
      setLoadError(null);
      setIntervalInput((current) => (current === "" ? String(data.syncIntervalMinutes) : current));
    } catch (err: any) {
      setLoadError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
    const params = new URLSearchParams(window.location.search);
    const code = params.get("error");
    const connected = params.get("connected");
    // hasOwnProperty: a code like "__proto__" would otherwise resolve to Object.prototype.
    if (code !== null) setError(Object.prototype.hasOwnProperty.call(OAUTH_ERRORS, code) ? OAUTH_ERRORS[code] : OAUTH_ERROR_FALLBACK);
    if (connected !== null && Object.prototype.hasOwnProperty.call(OAUTH_CONNECTED, connected)) setSuccess(OAUTH_CONNECTED[connected]);
    if (code !== null || connected !== null) window.history.replaceState(null, "", window.location.pathname);
  }, [load]);

  useEffect(() => {
    if (!syncing) return;
    const id = setInterval(load, 2000);
    return () => clearInterval(id);
  }, [syncing, load]);

  async function startRun(action: () => Promise<unknown>) {
    setError(null);
    setSuccess(null);
    try {
      await action();
      setSyncing(true);
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleDisconnect(service: "MAL" | "ANILIST" | "KITSU") {
    if (!confirm(`Disconnect ${SERVICE_NAMES[service]}? You will need to connect it again before it syncs.`)) return;
    try {
      await api.disconnectService(service);
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleSaveInterval(e: React.FormEvent) {
    e.preventDefault();
    setSavingInterval(true);
    setIntervalSaved(false);
    try {
      await api.updateSettings(Number(intervalInput));
      setIntervalSaved(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingInterval(false);
    }
  }

  if (!status) {
    if (loadError) {
      return (
        <div>
          <h1>Dashboard</h1>
          <div className="alert alert-error" role="alert">
            <p>Could not load the dashboard. {loadError}</p>
            <button type="button" className="secondary" onClick={load}>
              Try again
            </button>
          </div>
        </div>
      );
    }
    return (
      <div>
        <h1>Dashboard</h1>
        <p className="muted" role="status">
          Loading your connections...
        </p>
      </div>
    );
  }

  const { services, lastSync } = status;
  const canRun = !syncing && services.mal.connected;
  const needsClient = (s: { connected: boolean; clientConfigured: boolean }) => !s.connected && !s.clientConfigured;

  return (
    <div>
      <h1>Dashboard</h1>
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      {success && (
        <div className="alert alert-success" role="status">
          {success}
        </div>
      )}
      {loadError && (
        <div className="alert alert-error" role="alert">
          <p>Could not refresh the status. {loadError}</p>
          <button type="button" className="secondary" onClick={load}>
            Try again
          </button>
        </div>
      )}

      <section className="card-grid" aria-label="Connected services">
        <ServiceStatusCard
          name="MyAnimeList"
          icon="mal"
          status={services.mal}
          primary
          {...(needsClient(services.mal) ? { connectTo: "/settings" } : { connectHref: "/api/auth/mal/start" })}
          connectLabel={needsClient(services.mal) ? "Add Client ID" : undefined}
          onDisconnect={() => handleDisconnect("MAL")}
        />
        <ServiceStatusCard
          name="AniList"
          icon="anilist"
          status={services.anilist}
          {...(needsClient(services.anilist)
            ? { connectTo: "/settings" }
            : { connectHref: "/api/auth/anilist/start" })}
          connectLabel={needsClient(services.anilist) ? "Add Client ID" : undefined}
          onDisconnect={() => handleDisconnect("ANILIST")}
        />
        <ServiceStatusCard
          name="Kitsu"
          icon="kitsu"
          status={services.kitsu}
          connectLabel="Set up"
          connectTo="/settings"
          onDisconnect={() => handleDisconnect("KITSU")}
        />
      </section>

      <section className="card">
        <h2>Sync</h2>
        <div className="button-row">
          <button onClick={() => startRun(() => api.triggerSync(false))} disabled={!canRun}>
            Sync now
          </button>
          <button className="secondary" onClick={() => startRun(() => api.triggerCheck())} disabled={!canRun}>
            Check sync
          </button>
          <button className="secondary" onClick={() => startRun(() => api.triggerSync(true))} disabled={!canRun}>
            Dry run
          </button>
        </div>
        {syncing && (
          <p className="muted" role="status">
            A run is in progress. The buttons come back when it finishes.
          </p>
        )}
        {!services.mal.connected && (
          <p className="muted">
            Connect MyAnimeList first. <Link to="/settings">Go to Connect Services</Link>
          </p>
        )}
        <ul className="help-list">
          <li>
            <strong>Sync now</strong> pushes changes from MAL to AniList and Kitsu.
          </li>
          <li>
            <strong>Check sync</strong> compares MAL with what AniList and Kitsu hold today and lists the
            differences. It changes nothing, including local sync status.
          </li>
          <li>
            <strong>Dry run</strong> reads from MAL, AniList and Kitsu to show what Sync now would push. It writes
            nothing.
          </li>
        </ul>
      </section>

      <section className="card">
        <h2>Last run</h2>
        {lastSync ? (
          <>
            <p className="run-summary">
              <span className="num">Run #{lastSync.id}</span>
              <span className="muted">
                {lastSync.trigger.replace("_", " ").toLowerCase()}, started{" "}
                <span className="num">{new Date(lastSync.startedAt).toLocaleString()}</span>
              </span>
              <span className={RUN_STATUS_CLASS[lastSync.status]}>{RUN_STATUS_LABELS[lastSync.status]}</span>
            </p>
            {lastSync.errorMessage && <p className="error-detail">{lastSync.errorMessage}</p>}
            {lastSync.trigger === "DRY_RUN" ? (
              <p className="muted">
                <span className="badge badge-neutral">Dry run: nothing was pushed</span>{" "}
                <span className="num">
                  {lastSync.pushedCount} would push · {lastSync.skippedCount} skipped · {lastSync.errorCount} errors
                </span>
              </p>
            ) : lastSync.trigger === "CHECK" ? (
              <p className="muted">
                <span className="badge badge-neutral">Check: read-only, nothing changed</span>{" "}
                <span className="num">
                  {lastSync.pushedCount} match · {lastSync.skippedCount} need attention · {lastSync.errorCount}{" "}
                  errors
                </span>
              </p>
            ) : (
              <p className="muted num">
                {lastSync.pushedCount} pushed · {lastSync.skippedCount} skipped · {lastSync.errorCount} errors
              </p>
            )}
            <LiveSyncLog runId={lastSync.id} active={syncing} />
          </>
        ) : (
          <p className="muted">
            Nothing has run yet.{" "}
            {services.mal.connected
              ? "Press Sync now to start the first one."
              : "Connect MyAnimeList, then run your first sync."}
          </p>
        )}
      </section>

      <section className="card">
        <h2>Sync interval</h2>
        <form className="inline-form" onSubmit={handleSaveInterval}>
          <label>
            Sync every
            <input
              type="number"
              min={1}
              value={intervalInput}
              onChange={(e) => {
                setIntervalInput(e.target.value);
                setIntervalSaved(false);
              }}
            />
            minutes
          </label>
          <button type="submit" disabled={savingInterval}>
            {savingInterval ? "Saving..." : "Save"}
          </button>
          {intervalSaved && (
            <span className="muted" role="status">
              Saved.
            </span>
          )}
        </form>
      </section>
    </div>
  );
}

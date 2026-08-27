import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import type { StatusResponse } from "../api/types";
import ServiceStatusCard from "../components/ServiceStatusCard";
import LiveSyncLog from "../components/LiveSyncLog";

export default function Dashboard() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [intervalInput, setIntervalInput] = useState<string>("");
  const [savingInterval, setSavingInterval] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.getStatus();
      setStatus(data);
      setSyncing(data.syncing);
      setIntervalInput(String(data.syncIntervalMinutes));
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
    const params = new URLSearchParams(window.location.search);
    const err = params.get("error");
    if (err) setError(err);
  }, [load]);

  useEffect(() => {
    if (!syncing) return;
    const id = setInterval(load, 2000);
    return () => clearInterval(id);
  }, [syncing, load]);

  async function handleSyncNow(dryRun: boolean) {
    setError(null);
    try {
      await api.triggerSync(dryRun);
      setSyncing(true);
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleCheck() {
    setError(null);
    try {
      await api.triggerCheck();
      setSyncing(true);
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleDisconnect(service: "MAL" | "ANILIST" | "KITSU") {
    if (!confirm(`Disconnect ${service}?`)) return;
    await api.disconnectService(service);
    load();
  }

  async function handleSaveInterval(e: React.FormEvent) {
    e.preventDefault();
    setSavingInterval(true);
    try {
      await api.updateSettings(Number(intervalInput));
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingInterval(false);
    }
  }

  if (!status) return <p>Loading...</p>;

  const { services, lastSync } = status;

  return (
    <div>
      <h1>Dashboard</h1>
      {error && <div className="alert alert-error">{error}</div>}

      <section className="card-grid">
        <ServiceStatusCard
          name="MyAnimeList"
          icon="mal"
          status={services.mal}
          primary
          onConnect={() => (window.location.href = "/api/auth/mal/start")}
          onDisconnect={() => handleDisconnect("MAL")}
        />
        <ServiceStatusCard
          name="AniList"
          icon="anilist"
          status={services.anilist}
          onConnect={() => (window.location.href = "/api/auth/anilist/start")}
          onDisconnect={() => handleDisconnect("ANILIST")}
        />
        <ServiceStatusCard
          name="Kitsu"
          icon="kitsu"
          status={services.kitsu}
          connectLabel="Set up"
          onConnect={() => (window.location.href = "/settings")}
          onDisconnect={() => handleDisconnect("KITSU")}
        />
      </section>

      <section className="card">
        <h2>Sync</h2>
        <button onClick={() => handleSyncNow(false)} disabled={syncing || !services.mal.connected}>
          {syncing ? "Syncing..." : "Sync now"}
        </button>{" "}
        <button onClick={handleCheck} disabled={syncing || !services.mal.connected}>
          {syncing ? "Syncing..." : "Check sync"}
        </button>{" "}
        <button onClick={() => handleSyncNow(true)} disabled={syncing || !services.mal.connected}>
          {syncing ? "Syncing..." : "Dry run"}
        </button>
        <p className="muted">Dry run tests MAL, AniList, and Kitsu connectivity for real, but never pushes changes.</p>
        <p className="muted">
          Check compares MAL against AniList/Kitsu's actual current entries and reports matches/mismatches; also
          read-only, doesn't touch local sync status either.
        </p>
      </section>

      <section className="card">
        <h2>Last run</h2>
        {lastSync ? (
          <>
            <p className="muted">
              {`Last run #${lastSync.id} (${lastSync.trigger.replace("_", " ").toLowerCase()}) · ${lastSync.status} at ${new Date(
                lastSync.startedAt
              ).toLocaleString()}`}
            </p>
            {lastSync.trigger === "DRY_RUN" ? (
              <p className="muted">
                <span className="badge badge-neutral">Dry run — nothing was pushed</span>{" "}
                {lastSync.pushedCount} would push · {lastSync.skippedCount} skipped · {lastSync.errorCount} errors
              </p>
            ) : lastSync.trigger === "CHECK" ? (
              <p className="muted">
                <span className="badge badge-neutral">Check — read-only, nothing changed</span>{" "}
                {lastSync.pushedCount} match · {lastSync.skippedCount} need attention · {lastSync.errorCount} errors
              </p>
            ) : (
              <p className="muted">
                {lastSync.pushedCount} pushed · {lastSync.skippedCount} skipped · {lastSync.errorCount} errors
              </p>
            )}
            <LiveSyncLog runId={lastSync.id} active={syncing} />
          </>
        ) : (
          <p className="muted">No sync has run yet.</p>
        )}
      </section>

      <section className="card">
        <h2>Sync interval</h2>
        <form className="inline-form" onSubmit={handleSaveInterval}>
          <label>
            Every
            <input
              type="number"
              min={1}
              value={intervalInput}
              onChange={(e) => setIntervalInput(e.target.value)}
            />
            minutes
          </label>
          <button type="submit" disabled={savingInterval}>
            Save
          </button>
        </form>
      </section>
    </div>
  );
}

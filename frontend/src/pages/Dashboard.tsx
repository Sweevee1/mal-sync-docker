import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { StatusResponse } from "../api/types";
import ServiceStatusCard from "../components/ServiceStatusCard";

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

  async function handleSyncNow() {
    setError(null);
    try {
      await api.triggerSync();
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
          status={services.mal}
          onConnect={() => (window.location.href = "/api/auth/mal/start")}
          onDisconnect={() => handleDisconnect("MAL")}
        />
        <ServiceStatusCard
          name="AniList"
          status={services.anilist}
          onConnect={() => (window.location.href = "/api/auth/anilist/start")}
          onDisconnect={() => handleDisconnect("ANILIST")}
        />
        <ServiceStatusCard
          name="Kitsu"
          status={services.kitsu}
          connectLabel="Set up"
          onConnect={() => (window.location.href = "/onboarding")}
          onDisconnect={() => handleDisconnect("KITSU")}
        />
      </section>

      {!services.mal.connected && (
        <div className="alert alert-info">
          Connect MyAnimeList first. It's the source of truth for everything this app syncs.{" "}
          <Link to="/onboarding">Get started</Link>
        </div>
      )}

      <section className="card">
        <h2>Sync</h2>
        <p className="muted">
          {lastSync
            ? `Last run #${lastSync.id} (${lastSync.trigger.toLowerCase()}) · ${lastSync.status} at ${new Date(
                lastSync.startedAt
              ).toLocaleString()}`
            : "No sync has run yet."}
        </p>
        {lastSync && (
          <p className="muted">
            {lastSync.pushedCount} pushed · {lastSync.skippedCount} skipped · {lastSync.errorCount} errors
          </p>
        )}
        <button onClick={handleSyncNow} disabled={syncing || !services.mal.connected}>
          {syncing ? "Syncing..." : "Sync now"}
        </button>
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

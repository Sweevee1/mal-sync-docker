import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import type { ListEntry } from "../api/types";
import EntryStatusBadge from "../components/EntryStatusBadge";

export default function Library() {
  const [entries, setEntries] = useState<ListEntry[]>([]);
  const [pendingDeletions, setPendingDeletions] = useState<ListEntry[]>([]);
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [entriesRes, pendingRes] = await Promise.all([
        api.getEntries(typeFilter ? { type: typeFilter } : {}),
        api.getPendingDeletions(),
      ]);
      setEntries(entriesRes.entries);
      setPendingDeletions(pendingRes.entries);
    } catch (err: any) {
      setError(err.message);
    }
  }, [typeFilter]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleConfirmDeletion(entry: ListEntry, service: "ANILIST" | "KITSU") {
    if (!confirm(`Remove "${entry.title}" from ${service === "ANILIST" ? "AniList" : "Kitsu"}? This cannot be undone.`)) {
      return;
    }
    try {
      await api.confirmDeletion(entry.mediaType, entry.malId, service);
      load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleDismissDeletion(entry: ListEntry, service: "ANILIST" | "KITSU") {
    try {
      await api.dismissDeletion(entry.mediaType, entry.malId, service);
      load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <div>
      <h1>Library</h1>
      {error && <div className="alert alert-error">{error}</div>}

      {pendingDeletions.length > 0 && (
        <section className="card">
          <h2>Pending removals</h2>
          <p className="muted">
            These entries were removed from your MAL list. Confirm to delete them from the target service, or
            dismiss to leave them as-is there.
          </p>
          <table className="table">
            <thead>
              <tr>
                <th>Title</th>
                <th>AniList</th>
                <th>Kitsu</th>
              </tr>
            </thead>
            <tbody>
              {pendingDeletions.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.title}</td>
                  <td>
                    {entry.anilistSyncStatus === "PENDING_DELETION" ? (
                      <div className="row-actions">
                        <button onClick={() => handleConfirmDeletion(entry, "ANILIST")}>Delete</button>
                        <button className="secondary" onClick={() => handleDismissDeletion(entry, "ANILIST")}>
                          Keep
                        </button>
                      </div>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td>
                    {entry.kitsuSyncStatus === "PENDING_DELETION" ? (
                      <div className="row-actions">
                        <button onClick={() => handleConfirmDeletion(entry, "KITSU")}>Delete</button>
                        <button className="secondary" onClick={() => handleDismissDeletion(entry, "KITSU")}>
                          Keep
                        </button>
                      </div>
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="card">
        <div className="filter-bar">
          <label>
            Type
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="">All</option>
              <option value="ANIME">Anime</option>
              <option value="MANGA">Manga</option>
            </select>
          </label>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Type</th>
              <th>MAL status</th>
              <th>Progress</th>
              <th>Score</th>
              <th>AniList</th>
              <th>Kitsu</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td>{entry.title}</td>
                <td>{entry.mediaType}</td>
                <td>{entry.status}</td>
                <td>{entry.progress}</td>
                <td>{entry.score || "-"}</td>
                <td>
                  <EntryStatusBadge status={entry.anilistSyncStatus} />
                  {entry.anilistLastError && <div className="error-detail">{entry.anilistLastError}</div>}
                </td>
                <td>
                  <EntryStatusBadge status={entry.kitsuSyncStatus} />
                  {entry.kitsuLastError && <div className="error-detail">{entry.kitsuLastError}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {entries.length === 0 && <p className="muted">No entries yet. Run a sync to populate your library.</p>}
      </section>
    </div>
  );
}

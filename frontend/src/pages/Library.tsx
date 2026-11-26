import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { ListEntry } from "../api/types";
import EntryStatusBadge from "../components/EntryStatusBadge";

export default function Library() {
  const [entries, setEntries] = useState<ListEntry[]>([]);
  const [pendingDeletions, setPendingDeletions] = useState<ListEntry[]>([]);
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [entriesRes, pendingRes] = await Promise.all([
        api.getEntries(typeFilter ? { type: typeFilter } : {}),
        api.getPendingDeletions(),
      ]);
      setEntries(entriesRes.entries);
      setPendingDeletions(pendingRes.entries);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoaded(true);
    }
  }, [typeFilter]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleConfirmDeletion(entry: ListEntry, service: "ANILIST" | "KITSU") {
    const name = service === "ANILIST" ? "AniList" : "Kitsu";
    if (!confirm(`Remove "${entry.title}" from ${name}? This cannot be undone.`)) {
      return;
    }
    setActionError(null);
    try {
      await api.confirmDeletion(entry.mediaType, entry.malId, service);
      load();
    } catch (err: any) {
      setActionError(err.message);
    }
  }

  async function handleDismissDeletion(entry: ListEntry, service: "ANILIST" | "KITSU") {
    setActionError(null);
    try {
      await api.dismissDeletion(entry.mediaType, entry.malId, service);
      load();
    } catch (err: any) {
      setActionError(err.message);
    }
  }

  const filterLabel = typeFilter === "ANIME" ? "anime" : "manga";

  return (
    <div>
      <h1>Library</h1>
      {actionError && (
        <div className="alert alert-error" role="alert">
          {actionError}
        </div>
      )}

      {pendingDeletions.length > 0 && (
        <section className="card">
          <h2>Pending removals</h2>
          <p className="muted">
            These entries are gone from your MAL list. Delete removes one from AniList or Kitsu. Keep leaves it
            there and stops tracking it here.
          </p>
          <div className="table-wrap">
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
                          <button className="danger" onClick={() => handleConfirmDeletion(entry, "ANILIST")}>
                            Delete
                          </button>
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
                          <button className="danger" onClick={() => handleConfirmDeletion(entry, "KITSU")}>
                            Delete
                          </button>
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
          </div>
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

        {error ? (
          <div className="state state-error" role="alert">
            <p>Could not load your library. {error}</p>
            <button type="button" className="secondary" onClick={load}>
              Try again
            </button>
          </div>
        ) : !loaded ? (
          <p className="muted" role="status">
            Loading your library...
          </p>
        ) : entries.length === 0 ? (
          <div className="state">
            {typeFilter ? (
              <>
                <p>No {filterLabel} entries yet.</p>
                <button type="button" className="secondary" onClick={() => setTypeFilter("")}>
                  Show all types
                </button>
              </>
            ) : (
              <>
                <p>Your library is empty. It fills in after the first sync reads your MAL lists.</p>
                <Link className="btn secondary" to="/">
                  Go to Dashboard
                </Link>
              </>
            )}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Type</th>
                  <th>MAL status</th>
                  <th className="num-col">Progress</th>
                  <th className="num-col">Score</th>
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
                    <td className="num-col">{entry.progress}</td>
                    <td className="num-col">{entry.score || "-"}</td>
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
          </div>
        )}
      </section>
    </div>
  );
}

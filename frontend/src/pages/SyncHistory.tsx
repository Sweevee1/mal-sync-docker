import { Fragment, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { SyncRun, SyncRunEntry } from "../api/types";
import SyncRunRow from "../components/SyncRunRow";

export default function SyncHistory() {
  const [runs, setRuns] = useState<SyncRun[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [runEntries, setRunEntries] = useState<SyncRunEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.getSyncHistory();
      setRuns(res.runs);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function toggle(id: number) {
    setDetailError(null);
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    try {
      const res = await api.getSyncRunDetail(id);
      setRunEntries(res.run.entries);
      setExpandedId(id);
    } catch (err: any) {
      setDetailError(`Could not load the details for run #${id}. ${err.message}`);
    }
  }

  return (
    <div>
      <h1>Sync History</h1>
      {detailError && (
        <div className="alert alert-error" role="alert">
          {detailError}
        </div>
      )}

      <section className="card">
        {error ? (
          <div className="state state-error" role="alert">
            <p>Could not load the sync history. {error}</p>
            <button type="button" className="secondary" onClick={load}>
              Try again
            </button>
          </div>
        ) : !loaded ? (
          <p className="muted" role="status">
            Loading sync history...
          </p>
        ) : runs.length === 0 ? (
          <div className="state">
            <p>No runs yet. Every sync, check and dry run will be listed here.</p>
            <Link className="btn secondary" to="/">
              Go to Dashboard
            </Link>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Run</th>
                  <th className="col-trigger">Trigger</th>
                  <th>Started</th>
                  <th>Status</th>
                  <th className="num-col">Entries</th>
                  <th className="num-col">Pushed</th>
                  <th className="num-col">Skipped</th>
                  <th className="num-col">Errors</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <Fragment key={run.id}>
                    <SyncRunRow run={run} expanded={expandedId === run.id} onToggle={() => toggle(run.id)} />
                    {expandedId === run.id && (
                      <tr className="detail-row">
                        <td colSpan={8}>
                          {run.errorMessage && (
                            <div className="alert alert-error" role="alert">
                              {run.errorMessage}
                            </div>
                          )}
                          {runEntries.length === 0 ? (
                            <p className="muted">This run did not process any entries.</p>
                          ) : (
                            <div className="table-wrap">
                              <table className="table nested-table">
                                <thead>
                                  <tr>
                                    <th>Title</th>
                                    <th>Type</th>
                                    <th>Service</th>
                                    <th>Outcome</th>
                                    <th>Detail</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {runEntries.map((e) => (
                                    <tr key={e.id}>
                                      <td>{e.title}</td>
                                      <td>{e.mediaType}</td>
                                      <td>{e.service}</td>
                                      <td>{e.outcome.replace("_", " ")}</td>
                                      <td>{e.detail ?? "-"}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

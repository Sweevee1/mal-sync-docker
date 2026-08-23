import { Fragment, useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import type { SyncRun, SyncRunEntry } from "../api/types";
import SyncRunRow from "../components/SyncRunRow";

export default function SyncHistory() {
  const [runs, setRuns] = useState<SyncRun[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [runEntries, setRunEntries] = useState<SyncRunEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.getSyncHistory();
      setRuns(res.runs);
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function toggle(id: number) {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    try {
      const res = await api.getSyncRunDetail(id);
      setRunEntries(res.run.entries);
      setExpandedId(id);
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <div>
      <h1>Sync History</h1>
      {error && <div className="alert alert-error">{error}</div>}

      <section className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Run</th>
              <th>Trigger</th>
              <th>Started</th>
              <th>Status</th>
              <th>Entries</th>
              <th>Pushed</th>
              <th>Skipped</th>
              <th>Errors</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <Fragment key={run.id}>
                <SyncRunRow run={run} expanded={expandedId === run.id} onToggle={() => toggle(run.id)} />
                {expandedId === run.id && (
                  <tr key={`${run.id}-detail`}>
                    <td colSpan={8}>
                      {run.errorMessage && <div className="alert alert-error">{run.errorMessage}</div>}
                      {runEntries.length === 0 ? (
                        <p className="muted">No per-entry activity for this run.</p>
                      ) : (
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
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {runs.length === 0 && <p className="muted">No sync runs yet.</p>}
      </section>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { ListEntry, SyncRunEntry } from "../api/types";

const POLL_MS = 2000;

const STATUS_LABELS: Record<string, string> = {
  watching: "Watching",
  reading: "Reading",
  completed: "Completed",
  on_hold: "On Hold",
  dropped: "Dropped",
  plan_to_watch: "Plan to Watch",
  plan_to_read: "Plan to Read",
};

function entryKey(malId: number, mediaType: string): string {
  return `${mediaType}:${malId}`;
}

function outcomeLabel(e: SyncRunEntry): string {
  switch (e.outcome) {
    case "WOULD_PUSH":
      return "Dry run";
    case "PUSHED":
      return "Pushed";
    case "ALREADY_SYNCED":
      return "Already synced";
    case "MATCH":
      return "Match";
    case "MISMATCH":
      return e.detail ? `Mismatch: ${e.detail}` : "Mismatch";
    case "MISSING":
      return e.detail ?? "Missing";
    case "SKIPPED_UNMAPPABLE":
      return "Unmappable";
    case "SKIPPED_UNCHANGED":
      return e.detail ?? "Skipped";
    case "ERROR":
      return e.detail ? `Error: ${e.detail}` : "Error";
    case "DELETED":
      return "Deleted";
    default:
      return (e.outcome as string).replace("_", " ");
  }
}

// Polls the run's entry log while a sync is active. The engine writes each
// SyncRunEntry row the moment it processes that entry, so this is a real live
// view, not a simulation; purely additive reads, no effect on the run itself.
// MAL status/score aren't stored on SyncRunEntry, so they're cross-referenced
// here from GET /api/entries (the ListEntry cache) instead of touching the
// backend to add columns.
export default function LiveSyncLog({ runId, active }: { runId: number; active: boolean }) {
  const [entries, setEntries] = useState<SyncRunEntry[]>([]);
  const [malEntries, setMalEntries] = useState<Map<string, ListEntry>>(new Map());
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const [runRes, entriesRes] = await Promise.all([api.getSyncRunDetail(runId), api.getEntries()]);
        if (cancelled) return;
        setEntries(runRes.run.entries);
        setMalEntries(new Map(entriesRes.entries.map((e) => [entryKey(e.malId, e.mediaType), e])));
      } catch {
        // Transient poll failure; keep showing the last known entries.
      }
    }

    poll();
    if (!active) return;
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [runId, active]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [entries]);

  return (
    <div className="log-viewer" ref={logRef}>
      {entries.length === 0 ? (
        <p className="muted">Fetching lists and resolving mappings... entries will appear here as they're processed.</p>
      ) : (
        entries.map((e) => {
          const malEntry = malEntries.get(entryKey(e.malId, e.mediaType));
          const statusLabel = malEntry ? STATUS_LABELS[malEntry.status] ?? malEntry.status : null;
          const scoreLabel = malEntry ? (malEntry.score > 0 ? `${malEntry.score}/10` : "unrated") : null;
          return (
            <div key={e.id} className="log-line">
              [{e.mediaType}] <strong>MAL ⇒ {e.service}:</strong> {e.title}
              {statusLabel && (
                <>
                  {" "}
                  ({statusLabel}
                  {scoreLabel ? `, ${scoreLabel}` : ""})
                </>
              )}{" "}
              <span className="muted">| {outcomeLabel(e)}</span>
            </div>
          );
        })
      )}
    </div>
  );
}

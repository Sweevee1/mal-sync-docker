import type { SyncRun } from "../api/types";

const STATUS_CLASS: Record<SyncRun["status"], string> = {
  RUNNING: "badge badge-neutral",
  SUCCESS: "badge badge-ok",
  PARTIAL_FAILURE: "badge badge-warn",
  FAILED: "badge badge-error",
};

export default function SyncRunRow({ run, expanded, onToggle }: { run: SyncRun; expanded: boolean; onToggle: () => void }) {
  return (
    <tr className="clickable" onClick={onToggle}>
      <td>
        #{run.id} {expanded ? "▾" : "▸"}
      </td>
      <td>{run.trigger.replace("_", " ")}</td>
      <td>{new Date(run.startedAt).toLocaleString()}</td>
      <td>
        <span className={STATUS_CLASS[run.status]}>{run.status.replace("_", " ")}</span>
      </td>
      <td>{run.animeCount + run.mangaCount}</td>
      <td>{run.pushedCount}</td>
      <td>{run.skippedCount}</td>
      <td>{run.errorCount}</td>
    </tr>
  );
}

import type { KeyboardEvent } from "react";
import type { SyncRun } from "../api/types";

const STATUS_CLASS: Record<SyncRun["status"], string> = {
  RUNNING: "badge badge-neutral",
  SUCCESS: "badge badge-ok",
  PARTIAL_FAILURE: "badge badge-warn",
  FAILED: "badge badge-error",
};

const TRIGGER_LABEL: Record<SyncRun["trigger"], string> = {
  MANUAL: "Manual",
  SCHEDULED: "Scheduled",
  DRY_RUN: "Dry run",
  CHECK: "Check",
};

const STATUS_LABEL: Record<SyncRun["status"], string> = {
  RUNNING: "Running",
  SUCCESS: "Success",
  PARTIAL_FAILURE: "Partial failure",
  FAILED: "Failed",
};

const STARTED_FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" });

export default function SyncRunRow({ run, expanded, onToggle }: { run: SyncRun; expanded: boolean; onToggle: () => void }) {
  function handleKeyDown(e: KeyboardEvent<HTMLTableRowElement>) {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onToggle();
    }
  }

  return (
    <tr
      className="clickable"
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      aria-label={`Run ${run.id}, ${expanded ? "hide" : "show"} details`}
      onClick={onToggle}
      onKeyDown={handleKeyDown}
    >
      <td>
        #{run.id} <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>
      </td>
      <td className="col-trigger">{TRIGGER_LABEL[run.trigger]}</td>
      <td>{STARTED_FORMAT.format(new Date(run.startedAt))}</td>
      <td>
        <span className={STATUS_CLASS[run.status]}>{STATUS_LABEL[run.status]}</span>
      </td>
      <td className="num-col">{run.animeCount + run.mangaCount}</td>
      <td className="num-col">{run.pushedCount}</td>
      <td className="num-col">{run.skippedCount}</td>
      <td className="num-col">{run.errorCount}</td>
    </tr>
  );
}

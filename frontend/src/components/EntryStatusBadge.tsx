import type { SyncEntryStatus } from "../api/types";

const LABELS: Record<SyncEntryStatus, string> = {
  SYNCED: "Synced",
  PENDING: "Pending",
  SKIPPED_UNMAPPABLE: "No match",
  ERROR: "Error",
  PENDING_DELETION: "Pending removal",
  NOT_APPLICABLE: "N/A",
};

const CLASS: Record<SyncEntryStatus, string> = {
  SYNCED: "badge badge-ok",
  PENDING: "badge badge-neutral",
  SKIPPED_UNMAPPABLE: "badge badge-warn",
  ERROR: "badge badge-error",
  PENDING_DELETION: "badge badge-warn",
  NOT_APPLICABLE: "badge badge-neutral",
};

export default function EntryStatusBadge({ status }: { status: SyncEntryStatus }) {
  return <span className={CLASS[status]}>{LABELS[status]}</span>;
}

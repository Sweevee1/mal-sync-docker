export type ServiceName = "MAL" | "ANILIST" | "KITSU";
export type TargetService = "ANILIST" | "KITSU";
export type MediaType = "ANIME" | "MANGA";

export type MalListStatus =
  | "watching"
  | "completed"
  | "on_hold"
  | "dropped"
  | "plan_to_watch"
  | "reading"
  | "plan_to_read";

export interface MalListEntry {
  malId: number;
  mediaType: MediaType;
  title: string;
  status: MalListStatus;
  score: number;
  progress: number;
  volumesProgress: number | null;
  startDate: string | null;
  finishDate: string | null;
  malUpdatedAt: string; // ISO
}

export type SyncEntryStatus =
  | "SYNCED"
  | "PENDING"
  | "SKIPPED_UNMAPPABLE"
  | "ERROR"
  | "PENDING_DELETION"
  | "NOT_APPLICABLE";

export type SyncRunTrigger = "MANUAL" | "SCHEDULED" | "DRY_RUN" | "CHECK";
export type SyncRunStatus = "RUNNING" | "SUCCESS" | "PARTIAL_FAILURE" | "FAILED";
export type SyncRunEntryOutcome =
  | "PUSHED"
  | "WOULD_PUSH"
  | "ALREADY_SYNCED"
  | "MATCH"
  | "MISMATCH"
  | "MISSING"
  | "SKIPPED_UNMAPPABLE"
  | "SKIPPED_UNCHANGED"
  | "ERROR"
  | "DELETED";

export interface SyncRunSummary {
  id: number;
  status: SyncRunStatus;
  trigger: SyncRunTrigger;
  startedAt: string;
  finishedAt: string | null;
  animeCount: number;
  mangaCount: number;
  pushedCount: number;
  skippedCount: number;
  errorCount: number;
  errorMessage: string | null;
}

export class RateLimitError extends Error {
  constructor(message: string, public retryAfterMs: number) {
    super(message);
    this.name = "RateLimitError";
  }
}

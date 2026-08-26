export type MediaType = "ANIME" | "MANGA";
export type SyncEntryStatus =
  | "SYNCED"
  | "PENDING"
  | "SKIPPED_UNMAPPABLE"
  | "ERROR"
  | "PENDING_DELETION"
  | "NOT_APPLICABLE";

export interface ServiceStatus {
  connected: boolean;
  connectedAt: string | null;
  expired: boolean;
  clientConfigured: boolean;
}

export interface StatusResponse {
  services: {
    mal: ServiceStatus;
    anilist: ServiceStatus;
    kitsu: ServiceStatus;
  };
  syncing: boolean;
  syncIntervalMinutes: number;
  lastSync: SyncRun | null;
  isSecure: boolean;
  oauthCallbackBase: string;
}

export interface SyncRun {
  id: number;
  trigger: "MANUAL" | "SCHEDULED" | "DRY_RUN" | "CHECK";
  startedAt: string;
  finishedAt: string | null;
  status: "RUNNING" | "SUCCESS" | "PARTIAL_FAILURE" | "FAILED";
  animeCount: number;
  mangaCount: number;
  pushedCount: number;
  skippedCount: number;
  errorCount: number;
  errorMessage: string | null;
}

export interface SyncRunEntry {
  id: number;
  malId: number;
  mediaType: MediaType;
  title: string;
  service: "ANILIST" | "KITSU";
  outcome:
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
  detail: string | null;
  createdAt: string;
}

export interface ListEntry {
  id: number;
  malId: number;
  mediaType: MediaType;
  title: string;
  status: string;
  score: number;
  progress: number;
  volumesProgress: number | null;
  malUpdatedAt: string;
  anilistSyncStatus: SyncEntryStatus;
  anilistSyncedAt: string | null;
  anilistLastError: string | null;
  kitsuSyncStatus: SyncEntryStatus;
  kitsuSyncedAt: string | null;
  kitsuLastError: string | null;
}

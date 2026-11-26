import { prisma } from "../db/client";
import * as mal from "../services/mal";
import * as anilist from "../services/anilist";
import * as kitsu from "../services/kitsu";
import { upsertListEntry, detectRemovals, needsAttempt } from "./diff";
import { resolveAnilistId, resolveKitsuId, invalidateKitsuMapping } from "./mapping";
import { tryAcquire, release } from "./lock";
import { diffAnilist, diffKitsu } from "./compare";
import { safeErrorMessage } from "../http/errors";
import type { MalListEntry, MediaType, SyncRunTrigger, SyncRunSummary, TargetService } from "../types";
import type { ListEntry } from "@prisma/client";

export { isSyncRunning } from "./lock";

const FULL_PASS_INTERVAL_MS = 24 * 60 * 60 * 1000;

async function getSettings() {
  const existing = await prisma.appSetting.findUnique({ where: { id: 1 } });
  if (existing) return existing;
  return prisma.appSetting.create({
    data: { id: 1, syncIntervalMinutes: 60 },
  });
}

async function pushToAnilist(
  entry: ListEntry,
  accessToken: string | null,
  isDryRun: boolean
): Promise<{ outcome: string; detail?: string }> {
  if (!accessToken) return { outcome: "SKIPPED_UNCHANGED", detail: "AniList not connected" };

  const mediaId = await resolveAnilistId(entry.malId, entry.mediaType as MediaType);
  if (mediaId == null) {
    await prisma.listEntry.update({ where: { id: entry.id }, data: { anilistSyncStatus: "SKIPPED_UNMAPPABLE", anilistLastError: null } });
    return { outcome: "SKIPPED_UNMAPPABLE" };
  }

  // Always verify the real current state before writing anything; avoids
  // clobbering entries another tool (e.g. the MAL-Sync browser extension)
  // already got into a matching state.
  const remote = await anilist.getListEntry(accessToken, mediaId);
  const diffs = remote ? diffAnilist(entry, remote) : null;

  if (remote && diffs && diffs.length === 0) {
    if (!isDryRun) {
      await prisma.listEntry.update({
        where: { id: entry.id },
        data: {
          anilistSyncStatus: "SYNCED",
          anilistSyncedAt: new Date(),
          anilistLastError: null,
          anilistListEntryId: String(remote.id),
        },
      });
    }
    return { outcome: "ALREADY_SYNCED" };
  }

  if (isDryRun) {
    const detail = remote
      ? `Would push to AniList media #${mediaId} (${diffs!.join(", ")})`
      : `Would push to AniList media #${mediaId} (not yet on AniList)`;
    return { outcome: "WOULD_PUSH", detail };
  }

  const malEntry = toMalListEntry(entry);
  const listEntryId = await anilist.pushEntry(accessToken, mediaId, malEntry);
  await prisma.listEntry.update({
    where: { id: entry.id },
    data: {
      anilistSyncStatus: "SYNCED",
      anilistSyncedAt: new Date(),
      anilistLastError: null,
      anilistListEntryId: String(listEntryId),
    },
  });
  return { outcome: "PUSHED" };
}

async function pushToKitsu(
  entry: ListEntry,
  creds: { accessToken: string; kitsuUserId: string } | null,
  isDryRun: boolean
): Promise<{ outcome: string; detail?: string }> {
  if (!creds) return { outcome: "SKIPPED_UNCHANGED", detail: "Kitsu not connected" };

  const mediaId = await resolveKitsuId(creds.accessToken, entry.malId, entry.mediaType as MediaType);
  if (mediaId == null) {
    await prisma.listEntry.update({ where: { id: entry.id }, data: { kitsuSyncStatus: "SKIPPED_UNMAPPABLE", kitsuLastError: null } });
    return { outcome: "SKIPPED_UNMAPPABLE" };
  }

  // Always verify the real current state before writing anything; avoids
  // clobbering entries another tool (e.g. the MAL-Sync browser extension)
  // already got into a matching state.
  const remote = await kitsu.getLibraryEntry(creds.accessToken, creds.kitsuUserId, mediaId, entry.mediaType as MediaType);
  const diffs = remote ? diffKitsu(entry, remote) : null;

  if (remote && diffs && diffs.length === 0) {
    if (!isDryRun) {
      await prisma.listEntry.update({
        where: { id: entry.id },
        data: {
          kitsuSyncStatus: "SYNCED",
          kitsuSyncedAt: new Date(),
          kitsuLastError: null,
          kitsuLibraryEntryId: remote.id,
        },
      });
    }
    return { outcome: "ALREADY_SYNCED" };
  }

  if (isDryRun) {
    const detail = remote
      ? `Would push to Kitsu media #${mediaId} (${diffs!.join(", ")})`
      : `Would push to Kitsu media #${mediaId} (not yet on Kitsu)`;
    return { outcome: "WOULD_PUSH", detail };
  }

  const malEntry = toMalListEntry(entry);
  const libraryEntryId = await kitsu.pushEntry(
    creds.accessToken,
    creds.kitsuUserId,
    mediaId,
    malEntry,
    remote?.id ?? entry.kitsuLibraryEntryId
  );
  await prisma.listEntry.update({
    where: { id: entry.id },
    data: {
      kitsuSyncStatus: "SYNCED",
      kitsuSyncedAt: new Date(),
      kitsuLastError: null,
      kitsuLibraryEntryId: libraryEntryId,
    },
  });
  return { outcome: "PUSHED" };
}

export const extractErrorMessage = safeErrorMessage;

// A cached Kitsu mapping can go stale if Kitsu later merges/removes/renumbers
// that specific entry; this JSON:API error shape (pointer at the media
// relationship) is Kitsu's specific way of saying "that id doesn't exist".
function isStaleKitsuMappingError(err: any): boolean {
  const errors = err?.response?.data?.errors;
  return Array.isArray(errors) && errors.some((e: any) => e?.source?.pointer === "/data/relationships/media");
}

function toMalListEntry(entry: ListEntry): MalListEntry {
  return {
    malId: entry.malId,
    mediaType: entry.mediaType as MediaType,
    title: entry.title,
    status: entry.status as MalListEntry["status"],
    score: entry.score,
    progress: entry.progress,
    volumesProgress: entry.volumesProgress,
    startDate: entry.startDate,
    finishDate: entry.finishDate,
    malUpdatedAt: entry.malUpdatedAt.toISOString(),
  };
}

async function logEntry(
  syncRunId: number,
  entry: ListEntry,
  service: TargetService,
  outcome: string,
  detail?: string
) {
  await prisma.syncRunEntry.create({
    data: {
      syncRunId,
      malId: entry.malId,
      mediaType: entry.mediaType,
      title: entry.title,
      service,
      outcome,
      detail: detail ?? null,
    },
  });
}

export async function runSync(trigger: SyncRunTrigger): Promise<SyncRunSummary> {
  if (!tryAcquire()) {
    throw new Error("A sync is already in progress");
  }

  const run = await prisma.syncRun.create({ data: { trigger, status: "RUNNING" } });
  let pushedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  let animeCount = 0;
  let mangaCount = 0;

  try {
    // MAL must be connected; a failure here aborts the whole run.
    await mal.getValidAccessToken();

    const isDryRun = trigger === "DRY_RUN";
    const settings = await getSettings();
    const fullPass = isDryRun
      ? true
      : !settings.lastFullSyncAt || Date.now() - settings.lastFullSyncAt.getTime() > FULL_PASS_INTERVAL_MS;

    const latestCached = await prisma.listEntry.aggregate({ _max: { malUpdatedAt: true } });
    const stopBefore = fullPass ? null : latestCached._max.malUpdatedAt?.toISOString() ?? null;

    const [animeList, mangaList] = await Promise.all([
      mal.fetchList("ANIME", stopBefore),
      mal.fetchList("MANGA", stopBefore),
    ]);
    animeCount = animeList.length;
    mangaCount = mangaList.length;

    for (const fresh of [...animeList, ...mangaList]) {
      await upsertListEntry(fresh);
    }

    if (fullPass && !isDryRun) {
      // fullPass implies stopBefore was null above, so animeList/mangaList already cover the entire list.
      // Skipped on a dry run: it's a persistent SYNCED -> PENDING_DELETION flip that's one confirm-deletion
      // click away from a real remote delete, not something a "safe test" should ever set up.
      await detectRemovals([...animeList, ...mangaList]);
      await prisma.appSetting.update({ where: { id: 1 }, data: { lastFullSyncAt: new Date() } });
    }

    const anilistConnected = await anilist.isConnected();
    const kitsuConnected = await kitsu.isConnected();
    const anilistToken = anilistConnected ? await anilist.getValidAccessToken() : null;
    const kitsuCreds = kitsuConnected ? await kitsu.getValidAccessToken() : null;

    const candidates = await prisma.listEntry.findMany();
    const toAttempt = candidates.filter(needsAttempt);

    for (const entry of toAttempt) {
      if (entry.anilistSyncStatus === "PENDING" || entry.anilistSyncStatus === "ERROR") {
        try {
          const result = await pushToAnilist(entry, anilistToken, isDryRun);
          await logEntry(run.id, entry, "ANILIST", result.outcome, result.detail);
          if (result.outcome === "PUSHED" || result.outcome === "WOULD_PUSH") pushedCount++;
          else if (result.outcome === "SKIPPED_UNMAPPABLE" || result.outcome === "ALREADY_SYNCED") skippedCount++;
        } catch (err: any) {
          errorCount++;
          const message = extractErrorMessage(err);
          await prisma.listEntry.update({ where: { id: entry.id }, data: { anilistSyncStatus: "ERROR", anilistLastError: message } });
          await logEntry(run.id, entry, "ANILIST", "ERROR", message);
        }
      }

      if (entry.kitsuSyncStatus === "PENDING" || entry.kitsuSyncStatus === "ERROR") {
        try {
          const result = await pushToKitsu(entry, kitsuCreds, isDryRun);
          await logEntry(run.id, entry, "KITSU", result.outcome, result.detail);
          if (result.outcome === "PUSHED" || result.outcome === "WOULD_PUSH") pushedCount++;
          else if (result.outcome === "SKIPPED_UNMAPPABLE" || result.outcome === "ALREADY_SYNCED") skippedCount++;
        } catch (err: any) {
          errorCount++;
          if (isStaleKitsuMappingError(err)) {
            await invalidateKitsuMapping(entry.malId, entry.mediaType as MediaType);
          }
          const message = extractErrorMessage(err);
          await prisma.listEntry.update({ where: { id: entry.id }, data: { kitsuSyncStatus: "ERROR", kitsuLastError: message } });
          await logEntry(run.id, entry, "KITSU", "ERROR", message);
        }
      }
    }

    const status = errorCount > 0 ? "PARTIAL_FAILURE" : "SUCCESS";
    const finished = await prisma.syncRun.update({
      where: { id: run.id },
      data: { status, finishedAt: new Date(), animeCount, mangaCount, pushedCount, skippedCount, errorCount },
    });
    return toSummary(finished);
  } catch (err: any) {
    const message = safeErrorMessage(err);
    const finished = await prisma.syncRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        animeCount,
        mangaCount,
        pushedCount,
        skippedCount,
        errorCount,
        errorMessage: message,
      },
    });
    return toSummary(finished);
  } finally {
    release();
  }
}

export function toSummary(run: {
  id: number;
  status: string;
  trigger: string;
  startedAt: Date;
  finishedAt: Date | null;
  animeCount: number;
  mangaCount: number;
  pushedCount: number;
  skippedCount: number;
  errorCount: number;
  errorMessage: string | null;
}): SyncRunSummary {
  return {
    id: run.id,
    status: run.status as SyncRunSummary["status"],
    trigger: run.trigger as SyncRunTrigger,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
    animeCount: run.animeCount,
    mangaCount: run.mangaCount,
    pushedCount: run.pushedCount,
    skippedCount: run.skippedCount,
    errorCount: run.errorCount,
    errorMessage: run.errorMessage,
  };
}

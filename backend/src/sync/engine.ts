import { prisma } from "../db/client";
import * as mal from "../services/mal";
import * as anilist from "../services/anilist";
import * as kitsu from "../services/kitsu";
import { upsertListEntry, detectRemovals, needsAttempt } from "./diff";
import { resolveAnilistId, resolveKitsuId } from "./mapping";
import type { MalListEntry, MediaType, SyncRunTrigger, SyncRunSummary, TargetService } from "../types";
import type { ListEntry } from "@prisma/client";

const FULL_PASS_INTERVAL_MS = 24 * 60 * 60 * 1000;

async function getSettings() {
  const existing = await prisma.appSetting.findUnique({ where: { id: 1 } });
  if (existing) return existing;
  return prisma.appSetting.create({
    data: { id: 1, syncIntervalMinutes: 60 },
  });
}

let isRunning = false;

async function pushToAnilist(entry: ListEntry, accessToken: string | null): Promise<{ outcome: string; detail?: string }> {
  if (!accessToken) return { outcome: "SKIPPED_UNCHANGED", detail: "AniList not connected" };

  const mediaId = await resolveAnilistId(entry.malId, entry.mediaType as MediaType);
  if (mediaId == null) {
    await prisma.listEntry.update({ where: { id: entry.id }, data: { anilistSyncStatus: "SKIPPED_UNMAPPABLE", anilistLastError: null } });
    return { outcome: "SKIPPED_UNMAPPABLE" };
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
  creds: { accessToken: string; kitsuUserId: string } | null
): Promise<{ outcome: string; detail?: string }> {
  if (!creds) return { outcome: "SKIPPED_UNCHANGED", detail: "Kitsu not connected" };

  const mediaId = await resolveKitsuId(creds.accessToken, entry.malId, entry.mediaType as MediaType);
  if (mediaId == null) {
    await prisma.listEntry.update({ where: { id: entry.id }, data: { kitsuSyncStatus: "SKIPPED_UNMAPPABLE", kitsuLastError: null } });
    return { outcome: "SKIPPED_UNMAPPABLE" };
  }

  const malEntry = toMalListEntry(entry);
  const libraryEntryId = await kitsu.pushEntry(
    creds.accessToken,
    creds.kitsuUserId,
    mediaId,
    malEntry,
    entry.kitsuLibraryEntryId
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
  if (isRunning) {
    throw new Error("A sync is already in progress");
  }
  isRunning = true;

  const run = await prisma.syncRun.create({ data: { trigger, status: "RUNNING" } });
  let pushedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  let animeCount = 0;
  let mangaCount = 0;

  try {
    // MAL must be connected; a failure here aborts the whole run.
    await mal.getValidAccessToken();

    const settings = await getSettings();
    const fullPass =
      !settings.lastFullSyncAt || Date.now() - settings.lastFullSyncAt.getTime() > FULL_PASS_INTERVAL_MS;

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

    if (fullPass) {
      // fullPass implies stopBefore was null above, so animeList/mangaList already cover the entire list.
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
          const result = await pushToAnilist(entry, anilistToken);
          await logEntry(run.id, entry, "ANILIST", result.outcome, result.detail);
          if (result.outcome === "PUSHED") pushedCount++;
          else if (result.outcome === "SKIPPED_UNMAPPABLE") skippedCount++;
        } catch (err: any) {
          errorCount++;
          const message = err?.message ?? String(err);
          await prisma.listEntry.update({ where: { id: entry.id }, data: { anilistSyncStatus: "ERROR", anilistLastError: message } });
          await logEntry(run.id, entry, "ANILIST", "ERROR", message);
        }
      }

      if (entry.kitsuSyncStatus === "PENDING" || entry.kitsuSyncStatus === "ERROR") {
        try {
          const result = await pushToKitsu(entry, kitsuCreds);
          await logEntry(run.id, entry, "KITSU", result.outcome, result.detail);
          if (result.outcome === "PUSHED") pushedCount++;
          else if (result.outcome === "SKIPPED_UNMAPPABLE") skippedCount++;
        } catch (err: any) {
          errorCount++;
          const message = err?.message ?? String(err);
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
    const message = err?.message ?? String(err);
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
    isRunning = false;
  }
}

export function isSyncRunning(): boolean {
  return isRunning;
}

function toSummary(run: {
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

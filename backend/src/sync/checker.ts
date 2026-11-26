import { prisma } from "../db/client";
import * as mal from "../services/mal";
import * as anilist from "../services/anilist";
import * as kitsu from "../services/kitsu";
import { upsertListEntry } from "./diff";
import { resolveAnilistId, resolveKitsuId } from "./mapping";
import { tryAcquire, release } from "./lock";
import { toSummary } from "./engine";
import { safeErrorMessage } from "../http/errors";
import { diffAnilist, diffKitsu } from "./compare";
import type { MediaType, SyncRunSummary, TargetService } from "../types";
import type { ListEntry } from "@prisma/client";

async function logEntry(syncRunId: number, entry: ListEntry, service: TargetService, outcome: string, detail?: string) {
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

async function checkAnilist(entry: ListEntry, accessToken: string | null): Promise<{ outcome: string; detail?: string }> {
  if (!accessToken) return { outcome: "SKIPPED_UNCHANGED", detail: "AniList not connected" };

  const mediaId = await resolveAnilistId(entry.malId, entry.mediaType as MediaType);
  if (mediaId == null) return { outcome: "SKIPPED_UNMAPPABLE" };

  const remote = await anilist.getListEntry(accessToken, mediaId);
  if (!remote) return { outcome: "MISSING", detail: "Not on AniList yet" };

  const diffs = diffAnilist(entry, remote);
  if (diffs.length === 0) return { outcome: "MATCH" };
  return { outcome: "MISMATCH", detail: diffs.join(", ") };
}

async function checkKitsu(
  entry: ListEntry,
  creds: { accessToken: string; kitsuUserId: string } | null
): Promise<{ outcome: string; detail?: string }> {
  if (!creds) return { outcome: "SKIPPED_UNCHANGED", detail: "Kitsu not connected" };

  const mediaId = await resolveKitsuId(creds.accessToken, entry.malId, entry.mediaType as MediaType);
  if (mediaId == null) return { outcome: "SKIPPED_UNMAPPABLE" };

  const remote = await kitsu.getLibraryEntry(creds.accessToken, creds.kitsuUserId, mediaId, entry.mediaType as MediaType);
  if (!remote) return { outcome: "MISSING", detail: "Not on Kitsu yet" };

  const diffs = diffKitsu(entry, remote);
  if (diffs.length === 0) return { outcome: "MATCH" };
  return { outcome: "MISMATCH", detail: diffs.join(", ") };
}

/**
 * Read-only comparison of MAL against AniList/Kitsu's actual current state.
 * Never writes to ListEntry's sync-status columns and never pushes anything --
 * unlike a dry run (which reports what a real sync *would* do based on local
 * PENDING/ERROR status), this checks *every* mapped entry against the real
 * remote value, which matters when AniList/Kitsu were already populated by
 * another tool this app never tracked as SYNCED.
 */
export async function runCheck(): Promise<SyncRunSummary> {
  if (!tryAcquire()) {
    throw new Error("A sync is already in progress");
  }

  const run = await prisma.syncRun.create({ data: { trigger: "CHECK", status: "RUNNING" } });
  let matchCount = 0;
  let attentionCount = 0;
  let errorCount = 0;
  let animeCount = 0;
  let mangaCount = 0;

  try {
    await mal.getValidAccessToken();

    const [animeList, mangaList] = await Promise.all([mal.fetchList("ANIME", null), mal.fetchList("MANGA", null)]);
    animeCount = animeList.length;
    mangaCount = mangaList.length;
    for (const fresh of [...animeList, ...mangaList]) {
      await upsertListEntry(fresh);
    }

    const anilistConnected = await anilist.isConnected();
    const kitsuConnected = await kitsu.isConnected();
    const anilistToken = anilistConnected ? await anilist.getValidAccessToken() : null;
    const kitsuCreds = kitsuConnected ? await kitsu.getValidAccessToken() : null;

    const entries = await prisma.listEntry.findMany();

    for (const entry of entries) {
      try {
        const result = await checkAnilist(entry, anilistToken);
        await logEntry(run.id, entry, "ANILIST", result.outcome, result.detail);
        if (result.outcome === "MATCH") matchCount++;
        else if (result.outcome === "MISMATCH" || result.outcome === "MISSING" || result.outcome === "SKIPPED_UNMAPPABLE") {
          attentionCount++;
        }
      } catch (err: any) {
        errorCount++;
        await logEntry(run.id, entry, "ANILIST", "ERROR", safeErrorMessage(err));
      }

      try {
        const result = await checkKitsu(entry, kitsuCreds);
        await logEntry(run.id, entry, "KITSU", result.outcome, result.detail);
        if (result.outcome === "MATCH") matchCount++;
        else if (result.outcome === "MISMATCH" || result.outcome === "MISSING" || result.outcome === "SKIPPED_UNMAPPABLE") {
          attentionCount++;
        }
      } catch (err: any) {
        errorCount++;
        await logEntry(run.id, entry, "KITSU", "ERROR", safeErrorMessage(err));
      }
    }

    const status = errorCount > 0 ? "PARTIAL_FAILURE" : "SUCCESS";
    const finished = await prisma.syncRun.update({
      where: { id: run.id },
      data: {
        status,
        finishedAt: new Date(),
        animeCount,
        mangaCount,
        pushedCount: matchCount,
        skippedCount: attentionCount,
        errorCount,
      },
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
        pushedCount: matchCount,
        skippedCount: attentionCount,
        errorCount,
        errorMessage: message,
      },
    });
    return toSummary(finished);
  } finally {
    release();
  }
}

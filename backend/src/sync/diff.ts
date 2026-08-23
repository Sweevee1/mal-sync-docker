import { prisma } from "../db/client";
import type { MalListEntry } from "../types";
import type { ListEntry } from "@prisma/client";

function entryKey(malId: number, mediaType: string): string {
  return `${mediaType}:${malId}`;
}

/**
 * Upserts a fresh MAL entry into the ListEntry cache. If the MAL data
 * actually changed since the last cached snapshot, both services' sync
 * status are reset to PENDING so the engine will push them this run.
 */
export async function upsertListEntry(fresh: MalListEntry): Promise<{ entry: ListEntry; changed: boolean }> {
  const existing = await prisma.listEntry.findUnique({
    where: { malId_mediaType: { malId: fresh.malId, mediaType: fresh.mediaType } },
  });

  const changed = !existing || existing.malUpdatedAt.toISOString() !== new Date(fresh.malUpdatedAt).toISOString();

  const entry = await prisma.listEntry.upsert({
    where: { malId_mediaType: { malId: fresh.malId, mediaType: fresh.mediaType } },
    create: {
      malId: fresh.malId,
      mediaType: fresh.mediaType,
      title: fresh.title,
      status: fresh.status,
      score: fresh.score,
      progress: fresh.progress,
      volumesProgress: fresh.volumesProgress,
      startDate: fresh.startDate,
      finishDate: fresh.finishDate,
      malUpdatedAt: new Date(fresh.malUpdatedAt),
      anilistSyncStatus: "PENDING",
      kitsuSyncStatus: "PENDING",
    },
    update: {
      title: fresh.title,
      status: fresh.status,
      score: fresh.score,
      progress: fresh.progress,
      volumesProgress: fresh.volumesProgress,
      startDate: fresh.startDate,
      finishDate: fresh.finishDate,
      malUpdatedAt: new Date(fresh.malUpdatedAt),
      ...(changed
        ? {
            anilistSyncStatus: existing?.anilistSyncStatus === "SKIPPED_UNMAPPABLE" ? "SKIPPED_UNMAPPABLE" : "PENDING",
            kitsuSyncStatus: existing?.kitsuSyncStatus === "SKIPPED_UNMAPPABLE" ? "SKIPPED_UNMAPPABLE" : "PENDING",
          }
        : {}),
    },
  });

  return { entry, changed };
}

/** Entries that still need a push attempt this run: PENDING (new/changed) or ERROR (retry) on either service. */
export function needsAttempt(entry: ListEntry): boolean {
  return (
    entry.anilistSyncStatus === "PENDING" ||
    entry.anilistSyncStatus === "ERROR" ||
    entry.kitsuSyncStatus === "PENDING" ||
    entry.kitsuSyncStatus === "ERROR"
  );
}

/**
 * On a full pass, flags cached entries no longer present in the fresh MAL
 * list as PENDING_DELETION on whichever service they were previously SYNCED
 * on. Never deletes anything; that requires explicit user confirmation.
 */
export async function detectRemovals(freshEntries: MalListEntry[]): Promise<ListEntry[]> {
  const freshKeys = new Set(freshEntries.map((e) => entryKey(e.malId, e.mediaType)));
  const cached = await prisma.listEntry.findMany();
  const removed = cached.filter((c) => !freshKeys.has(entryKey(c.malId, c.mediaType)));

  const flagged: ListEntry[] = [];
  for (const entry of removed) {
    const data: Record<string, unknown> = {};
    if (entry.anilistSyncStatus === "SYNCED") data.anilistSyncStatus = "PENDING_DELETION";
    if (entry.kitsuSyncStatus === "SYNCED") data.kitsuSyncStatus = "PENDING_DELETION";
    if (Object.keys(data).length === 0) continue;

    const updated = await prisma.listEntry.update({ where: { id: entry.id }, data });
    flagged.push(updated);
  }
  return flagged;
}

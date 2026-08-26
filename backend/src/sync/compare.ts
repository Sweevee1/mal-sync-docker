import * as anilist from "../services/anilist";
import * as kitsu from "../services/kitsu";
import type { MalListEntry } from "../types";
import type { ListEntry } from "@prisma/client";

// MAL score 0 means "unrated"; a push never touches the target's rating in
// that case, so any existing remote rating is compatible, not a mismatch.
function scoresMatch(malScore: number, remoteScore: number | null): boolean {
  if (malScore === 0) return true;
  return remoteScore === malScore;
}

export function diffAnilist(
  entry: ListEntry,
  remote: { status: string; score: number; progress: number; progressVolumes: number | null }
): string[] {
  const desiredStatus = anilist.mapStatus(entry.status as MalListEntry["status"]);
  const desiredVolumes = entry.mediaType === "MANGA" ? entry.volumesProgress ?? 0 : null;

  const diffs: string[] = [];
  if (remote.status !== desiredStatus) diffs.push(`status ${remote.status ?? "none"}->${desiredStatus}`);
  if (!scoresMatch(entry.score, remote.score)) diffs.push(`score ${remote.score ?? 0}->${entry.score}`);
  if ((remote.progress ?? 0) !== entry.progress) diffs.push(`progress ${remote.progress ?? 0}->${entry.progress}`);
  if (desiredVolumes != null && (remote.progressVolumes ?? 0) !== desiredVolumes) {
    diffs.push(`volumes ${remote.progressVolumes ?? 0}->${desiredVolumes}`);
  }
  return diffs;
}

export function diffKitsu(
  entry: ListEntry,
  remote: { status: string; progress: number; ratingTwenty: number | null }
): string[] {
  const desiredStatus = kitsu.mapStatus(entry.status as MalListEntry["status"]);
  const desiredRating = entry.score > 0 ? entry.score * 2 : null;

  const diffs: string[] = [];
  if (remote.status !== desiredStatus) diffs.push(`status ${remote.status}->${desiredStatus}`);
  if (remote.progress !== entry.progress) diffs.push(`progress ${remote.progress}->${entry.progress}`);
  if (desiredRating != null && remote.ratingTwenty !== desiredRating) {
    diffs.push(`rating ${remote.ratingTwenty ?? 0}->${desiredRating}`);
  }
  return diffs;
}

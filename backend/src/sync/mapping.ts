import { prisma } from "../db/client";
import * as anilist from "../services/anilist";
import * as kitsu from "../services/kitsu";
import type { MediaType } from "../types";

// How long to trust a cached "unmappable" result before rechecking, since
// AniList/Kitsu catalogs grow over time and a title once missing may later exist.
const NEGATIVE_RECHECK_MS = 7 * 24 * 60 * 60 * 1000;

async function getOrCreateMapping(malId: number, mediaType: MediaType) {
  const existing = await prisma.mediaMapping.findUnique({ where: { malId_mediaType: { malId, mediaType } } });
  if (existing) return existing;
  return prisma.mediaMapping.create({ data: { malId, mediaType } });
}

function isFresh(lookupAt: Date | null, hasPositiveResult: boolean): boolean {
  if (!lookupAt) return false;
  if (hasPositiveResult) return true; // positive results are trusted indefinitely
  return Date.now() - lookupAt.getTime() < NEGATIVE_RECHECK_MS;
}

export async function resolveAnilistId(malId: number, mediaType: MediaType): Promise<number | null> {
  const mapping = await getOrCreateMapping(malId, mediaType);
  if (isFresh(mapping.anilistLookupAt, mapping.anilistId != null)) {
    return mapping.anilistId;
  }

  const anilistId = await anilist.lookupByMalId(malId, mediaType);
  await prisma.mediaMapping.update({
    where: { malId_mediaType: { malId, mediaType } },
    data: { anilistId, anilistLookupAt: new Date() },
  });
  return anilistId;
}

export async function resolveKitsuId(
  accessToken: string,
  malId: number,
  mediaType: MediaType
): Promise<string | null> {
  const mapping = await getOrCreateMapping(malId, mediaType);
  if (isFresh(mapping.kitsuLookupAt, mapping.kitsuId != null)) {
    return mapping.kitsuId;
  }

  const kitsuId = await kitsu.lookupByMalId(accessToken, malId, mediaType);
  await prisma.mediaMapping.update({
    where: { malId_mediaType: { malId, mediaType } },
    data: { kitsuId, kitsuLookupAt: new Date() },
  });
  return kitsuId;
}

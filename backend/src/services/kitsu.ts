import axios, { type AxiosInstance } from "axios";
import { prisma } from "../db/client";
import { decrypt, decryptOrNull, encrypt } from "../crypto/secretBox";
import { kitsuLimiter } from "./rateLimiter";
import type { MalListEntry, MediaType } from "../types";

const TOKEN_URL = "https://kitsu.io/api/oauth/token";
const API_BASE = "https://kitsu.io/api/edge";

async function passwordGrant(username: string, password: string) {
  const res = await axios.post(
    TOKEN_URL,
    new URLSearchParams({ grant_type: "password", username, password }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  return res.data as { access_token: string; refresh_token: string; expires_in: number };
}

async function lookupSelfId(accessToken: string): Promise<string> {
  const userRes = await axios.get(`${API_BASE}/users`, {
    params: { "filter[self]": "true" },
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const kitsuUserId: string | undefined = userRes.data.data[0]?.id;
  if (!kitsuUserId) throw new Error("Kitsu did not return a user for this token");
  return kitsuUserId;
}

export async function connect(username: string, password: string): Promise<void> {
  const tokens = await passwordGrant(username, password);
  const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  const kitsuUserId = await lookupSelfId(tokens.access_token);

  await prisma.serviceCredential.upsert({
    where: { service: "KITSU" },
    create: {
      service: "KITSU",
      accessTokenEnc: encrypt(tokens.access_token),
      refreshTokenEnc: encrypt(tokens.refresh_token),
      tokenExpiresAt,
      kitsuUsernameEnc: encrypt(username),
      kitsuPasswordEnc: encrypt(password),
      kitsuUserId,
      connectedAt: new Date(),
    },
    update: {
      accessTokenEnc: encrypt(tokens.access_token),
      refreshTokenEnc: encrypt(tokens.refresh_token),
      tokenExpiresAt,
      kitsuUsernameEnc: encrypt(username),
      kitsuPasswordEnc: encrypt(password),
      kitsuUserId,
      connectedAt: new Date(),
    },
  });
}

/**
 * Connects using a token obtained outside this server (e.g. the user ran the
 * password grant themselves against kitsu.io directly). No username/password
 * is stored, so there's no automatic re-authentication fallback if the
 * refresh token stops working; the user has to paste a fresh token then.
 */
export async function connectWithToken(
  accessToken: string,
  refreshToken: string | null,
  expiresInSeconds: number | null
): Promise<void> {
  const kitsuUserId = await lookupSelfId(accessToken);
  const tokenExpiresAt = expiresInSeconds ? new Date(Date.now() + expiresInSeconds * 1000) : null;

  await prisma.serviceCredential.upsert({
    where: { service: "KITSU" },
    create: {
      service: "KITSU",
      accessTokenEnc: encrypt(accessToken),
      refreshTokenEnc: refreshToken ? encrypt(refreshToken) : null,
      tokenExpiresAt,
      kitsuUsernameEnc: null,
      kitsuPasswordEnc: null,
      kitsuUserId,
      connectedAt: new Date(),
    },
    update: {
      accessTokenEnc: encrypt(accessToken),
      refreshTokenEnc: refreshToken ? encrypt(refreshToken) : null,
      tokenExpiresAt,
      kitsuUsernameEnc: null,
      kitsuPasswordEnc: null,
      kitsuUserId,
      connectedAt: new Date(),
    },
  });
}

const EXPIRY_SAFETY_MARGIN_MS = 5 * 60 * 1000;

export async function getValidAccessToken(): Promise<{ accessToken: string; kitsuUserId: string }> {
  const cred = await prisma.serviceCredential.findUnique({ where: { service: "KITSU" } });
  if (!cred || !cred.accessTokenEnc || !cred.kitsuUserId) {
    throw new Error("Kitsu is not connected");
  }

  // No stored expiry (e.g. a pasted token with no expires_in given) is treated
  // as "trust it until Kitsu says otherwise", not as "expired". A token-only
  // connection has no refresh/re-auth fallback to fall back on either way.
  if (!cred.tokenExpiresAt || cred.tokenExpiresAt.getTime() - Date.now() > EXPIRY_SAFETY_MARGIN_MS) {
    return { accessToken: decrypt(cred.accessTokenEnc), kitsuUserId: cred.kitsuUserId };
  }

  // Try a refresh_token grant first; fall back to redoing the password grant.
  try {
    if (!cred.refreshTokenEnc) throw new Error("no refresh token stored");
    const res = await axios.post(
      TOKEN_URL,
      new URLSearchParams({ grant_type: "refresh_token", refresh_token: decrypt(cred.refreshTokenEnc) }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
    const { access_token, refresh_token, expires_in } = res.data;
    await prisma.serviceCredential.update({
      where: { service: "KITSU" },
      data: {
        accessTokenEnc: encrypt(access_token),
        refreshTokenEnc: encrypt(refresh_token),
        tokenExpiresAt: new Date(Date.now() + expires_in * 1000),
      },
    });
    return { accessToken: access_token, kitsuUserId: cred.kitsuUserId };
  } catch {
    const username = decryptOrNull(cred.kitsuUsernameEnc);
    const password = decryptOrNull(cred.kitsuPasswordEnc);
    if (!username || !password) {
      throw new Error(
        "Kitsu token expired and there's no stored password to renew it automatically. " +
          "Reconnect on the Connect Services page with a fresh token."
      );
    }
    const tokens = await passwordGrant(username, password);
    await prisma.serviceCredential.update({
      where: { service: "KITSU" },
      data: {
        accessTokenEnc: encrypt(tokens.access_token),
        refreshTokenEnc: encrypt(tokens.refresh_token),
        tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      },
    });
    return { accessToken: tokens.access_token, kitsuUserId: cred.kitsuUserId };
  }
}

export async function isConnected(): Promise<boolean> {
  const cred = await prisma.serviceCredential.findUnique({ where: { service: "KITSU" } });
  return !!cred?.accessTokenEnc;
}

export async function disconnect(): Promise<void> {
  await prisma.serviceCredential.deleteMany({ where: { service: "KITSU" } });
}

function client(accessToken: string): AxiosInstance {
  return axios.create({
    baseURL: API_BASE,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/vnd.api+json",
      Accept: "application/vnd.api+json",
    },
  });
}

const KITSU_RESOURCE: Record<MediaType, "anime" | "manga"> = { ANIME: "anime", MANGA: "manga" };

/** Resolves a MAL ID to a Kitsu media id via the mappings relation. Returns null if unmapped. */
export async function lookupByMalId(accessToken: string, malId: number, mediaType: MediaType): Promise<string | null> {
  const resource = KITSU_RESOURCE[mediaType];
  return kitsuLimiter.schedule(async () => {
    const res = await client(accessToken).get("/mappings", {
      params: {
        "filter[externalSite]": `myanimelist/${resource}`,
        "filter[externalId]": malId,
        include: "item",
      },
    });
    const included = res.data.included as Array<{ id: string; type: string }> | undefined;
    // Kitsu's own mapping data can include a miscategorized item (e.g. a
    // character resource) alongside the correct one for the same MAL id --
    // only trust an included item whose type actually matches what we asked
    // for, not just whichever one happened to come back first.
    const match = included?.find((item) => item.type === resource);
    return match?.id ?? null;
  });
}

const STATUS_MAP: Record<MalListEntry["status"], string> = {
  watching: "current",
  reading: "current",
  completed: "completed",
  on_hold: "on_hold",
  dropped: "dropped",
  plan_to_watch: "planned",
  plan_to_read: "planned",
};

export function mapStatus(malStatus: MalListEntry["status"]): string {
  return STATUS_MAP[malStatus];
}

async function findExistingLibraryEntryId(
  accessToken: string,
  kitsuUserId: string,
  kitsuMediaId: string,
  mediaType: MediaType
): Promise<string | null> {
  const resource = KITSU_RESOURCE[mediaType];
  const res = await client(accessToken).get("/library-entries", {
    params: {
      "filter[userId]": kitsuUserId,
      [`filter[${resource}Id]`]: kitsuMediaId,
    },
  });
  const data = res.data.data as Array<{ id: string }>;
  return data[0]?.id ?? null;
}

/**
 * Reads the current library entry's status/progress/rating for a Kitsu media
 * id, without writing anything; used both by the read-only "Check" mode and
 * by the push path (to skip writing when the remote already matches MAL).
 * Returns null if the media isn't on the user's list.
 */
export async function getLibraryEntry(
  accessToken: string,
  kitsuUserId: string,
  kitsuMediaId: string,
  mediaType: MediaType
): Promise<{ id: string; status: string; progress: number; ratingTwenty: number | null } | null> {
  const resource = KITSU_RESOURCE[mediaType];
  return kitsuLimiter.schedule(async () => {
    const res = await client(accessToken).get("/library-entries", {
      params: {
        "filter[userId]": kitsuUserId,
        [`filter[${resource}Id]`]: kitsuMediaId,
      },
    });
    const data = res.data.data as Array<{ id: string; attributes: { status: string; progress: number; ratingTwenty: number | null } }>;
    if (!data[0]) return null;
    const { status, progress, ratingTwenty } = data[0].attributes;
    return { id: data[0].id, status, progress, ratingTwenty: ratingTwenty ?? null };
  });
}

/**
 * Creates or updates the current user's library entry for the given Kitsu
 * media id. Returns the Kitsu library-entry id (cache this to skip the
 * existence lookup on future pushes).
 */
export async function pushEntry(
  accessToken: string,
  kitsuUserId: string,
  kitsuMediaId: string,
  entry: MalListEntry,
  knownLibraryEntryId?: string | null
): Promise<string> {
  const resource = KITSU_RESOURCE[entry.mediaType];
  const attributes: Record<string, unknown> = {
    status: STATUS_MAP[entry.status],
    progress: entry.progress,
  };
  if (entry.score > 0) {
    attributes.ratingTwenty = entry.score * 2; // Kitsu's 0-20 scale maps 1:1 from MAL's 0-10
  }

  return kitsuLimiter.schedule(async () => {
    const http = client(accessToken);
    const libraryEntryId =
      knownLibraryEntryId ?? (await findExistingLibraryEntryId(accessToken, kitsuUserId, kitsuMediaId, entry.mediaType));

    if (libraryEntryId) {
      await http.patch(`/library-entries/${libraryEntryId}`, {
        data: { id: libraryEntryId, type: "library-entries", attributes },
      });
      return libraryEntryId;
    }

    const createRes = await http.post("/library-entries", {
      data: {
        type: "library-entries",
        attributes,
        relationships: {
          user: { data: { id: kitsuUserId, type: "users" } },
          [resource]: { data: { id: kitsuMediaId, type: resource } },
        },
      },
    });
    return createRes.data.data.id as string;
  });
}

export async function deleteEntry(accessToken: string, libraryEntryId: string): Promise<void> {
  await kitsuLimiter.schedule(() => client(accessToken).delete(`/library-entries/${libraryEntryId}`));
}

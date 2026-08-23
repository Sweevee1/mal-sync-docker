import axios from "axios";
import crypto from "node:crypto";
import { GraphQLClient, gql } from "graphql-request";
import { prisma } from "../db/client";
import { config } from "../config/env";
import { decrypt, encrypt } from "../crypto/secretBox";
import { anilistLimiter } from "./rateLimiter";
import { RateLimitError } from "../types";
import type { MalListEntry, MediaType } from "../types";

const AUTHORIZE_URL = "https://anilist.co/api/v2/oauth/authorize";
const TOKEN_URL = "https://anilist.co/api/v2/oauth/token";
const GRAPHQL_URL = "https://graphql.anilist.co";

export async function startAuth(): Promise<string> {
  const state = crypto.randomBytes(16).toString("hex");
  await prisma.serviceCredential.upsert({
    where: { service: "ANILIST" },
    create: { service: "ANILIST", oauthState: state },
    update: { oauthState: state },
  });

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", config.ANILIST_CLIENT_ID);
  url.searchParams.set("redirect_uri", config.ANILIST_REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function handleCallback(code: string, state: string): Promise<void> {
  const cred = await prisma.serviceCredential.findUnique({ where: { service: "ANILIST" } });
  if (!cred || cred.oauthState !== state) {
    throw new Error("Invalid or expired AniList OAuth state");
  }

  const tokenRes = await axios.post(
    TOKEN_URL,
    {
      grant_type: "authorization_code",
      client_id: config.ANILIST_CLIENT_ID,
      client_secret: config.ANILIST_CLIENT_SECRET,
      redirect_uri: config.ANILIST_REDIRECT_URI,
      code,
    },
    { headers: { "Content-Type": "application/json", Accept: "application/json" } }
  );

  // Note: AniList does not issue refresh tokens for the authorization-code
  // grant. Access tokens are long-lived (~1 year); re-authorization via the
  // OAuth flow is required once expired.
  const { access_token, expires_in } = tokenRes.data;
  const tokenExpiresAt = new Date(Date.now() + expires_in * 1000);

  await prisma.serviceCredential.update({
    where: { service: "ANILIST" },
    data: {
      accessTokenEnc: encrypt(access_token),
      tokenExpiresAt,
      oauthState: null,
      connectedAt: new Date(),
    },
  });
}

export async function getValidAccessToken(): Promise<string> {
  const cred = await prisma.serviceCredential.findUnique({ where: { service: "ANILIST" } });
  if (!cred || !cred.accessTokenEnc) {
    throw new Error("AniList is not connected");
  }
  if (cred.tokenExpiresAt && cred.tokenExpiresAt.getTime() < Date.now()) {
    throw new Error("AniList token has expired; please reconnect AniList (AniList does not support token refresh)");
  }
  return decrypt(cred.accessTokenEnc);
}

export async function isConnected(): Promise<boolean> {
  const cred = await prisma.serviceCredential.findUnique({ where: { service: "ANILIST" } });
  return !!cred?.accessTokenEnc;
}

export async function disconnect(): Promise<void> {
  await prisma.serviceCredential.deleteMany({ where: { service: "ANILIST" } });
}

async function graphqlRequest<T>(query: string, variables: Record<string, unknown>, accessToken?: string): Promise<T> {
  const client = new GraphQLClient(GRAPHQL_URL, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
  });
  return anilistLimiter.schedule(async () => {
    try {
      return await client.request<T>(query, variables);
    } catch (err: any) {
      const response = err?.response;
      if (response?.status === 429) {
        const retryAfterHeader = response.headers?.get?.("retry-after") ?? response.headers?.["retry-after"];
        const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : 5000;
        throw new RateLimitError("AniList rate limit exceeded", retryAfterMs);
      }
      throw err;
    }
  });
}

const LOOKUP_QUERY = gql`
  query ($malId: Int, $type: MediaType) {
    Media(idMal: $malId, type: $type) {
      id
    }
  }
`;

/** Resolves a MAL ID to an AniList media ID. Returns null if no match exists. */
export async function lookupByMalId(malId: number, mediaType: MediaType): Promise<number | null> {
  try {
    const data = await graphqlRequest<{ Media: { id: number } | null }>(LOOKUP_QUERY, {
      malId,
      type: mediaType,
    });
    return data.Media?.id ?? null;
  } catch (err: any) {
    // AniList returns a GraphQL "Not Found" error (no Media) rather than null in some cases.
    if (err?.response?.errors?.some((e: any) => /not found/i.test(e.message))) {
      return null;
    }
    throw err;
  }
}

const SAVE_MUTATION = gql`
  mutation (
    $mediaId: Int
    $status: MediaListStatus
    $score: Float
    $progress: Int
    $progressVolumes: Int
  ) {
    SaveMediaListEntry(
      mediaId: $mediaId
      status: $status
      score: $score
      progress: $progress
      progressVolumes: $progressVolumes
    ) {
      id
    }
  }
`;

const DELETE_MUTATION = gql`
  mutation ($id: Int) {
    DeleteMediaListEntry(id: $id) {
      deleted
    }
  }
`;

const STATUS_MAP: Record<MalListEntry["status"], string> = {
  watching: "CURRENT",
  reading: "CURRENT",
  completed: "COMPLETED",
  on_hold: "PAUSED",
  dropped: "DROPPED",
  plan_to_watch: "PLANNING",
  plan_to_read: "PLANNING",
};

export function mapStatus(malStatus: MalListEntry["status"]): string {
  return STATUS_MAP[malStatus] ?? "PLANNING";
}

/**
 * Creates or updates the current user's list entry for the given AniList
 * media ID. Score is passed through 1:1, assuming the AniList account is
 * configured for POINT_10 scoring (documented in onboarding).
 */
export async function pushEntry(
  accessToken: string,
  anilistMediaId: number,
  entry: MalListEntry
): Promise<number> {
  const data = await graphqlRequest<{ SaveMediaListEntry: { id: number } }>(
    SAVE_MUTATION,
    {
      mediaId: anilistMediaId,
      status: mapStatus(entry.status),
      score: entry.score,
      progress: entry.progress,
      progressVolumes: entry.mediaType === "MANGA" ? entry.volumesProgress ?? undefined : undefined,
    },
    accessToken
  );
  return data.SaveMediaListEntry.id;
}

export async function deleteEntry(accessToken: string, listEntryId: number): Promise<void> {
  await graphqlRequest(DELETE_MUTATION, { id: listEntryId }, accessToken);
}

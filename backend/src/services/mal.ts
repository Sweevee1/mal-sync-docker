import axios from "axios";
import crypto from "node:crypto";
import { prisma } from "../db/client";
import { decrypt, encrypt } from "../crypto/secretBox";
import { malLimiter } from "./rateLimiter";
import type { MalListEntry, MediaType } from "../types";

const AUTHORIZE_URL = "https://myanimelist.net/v1/oauth2/authorize";
const TOKEN_URL = "https://myanimelist.net/v1/oauth2/token";
const API_BASE = "https://api.myanimelist.net/v2";

export function generatePkcePair(): { codeVerifier: string; codeChallenge: string } {
  // MAL only supports code_challenge_method=plain, so challenge === verifier.
  const codeVerifier = crypto.randomBytes(64).toString("base64url").slice(0, 128);
  return { codeVerifier, codeChallenge: codeVerifier };
}

export async function getClientId(): Promise<string | null> {
  const cred = await prisma.serviceCredential.findUnique({ where: { service: "MAL" } });
  return cred?.clientId ?? null;
}

export async function setClientId(clientId: string): Promise<void> {
  await prisma.serviceCredential.upsert({
    where: { service: "MAL" },
    create: { service: "MAL", clientId },
    update: { clientId },
  });
}

export async function startAuth(redirectUri: string): Promise<string> {
  const cred = await prisma.serviceCredential.findUnique({ where: { service: "MAL" } });
  if (!cred?.clientId) {
    throw new Error("Set your MAL Client ID on the Connect Services page first");
  }

  const { codeVerifier, codeChallenge } = generatePkcePair();
  const state = crypto.randomBytes(16).toString("hex");

  await prisma.serviceCredential.update({
    where: { service: "MAL" },
    data: { codeVerifier, oauthState: state, redirectUri },
  });

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", cred.clientId);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "plain");
  url.searchParams.set("state", state);
  url.searchParams.set("redirect_uri", redirectUri);
  return url.toString();
}

// MAL's OAuth server returns a JSON body describing what actually went wrong
// (e.g. {"error":"invalid_client","message":"Client authentication failed"}),
// but axios's own thrown error only says "Request failed with status code
// 401/400" — pull the real reason out so it's shown to the user instead.
function extractOAuthErrorMessage(err: any): string {
  const data = err?.response?.data;
  return data?.message ?? data?.hint ?? data?.error_description ?? data?.error ?? err?.message ?? String(err);
}

export async function handleCallback(code: string, state: string): Promise<void> {
  const cred = await prisma.serviceCredential.findUnique({ where: { service: "MAL" } });
  if (!cred || !cred.clientId || !cred.codeVerifier || !cred.redirectUri || cred.oauthState !== state) {
    throw new Error("Invalid or expired MAL OAuth state");
  }

  let tokenRes;
  try {
    tokenRes = await axios.post(
      TOKEN_URL,
      new URLSearchParams({
        client_id: cred.clientId,
        grant_type: "authorization_code",
        code,
        code_verifier: cred.codeVerifier,
        redirect_uri: cred.redirectUri,
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
  } catch (err: any) {
    throw new Error(`MAL token exchange failed: ${extractOAuthErrorMessage(err)}`);
  }

  const { access_token, refresh_token, expires_in } = tokenRes.data;
  const tokenExpiresAt = new Date(Date.now() + expires_in * 1000);

  const meRes = await axios.get(`${API_BASE}/users/@me`, {
    headers: { Authorization: `Bearer ${access_token}` },
  });

  await prisma.serviceCredential.update({
    where: { service: "MAL" },
    data: {
      accessTokenEnc: encrypt(access_token),
      refreshTokenEnc: encrypt(refresh_token),
      tokenExpiresAt,
      malUsername: meRes.data.name,
      codeVerifier: null,
      oauthState: null,
      redirectUri: null,
      connectedAt: new Date(),
    },
  });
}

async function refreshAccessToken(
  clientId: string,
  refreshTokenEnc: string
): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date }> {
  const refreshToken = decrypt(refreshTokenEnc);
  const res = await axios.post(
    TOKEN_URL,
    new URLSearchParams({
      client_id: clientId,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  const { access_token, refresh_token, expires_in } = res.data;
  const expiresAt = new Date(Date.now() + expires_in * 1000);

  await prisma.serviceCredential.update({
    where: { service: "MAL" },
    data: {
      accessTokenEnc: encrypt(access_token),
      refreshTokenEnc: encrypt(refresh_token),
      tokenExpiresAt: expiresAt,
    },
  });

  return { accessToken: access_token, refreshToken: refresh_token, expiresAt };
}

const EXPIRY_SAFETY_MARGIN_MS = 5 * 60 * 1000;

export async function getValidAccessToken(): Promise<{ accessToken: string; username: string }> {
  const cred = await prisma.serviceCredential.findUnique({ where: { service: "MAL" } });
  if (!cred || !cred.accessTokenEnc || !cred.refreshTokenEnc || !cred.malUsername || !cred.clientId) {
    throw new Error("MAL is not connected");
  }

  if (cred.tokenExpiresAt && cred.tokenExpiresAt.getTime() - Date.now() > EXPIRY_SAFETY_MARGIN_MS) {
    return { accessToken: decrypt(cred.accessTokenEnc), username: cred.malUsername };
  }

  const refreshed = await refreshAccessToken(cred.clientId, cred.refreshTokenEnc);
  return { accessToken: refreshed.accessToken, username: cred.malUsername };
}

export async function isConnected(): Promise<boolean> {
  const cred = await prisma.serviceCredential.findUnique({ where: { service: "MAL" } });
  return !!cred?.accessTokenEnc;
}

// Clears the connection but keeps the saved Client ID, so reconnecting doesn't
// require re-entering it.
export async function disconnect(): Promise<void> {
  await prisma.serviceCredential.updateMany({
    where: { service: "MAL" },
    data: {
      accessTokenEnc: null,
      refreshTokenEnc: null,
      tokenExpiresAt: null,
      malUsername: null,
      connectedAt: null,
      codeVerifier: null,
      oauthState: null,
      redirectUri: null,
    },
  });
}

interface MalListNode {
  node: { id: number; title: string };
  list_status: {
    status: MalListEntry["status"];
    score: number;
    num_episodes_watched?: number;
    num_chapters_read?: number;
    num_volumes_read?: number;
    start_date?: string;
    finish_date?: string;
    updated_at: string;
  };
}

const ANIME_FIELDS = "list_status{status,score,num_episodes_watched,start_date,finish_date,updated_at}";
const MANGA_FIELDS = "list_status{status,score,num_chapters_read,num_volumes_read,start_date,finish_date,updated_at}";

/**
 * Fetches a full anime or manga list, paginated. If `stopBefore` is given (an
 * ISO timestamp), paging stops once an entry's list_status.updated_at is not
 * newer than it. Used for incremental syncs; pass null for a full pass.
 */
export async function fetchList(mediaType: MediaType, stopBefore: string | null): Promise<MalListEntry[]> {
  const { accessToken, username } = await getValidAccessToken();
  const fields = mediaType === "ANIME" ? ANIME_FIELDS : MANGA_FIELDS;
  const listPath = mediaType === "ANIME" ? "animelist" : "mangalist";

  let url: string | null =
    `${API_BASE}/users/${encodeURIComponent(username)}/${listPath}` +
    `?fields=${fields}&limit=1000&sort=list_updated_at&nsfw=true`;

  const results: MalListEntry[] = [];

  while (url) {
    const res: { data: { data: MalListNode[]; paging?: { next?: string } } } = await malLimiter.schedule(() =>
      axios.get(url as string, { headers: { Authorization: `Bearer ${accessToken}` } })
    );

    for (const item of res.data.data) {
      const ls = item.list_status;
      if (stopBefore && new Date(ls.updated_at).getTime() <= new Date(stopBefore).getTime()) {
        return results;
      }
      results.push({
        malId: item.node.id,
        mediaType,
        title: item.node.title,
        status: ls.status,
        score: ls.score,
        progress: mediaType === "ANIME" ? ls.num_episodes_watched ?? 0 : ls.num_chapters_read ?? 0,
        volumesProgress: mediaType === "MANGA" ? ls.num_volumes_read ?? 0 : null,
        startDate: ls.start_date ?? null,
        finishDate: ls.finish_date ?? null,
        malUpdatedAt: ls.updated_at,
      });
    }

    url = res.data.paging?.next ?? null;
  }

  return results;
}

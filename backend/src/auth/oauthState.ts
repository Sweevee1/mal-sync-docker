import crypto from "node:crypto";
import { prisma } from "../db/client";

export type OAuthService = "MAL" | "ANILIST";

export const OAUTH_COOKIE = "msd_oauth";
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

// Distinguishes a forged/stale/replayed callback from a provider-side failure,
// since the two redirect to different fixed error codes.
export class OAuthStateError extends Error {}

export function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

// Hashing first gives equal-length buffers, so timingSafeEqual never throws.
export function safeEqual(a: string, b: string): boolean {
  return crypto.timingSafeEqual(crypto.createHash("sha256").update(a).digest(), crypto.createHash("sha256").update(b).digest());
}

export function newOAuthState() {
  const state = crypto.randomBytes(32).toString("base64url");
  return {
    state,
    stateHash: sha256Hex(state),
    expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
  };
}

export function assertStateMatches(
  cred: { oauthState: string | null; oauthStateExpiresAt: Date | null },
  state: string
): void {
  if (
    !cred.oauthState ||
    !cred.oauthStateExpiresAt ||
    cred.oauthStateExpiresAt.getTime() < Date.now() ||
    !safeEqual(cred.oauthState, sha256Hex(state))
  ) {
    throw new OAuthStateError("Invalid or expired OAuth state");
  }
}

// A handshake is single-use, so everything transient is dropped on any outcome.
export async function clearOAuthState(service: OAuthService): Promise<void> {
  await prisma.serviceCredential.updateMany({
    where: { service },
    data: { oauthState: null, oauthStateExpiresAt: null, codeVerifier: null, redirectUri: null },
  });
}

// Human-readable failure detail kept in memory only; surfaced solely through
// the authenticated /api/status so the public redirect carries a fixed code.
const lastAuthError = new Map<string, string>();

export function setLastAuthError(service: OAuthService, detail: string | null): void {
  if (detail === null) lastAuthError.delete(service);
  else lastAuthError.set(service, detail);
}

export function getLastAuthError(service: OAuthService): string | null {
  return lastAuthError.get(service) ?? null;
}

export function safeDetail(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\x00-\x1f\x7f]+/g, " ").trim().slice(0, 200);
}

import type { CookieOptions, Response } from "express";
import { isHttpsBase } from "../config/env";
import type { Config } from "../config/env";

type CookieCfg = Pick<Config, "PUBLIC_BASE_URL">;

export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const OAUTH_MAX_AGE_MS = 10 * 60 * 1000;

// The __Host- prefix makes browsers refuse a cookie planted by a sibling
// subdomain or over plain HTTP. It requires Secure and Path=/, so it only
// applies when the deployment is HTTPS; Secure is decided by config, never by
// request headers a client could forge.
export function cookieNames(cfg: CookieCfg) {
  const prefix = isHttpsBase(cfg) ? "__Host-" : "";
  return { session: `${prefix}msd_session`, oauth: `${prefix}msd_oauth` };
}

function base(cfg: CookieCfg, sameSite: "strict" | "lax"): CookieOptions {
  return { httpOnly: true, sameSite, path: "/", secure: isHttpsBase(cfg) };
}

export function setSessionCookie(cfg: CookieCfg, res: Response, token: string): void {
  res.cookie(cookieNames(cfg).session, token, { ...base(cfg, "strict"), maxAge: SESSION_MAX_AGE_MS });
}

export function clearSessionCookie(cfg: CookieCfg, res: Response): void {
  res.clearCookie(cookieNames(cfg).session, base(cfg, "strict"));
}

// Lax, not Strict: the provider's redirect back is a cross-site top-level navigation.
export function setOAuthCookie(cfg: CookieCfg, res: Response, state: string): void {
  res.cookie(cookieNames(cfg).oauth, state, { ...base(cfg, "lax"), maxAge: OAUTH_MAX_AGE_MS });
}

export function clearOAuthCookie(cfg: CookieCfg, res: Response): void {
  res.clearCookie(cookieNames(cfg).oauth, base(cfg, "lax"));
}

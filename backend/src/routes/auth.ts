import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import type { Config } from "../config/env";
import { wrap } from "../http/asyncHandler";
import * as mal from "../services/mal";
import * as anilist from "../services/anilist";
import * as kitsu from "../services/kitsu";
import { parseCookies } from "../auth/session";
import { resolveBaseUrl } from "../auth/peer";
import { clearOAuthCookie, cookieNames, setOAuthCookie } from "../auth/cookies";
import {
  OAuthStateError,
  clearOAuthState,
  safeDetail,
  safeEqual,
  setLastAuthError,
} from "../auth/oauthState";
import type { OAuthService } from "../auth/oauthState";

const malClientSchema = z.object({ clientId: z.string().trim().min(1).max(200) });
const anilistClientSchema = z.object({
  clientId: z.string().trim().min(1).max(200),
  clientSecret: z.string().trim().min(1).max(400),
});
const kitsuLoginSchema = z.object({ username: z.string().min(1).max(256), password: z.string().min(1).max(256) });
const kitsuTokenSchema = z.object({
  accessToken: z.string().min(1).max(4096),
  refreshToken: z.string().max(4096).optional().nullable(),
  expiresInSeconds: z
    .number()
    .positive()
    .max(10 * 365 * 24 * 3600)
    .optional()
    .nullable(),
});

// A cross-site page could otherwise trigger /start with the owner's session and
// pre-seed an attacker-chosen handshake; browsers that send the header let us refuse.
function isSameOriginNavigation(req: Request): boolean {
  const site = req.get("sec-fetch-site");
  return !site || site === "same-origin" || site === "none";
}

function oauthFailureCode(service: OAuthService): string {
  return service === "MAL" ? "mal_failed" : "anilist_failed";
}

function startHandler(
  cfg: Config,
  service: OAuthService,
  path: string,
  start: (redirectUri: string) => Promise<{ url: string; state: string }>
) {
  return wrap(async (req, res) => {
    if (!isSameOriginNavigation(req)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    try {
      const { url, state } = await start(`${resolveBaseUrl(cfg, req)}${path}`);
      setOAuthCookie(cfg, res, state);
      res.redirect(url);
    } catch (err) {
      setLastAuthError(service, safeDetail(err));
      res.redirect(`/?error=${oauthFailureCode(service)}`);
    }
  });
}

function callbackHandler(
  cfg: Config,
  service: OAuthService,
  connectedParam: string,
  complete: (code: string, state: string) => Promise<void>
) {
  const oauthCookie = cookieNames(cfg).oauth;
  return wrap(async (req, res) => {
    const cookieState = parseCookies(req.headers.cookie)[oauthCookie];
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const code = typeof req.query.code === "string" ? req.query.code : "";

    // A request without the matching cookie is not the browser that started the
    // handshake, so it must not be able to spend or abort the stored state.
    if (!cookieState || !state || !safeEqual(cookieState, state)) {
      return res.redirect("/?error=state_invalid");
    }
    clearOAuthCookie(cfg, res);

    try {
      if (!code) {
        setLastAuthError(service, "The provider did not return an authorization code");
        return res.redirect(`/?error=${oauthFailureCode(service)}`);
      }
      await complete(code, state);
      setLastAuthError(service, null);
      res.redirect(`/?connected=${connectedParam}`);
    } catch (err) {
      if (err instanceof OAuthStateError) {
        return res.redirect("/?error=state_invalid");
      }
      console.error(`${service} OAuth callback failed:`, err instanceof Error ? err.message : err);
      setLastAuthError(service, safeDetail(err));
      res.redirect(`/?error=${oauthFailureCode(service)}`);
    } finally {
      await clearOAuthState(service);
    }
  });
}

// authRouter is mounted behind the session guard. authCallbackRouter is mounted
// before it: the provider's redirect carries no session context, so it is
// authenticated by the OAuth cookie plus the stored state hash.
export function createAuthRouters(cfg: Config) {
  const authRouter = Router();
  const authCallbackRouter = Router();

  authRouter.put(
    "/mal/client",
    wrap(async (req, res) => {
      const parsed = malClientSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "clientId is required (1 to 200 characters)" });
      await mal.setClientId(parsed.data.clientId);
      res.json({ ok: true });
    })
  );

  authRouter.put(
    "/anilist/client",
    wrap(async (req, res) => {
      const parsed = anilistClientSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ error: "clientId (1 to 200 characters) and clientSecret (1 to 400 characters) are required" });
      }
      await anilist.setClientCredentials(parsed.data.clientId, parsed.data.clientSecret);
      res.json({ ok: true });
    })
  );

  authRouter.get("/mal/start", startHandler(cfg, "MAL", "/api/auth/mal/callback", mal.startAuth));
  authRouter.get("/anilist/start", startHandler(cfg, "ANILIST", "/api/auth/anilist/callback", anilist.startAuth));

  authCallbackRouter.get("/mal/callback", callbackHandler(cfg, "MAL", "mal", mal.handleCallback));
  authCallbackRouter.get("/anilist/callback", callbackHandler(cfg, "ANILIST", "anilist", anilist.handleCallback));

  authRouter.post(
    "/kitsu",
    wrap(async (req, res) => {
      if (!req.secure) {
        return res.status(403).json({
          error:
            "Kitsu password login is disabled because this connection isn't HTTPS. Use the 'Paste a token' method " +
            "instead, or put this app behind an HTTPS reverse proxy and set TRUST_PROXY=true to enable it.",
        });
      }
      const parsed = kitsuLoginSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "username and password are required" });
      try {
        await kitsu.connect(parsed.data.username, parsed.data.password);
        res.json({ ok: true });
      } catch (err: any) {
        console.error("Kitsu connect failed:", err?.message);
        const rejected = err?.response?.status === 400 || err?.response?.status === 401;
        res.status(400).json({
          error: rejected ? "Kitsu rejected that username or password" : "Kitsu connection failed",
        });
      }
    })
  );

  authRouter.post(
    "/kitsu/token",
    wrap(async (req, res) => {
      const parsed = kitsuTokenSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "accessToken is required" });
      const { accessToken, refreshToken, expiresInSeconds } = parsed.data;
      try {
        await kitsu.connectWithToken(accessToken, refreshToken || null, expiresInSeconds ?? null);
        res.json({ ok: true });
      } catch (err: any) {
        console.error("Kitsu token connect failed:", err?.message);
        res.status(400).json({ error: "Kitsu connection failed" });
      }
    })
  );

  authRouter.delete(
    "/:service",
    wrap(async (req, res) => {
      const service = String(req.params.service).toUpperCase();
      switch (service) {
        case "MAL":
          await mal.disconnect();
          break;
        case "ANILIST":
          await anilist.disconnect();
          break;
        case "KITSU":
          await kitsu.disconnect();
          break;
        default:
          return res.status(400).json({ error: "Unknown service" });
      }
      res.json({ ok: true });
    })
  );

  return { authRouter, authCallbackRouter };
}

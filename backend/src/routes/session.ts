import { Router } from "express";
import type { Request } from "express";
import net from "node:net";
import { z } from "zod";
import { isHttpsBase } from "../config/env";
import type { Config } from "../config/env";
import { wrap } from "../http/asyncHandler";
import { verifyPassword } from "../auth/password";
import { createConcurrencyGate, createLoginThrottle } from "../auth/throttle";
import { clearSessionCookie, cookieNames, setSessionCookie } from "../auth/cookies";
import { createSession, destroySession, parseCookies, touchSession } from "../auth/session";

const loginSchema = z.object({ password: z.string().min(1).max(256) });

const MAX_CONCURRENT_VERIFICATIONS = 2;

function normalizeIp(ip: string | undefined): string {
  return (ip ?? "").replace(/^::ffff:/i, "");
}

function isLoopbackOrPrivate(ip: string): boolean {
  if (ip === "::1") return true;
  if (net.isIP(ip) !== 4) return false;
  const [a, b] = ip.split(".").map(Number);
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

// Only reachable when PUBLIC_BASE_URL itself is http (local dev or a LAN-only
// install). Judge by the TCP peer, not req.ip or Forwarded headers, and refuse
// if the peer is a trusted proxy hop: a proxy reporting plain HTTP means the
// client side of that hop is not known to be local.
function plainHttpLoginAllowed(req: Request): boolean {
  const peer = normalizeIp(req.socket.remoteAddress);
  if (!isLoopbackOrPrivate(peer)) return false;
  const trusted = req.app.get("trust proxy fn") as ((addr: string, i: number) => boolean) | undefined;
  return !(trusted && trusted(req.socket.remoteAddress ?? peer, 0));
}

function loginAllowedOverThisConnection(cfg: Config, req: Request): boolean {
  // With an https PUBLIC_BASE_URL the deployment is public-facing, so there is
  // no plain-HTTP exception; req.secure is only true for a real TLS socket or
  // a trusted proxy's X-Forwarded-Proto.
  if (isHttpsBase(cfg)) return req.secure;
  return req.secure || plainHttpLoginAllowed(req);
}

export function createSessionRouter(cfg: Config) {
  const router = Router();
  const throttle = createLoginThrottle();
  const gate = createConcurrencyGate(MAX_CONCURRENT_VERIFICATIONS);
  const sessionCookie = cookieNames(cfg).session;

  router.post(
    "/login",
    wrap(async (req, res) => {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid request" });

      if (!loginAllowedOverThisConnection(cfg, req)) {
        return res.status(403).json({ error: "HTTPS required" });
      }

      const { wait, refund } = throttle.attempt(req.ip ?? "unknown");
      if (wait > 0) {
        res.set("Retry-After", String(wait));
        return res.status(429).json({ error: "Too many attempts. Try again later." });
      }

      // Saturation says nothing about this client's guesses, so it must not
      // consume their budget (otherwise a flood could burn the owner's attempts).
      if (!gate.tryEnter()) {
        refund();
        res.set("Retry-After", "1");
        return res.status(429).json({ error: "Server busy. Try again shortly." });
      }

      let ok: boolean;
      try {
        ok = await verifyPassword(parsed.data.password, cfg.ADMIN_PASSWORD_HASH);
      } catch (err) {
        refund();
        throw err;
      } finally {
        gate.leave();
      }
      if (!ok) return res.status(401).json({ error: "Invalid password" });

      refund();
      // Always issue a fresh token so a pre-login cookie can never be upgraded.
      await destroySession(parseCookies(req.headers.cookie)[sessionCookie]);
      setSessionCookie(cfg, res, await createSession());
      res.json({ authenticated: true });
    })
  );

  router.post(
    "/logout",
    wrap(async (req, res) => {
      await destroySession(parseCookies(req.headers.cookie)[sessionCookie]);
      clearSessionCookie(cfg, res);
      res.json({ ok: true });
    })
  );

  router.get(
    "/",
    wrap(async (req, res) => {
      const ok = await touchSession(parseCookies(req.headers.cookie)[sessionCookie]);
      res.status(ok ? 200 : 401).json({ authenticated: ok });
    })
  );

  return router;
}

import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import type { Config } from "../config/env";
import { wrap } from "../http/asyncHandler";
import { HttpError } from "../http/errors";
import { hashPassword, verifyPassword } from "../auth/password";
import { createConcurrencyGate, createLoginThrottle } from "../auth/throttle";
import { clearSessionCookie, cookieNames, setSessionCookie } from "../auth/cookies";
import { createSession, destroySession, parseCookies, touchSession } from "../auth/session";
import { clearSetupCode, getAdminHash, setStoredAdminHash, setupCodeMatches } from "../auth/adminCredential";
import { connectionAllowedForAuth } from "../auth/peer";
import { sha256Hex } from "../auth/oauthState";
import { prisma } from "../db/client";

const MIN_NEW_PASSWORD = 12;
const loginSchema = z.object({ password: z.string().min(1).max(256) });
const setupSchema = z
  .object({ password: z.string().min(MIN_NEW_PASSWORD).max(256), setupCode: z.string().min(1).max(64) })
  .strict();
const changeSchema = z
  .object({ currentPassword: z.string().min(1).max(256), newPassword: z.string().min(MIN_NEW_PASSWORD).max(256) })
  .strict();

const MAX_CONCURRENT_VERIFICATIONS = 2;

export function createSessionRouter(cfg: Config) {
  const router = Router();
  // One budget for every password-or-code guess (login, setup, change), so
  // switching endpoints does not multiply an attacker's attempts.
  const throttle = createLoginThrottle();
  const gate = createConcurrencyGate(MAX_CONCURRENT_VERIFICATIONS);
  const sessionCookie = cookieNames(cfg).session;

  // Runs fn inside the shared throttle and concurrency gate. fn returns true
  // when the guess was right, which refunds the attempt. Null means a 429 was sent.
  async function guarded(req: Request, res: Response, fn: () => Promise<boolean>): Promise<boolean | null> {
    const { wait, refund } = throttle.attempt(req.ip ?? "unknown");
    if (wait > 0) {
      res.set("Retry-After", String(wait));
      res.status(429).json({ error: "Too many attempts. Try again later." });
      return null;
    }
    // Saturation says nothing about this client's guesses, so it must not
    // consume their budget (otherwise a flood could burn the owner's attempts).
    if (!gate.tryEnter()) {
      refund();
      res.set("Retry-After", "1");
      res.status(429).json({ error: "Server busy. Try again shortly." });
      return null;
    }
    try {
      const ok = await fn();
      if (ok) refund();
      return ok;
    } catch (err) {
      refund();
      throw err;
    } finally {
      gate.leave();
    }
  }

  async function startSession(req: Request, res: Response) {
    // Always issue a fresh token so a pre-login cookie can never be upgraded.
    await destroySession(parseCookies(req.headers.cookie)[sessionCookie]);
    setSessionCookie(cfg, res, await createSession());
  }

  router.post(
    "/login",
    wrap(async (req, res) => {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid request" });

      if (!connectionAllowedForAuth(cfg, req)) {
        return res.status(403).json({ error: "HTTPS required" });
      }
      const hash = await getAdminHash();
      if (hash === null) return res.status(409).json({ error: "Setup required", setupRequired: true });

      const ok = await guarded(req, res, () => verifyPassword(parsed.data.password, hash));
      if (ok === null) return;
      if (!ok) return res.status(401).json({ error: "Invalid password" });

      await startSession(req, res);
      res.json({ authenticated: true });
    })
  );

  // Claims an unclaimed install. The code from the container log proves the
  // caller can read it, so a stranger who finds the port first cannot take it.
  router.post(
    "/setup",
    wrap(async (req, res) => {
      const parsed = setupSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: `Password must be at least ${MIN_NEW_PASSWORD} characters` });
      }
      if (!connectionAllowedForAuth(cfg, req)) {
        return res.status(403).json({ error: "HTTPS required" });
      }
      if ((await getAdminHash()) !== null) return res.status(409).json({ error: "Already set up" });

      const ok = await guarded(req, res, async () => setupCodeMatches(parsed.data.setupCode));
      if (ok === null) return;
      if (!ok) return res.status(401).json({ error: "Invalid setup code" });

      const hash = await hashPassword(parsed.data.password);
      // Re-check after the await so two racing claims cannot both win.
      if ((await getAdminHash()) !== null) return res.status(409).json({ error: "Already set up" });
      await setStoredAdminHash(hash);
      await prisma.appSetting.update({ where: { id: 1 }, data: { adminHashFingerprint: sha256Hex(hash) } });
      clearSetupCode();
      await startSession(req, res);
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

  router.post(
    "/password",
    wrap(async (req, res) => {
      if (!(await touchSession(parseCookies(req.headers.cookie)[sessionCookie]))) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      if (cfg.ADMIN_PASSWORD_HASH) {
        throw new HttpError(
          409,
          "ADMIN_PASSWORD_HASH is set and takes priority. Remove that variable, restart, then change the password here."
        );
      }
      const parsed = changeSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: `New password must be at least ${MIN_NEW_PASSWORD} characters` });
      }
      const hash = await getAdminHash();
      if (hash === null) return res.status(409).json({ error: "Setup required", setupRequired: true });

      const ok = await guarded(req, res, () => verifyPassword(parsed.data.currentPassword, hash));
      if (ok === null) return;
      if (!ok) return res.status(401).json({ error: "Current password is not right" });

      const next = await hashPassword(parsed.data.newPassword);
      await setStoredAdminHash(next);
      // Same effect as initAuth's fingerprint check: every other session is signed out.
      await prisma.session.deleteMany({});
      await prisma.appSetting.update({ where: { id: 1 }, data: { adminHashFingerprint: sha256Hex(next) } });
      await startSession(req, res);
      res.json({ ok: true });
    })
  );

  router.get(
    "/",
    wrap(async (req, res) => {
      const [ok, hash] = await Promise.all([
        touchSession(parseCookies(req.headers.cookie)[sessionCookie]),
        getAdminHash(),
      ]);
      res.status(ok ? 200 : 401).json({
        authenticated: ok,
        setupRequired: hash === null,
        passwordManagedByEnv: ok ? Boolean(cfg.ADMIN_PASSWORD_HASH) : undefined,
      });
    })
  );

  return router;
}

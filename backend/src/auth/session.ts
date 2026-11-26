import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { prisma } from "../db/client";
import { config } from "../config/env";
import type { Config } from "../config/env";
import { SESSION_MAX_AGE_MS, cookieNames } from "./cookies";
import { sha256Hex } from "./oauthState";

const IDLE_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;
const ABSOLUTE_TIMEOUT_MS = SESSION_MAX_AGE_MS;

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const name = part.slice(0, idx).trim();
    if (!name || name in out) continue;
    try {
      out[name] = decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      // ignore undecodable cookie values
    }
  }
  return out;
}

// A new password hash invalidates every existing session, so rotating the
// password is also how an operator force-logs-out a stolen cookie.
export async function initAuth(): Promise<void> {
  const fingerprint = sha256Hex(config.ADMIN_PASSWORD_HASH);
  const settings = await prisma.appSetting.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
  if (settings.adminHashFingerprint !== fingerprint) {
    await prisma.session.deleteMany({});
    await prisma.appSetting.update({ where: { id: 1 }, data: { adminHashFingerprint: fingerprint } });
  }
}

export async function createSession(): Promise<string> {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = new Date();
  await prisma.session.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: now } }, { lastSeenAt: { lt: new Date(now.getTime() - IDLE_TIMEOUT_MS) } }],
    },
  });
  await prisma.session.create({
    data: {
      idHash: sha256Hex(token),
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + ABSOLUTE_TIMEOUT_MS),
    },
  });
  return token;
}

export async function destroySession(token: string | undefined): Promise<void> {
  if (!token) return;
  await prisma.session.deleteMany({ where: { idHash: sha256Hex(token) } });
}

// Returns true and slides lastSeenAt if the token maps to a live session.
export async function touchSession(token: string | undefined): Promise<boolean> {
  if (!token || token.length > 128) return false;
  const idHash = sha256Hex(token);
  const row = await prisma.session.findUnique({ where: { idHash } });
  if (!row) return false;
  const now = Date.now();
  if (row.expiresAt.getTime() <= now || now - row.lastSeenAt.getTime() > IDLE_TIMEOUT_MS) {
    await prisma.session.deleteMany({ where: { idHash } });
    return false;
  }
  await prisma.session.update({ where: { idHash }, data: { lastSeenAt: new Date(now) } });
  return true;
}

export function createRequireSession(cfg: Pick<Config, "PUBLIC_BASE_URL">) {
  const cookieName = cookieNames(cfg).session;
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = parseCookies(req.headers.cookie)[cookieName];
      if (!(await touchSession(token))) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

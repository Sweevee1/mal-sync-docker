import crypto from "node:crypto";
import { prisma } from "../db/client";
import { config } from "../config/env";
import { safeEqual } from "./oauthState";

// ADMIN_PASSWORD_HASH wins when set; otherwise the hash chosen in setup mode.
export async function getAdminHash(): Promise<string | null> {
  if (config.ADMIN_PASSWORD_HASH) return config.ADMIN_PASSWORD_HASH;
  const row = await prisma.appSetting.findUnique({ where: { id: 1 } });
  return row?.adminPasswordHash ?? null;
}

export async function setStoredAdminHash(hash: string): Promise<void> {
  await prisma.appSetting.upsert({
    where: { id: 1 },
    create: { id: 1, adminPasswordHash: hash },
    update: { adminPasswordHash: hash },
  });
}

// In memory only, so a new code appears in the log on every boot while unclaimed.
let setupCode: string | null = null;

export function ensureSetupCode(): string {
  setupCode ??= crypto.randomBytes(9).toString("base64url");
  return setupCode;
}

export function clearSetupCode(): void {
  setupCode = null;
}

export function setupCodeMatches(candidate: string): boolean {
  return setupCode !== null && safeEqual(setupCode, candidate);
}

import { Router } from "express";
import { prisma } from "../db/client";
import { isSyncRunning } from "../sync/engine";
import { config } from "../config/env";
import { wrap } from "../http/asyncHandler";
import { getLastAuthError } from "../auth/oauthState";

export const statusRouter = Router();

async function serviceStatus(service: "MAL" | "ANILIST" | "KITSU") {
  const cred = await prisma.serviceCredential.findUnique({ where: { service } });
  const clientConfigured = service === "KITSU" ? true : !!cred?.clientId;
  const lastAuthError = service === "KITSU" ? null : getLastAuthError(service);
  if (!cred || !cred.accessTokenEnc) {
    return { connected: false, connectedAt: null, expired: false, clientConfigured, lastAuthError };
  }
  const expired = !!cred.tokenExpiresAt && cred.tokenExpiresAt.getTime() < Date.now() && service === "ANILIST";
  return { connected: true, connectedAt: cred.connectedAt, expired, clientConfigured, lastAuthError };
}

statusRouter.get(
  "/",
  wrap(async (req, res) => {
    const [mal, anilist, kitsu, settings, latestRun] = await Promise.all([
      serviceStatus("MAL"),
      serviceStatus("ANILIST"),
      serviceStatus("KITSU"),
      prisma.appSetting.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} }),
      prisma.syncRun.findFirst({ orderBy: { startedAt: "desc" } }),
    ]);

    res.json({
      services: { mal, anilist, kitsu },
      syncing: isSyncRunning(),
      syncIntervalMinutes: settings.syncIntervalMinutes,
      lastSync: latestRun,
      isSecure: req.secure,
      // Shown in the UI so the user knows exactly what redirect URI to register
      // with MAL/AniList; fixed by config, never derived from the request.
      oauthCallbackBase: config.PUBLIC_BASE_URL,
    });
  })
);

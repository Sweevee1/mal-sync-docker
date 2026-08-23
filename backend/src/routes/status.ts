import { Router } from "express";
import { prisma } from "../db/client";
import { isSyncRunning } from "../sync/engine";

export const statusRouter = Router();

async function serviceStatus(service: "MAL" | "ANILIST" | "KITSU") {
  const cred = await prisma.serviceCredential.findUnique({ where: { service } });
  if (!cred || !cred.accessTokenEnc) return { connected: false, connectedAt: null, expired: false };
  const expired = !!cred.tokenExpiresAt && cred.tokenExpiresAt.getTime() < Date.now() && service === "ANILIST";
  return { connected: true, connectedAt: cred.connectedAt, expired };
}

statusRouter.get("/", async (req, res) => {
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
  });
});

import { Router } from "express";
import { prisma } from "../db/client";
import { reschedule } from "../scheduler/cron";

export const settingsRouter = Router();

settingsRouter.get("/", async (_req, res) => {
  const settings = await prisma.appSetting.upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: {},
  });
  res.json({ settings });
});

settingsRouter.put("/", async (req, res) => {
  const { syncIntervalMinutes } = req.body ?? {};
  const minutes = Number(syncIntervalMinutes);
  if (!Number.isFinite(minutes) || minutes < 1) {
    return res.status(400).json({ error: "syncIntervalMinutes must be a positive number" });
  }

  const settings = await prisma.appSetting.upsert({
    where: { id: 1 },
    create: { id: 1, syncIntervalMinutes: minutes },
    update: { syncIntervalMinutes: minutes },
  });
  reschedule(minutes);
  res.json({ settings });
});

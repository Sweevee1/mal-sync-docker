import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/client";
import { reschedule } from "../scheduler/cron";
import { wrap } from "../http/asyncHandler";

export const settingsRouter = Router();

const updateSchema = z
  .object({ syncIntervalMinutes: z.number().int().min(5).max(10080) })
  .strict();

settingsRouter.get(
  "/",
  wrap(async (_req, res) => {
    const settings = await prisma.appSetting.upsert({
      where: { id: 1 },
      create: { id: 1 },
      update: {},
    });
    res.json({ settings });
  }),
);

settingsRouter.put(
  "/",
  wrap(async (req, res) => {
    const { syncIntervalMinutes: minutes } = updateSchema.parse(req.body ?? {});

    const settings = await prisma.appSetting.upsert({
      where: { id: 1 },
      create: { id: 1, syncIntervalMinutes: minutes },
      update: { syncIntervalMinutes: minutes },
    });
    reschedule(minutes);
    res.json({ settings });
  }),
);

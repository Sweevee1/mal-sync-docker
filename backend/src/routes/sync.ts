import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/client";
import { runSync, isSyncRunning } from "../sync/engine";
import { runCheck } from "../sync/checker";
import { wrap } from "../http/asyncHandler";
import { HttpError, safeErrorMessage } from "../http/errors";

export const syncRouter = Router();

const runBodySchema = z.object({ dryRun: z.boolean().optional() }).strict();
const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(20),
  cursor: z.coerce.number().int().positive().max(2_147_483_647).optional(),
});
const idParamsSchema = z.object({ id: z.coerce.number().int().positive().max(2_147_483_647) });

syncRouter.post(
  "/run",
  wrap(async (req, res) => {
    const { dryRun = false } = runBodySchema.parse(req.body ?? {});
    if (isSyncRunning()) {
      throw new HttpError(409, "A sync is already in progress");
    }
    // Fire and forget: the frontend polls /api/sync/status for progress.
    runSync(dryRun ? "DRY_RUN" : "MANUAL").catch((err) => {
      // eslint-disable-next-line no-console
      console.error(dryRun ? "Dry-run sync failed:" : "Manual sync failed:", safeErrorMessage(err));
    });
    res.status(202).json({ ok: true, dryRun });
  }),
);

syncRouter.post(
  "/check",
  wrap(async (_req, res) => {
    if (isSyncRunning()) {
      throw new HttpError(409, "A sync is already in progress");
    }
    runCheck().catch((err) => {
      // eslint-disable-next-line no-console
      console.error("Check failed:", safeErrorMessage(err));
    });
    res.status(202).json({ ok: true });
  }),
);

syncRouter.get(
  "/status",
  wrap(async (_req, res) => {
    const latest = await prisma.syncRun.findFirst({ orderBy: { startedAt: "desc" } });
    res.json({ running: isSyncRunning(), latest });
  }),
);

syncRouter.get(
  "/history",
  wrap(async (req, res) => {
    const { limit, cursor } = historyQuerySchema.parse(req.query);
    const runs = await prisma.syncRun.findMany({
      orderBy: { startedAt: "desc" },
      take: limit,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    res.json({ runs });
  }),
);

syncRouter.get(
  "/history/:id",
  wrap(async (req, res) => {
    const { id } = idParamsSchema.parse(req.params);
    const run = await prisma.syncRun.findUnique({
      where: { id },
      include: { entries: { orderBy: { id: "asc" } } },
    });
    if (!run) throw new HttpError(404, "Not found");
    res.json({ run });
  }),
);

import { Router } from "express";
import { prisma } from "../db/client";
import { runSync, isSyncRunning } from "../sync/engine";

export const syncRouter = Router();

syncRouter.post("/run", async (_req, res) => {
  if (isSyncRunning()) {
    return res.status(409).json({ error: "A sync is already in progress" });
  }
  // Fire and forget: the frontend polls /api/sync/status for progress.
  runSync("MANUAL").catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Manual sync failed:", err);
  });
  res.status(202).json({ ok: true });
});

syncRouter.get("/status", async (_req, res) => {
  const latest = await prisma.syncRun.findFirst({ orderBy: { startedAt: "desc" } });
  res.json({ running: isSyncRunning(), latest });
});

syncRouter.get("/history", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const cursor = req.query.cursor ? Number(req.query.cursor) : undefined;
  const runs = await prisma.syncRun.findMany({
    orderBy: { startedAt: "desc" },
    take: limit,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
  });
  res.json({ runs });
});

syncRouter.get("/history/:id", async (req, res) => {
  const id = Number(req.params.id);
  const run = await prisma.syncRun.findUnique({
    where: { id },
    include: { entries: { orderBy: { id: "asc" } } },
  });
  if (!run) return res.status(404).json({ error: "Not found" });
  res.json({ run });
});

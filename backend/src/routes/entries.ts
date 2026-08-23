import { Router } from "express";
import { prisma } from "../db/client";
import * as anilist from "../services/anilist";
import * as kitsu from "../services/kitsu";
import type { TargetService } from "../types";

export const entriesRouter = Router();

entriesRouter.get("/", async (req, res) => {
  const { type, status, service } = req.query;

  const where: Record<string, unknown> = {};
  if (type === "ANIME" || type === "MANGA") where.mediaType = type;
  if (status) {
    if (service === "ANILIST") where.anilistSyncStatus = status;
    else if (service === "KITSU") where.kitsuSyncStatus = status;
    else {
      where.OR = [{ anilistSyncStatus: status }, { kitsuSyncStatus: status }];
    }
  }

  const entries = await prisma.listEntry.findMany({ where, orderBy: { title: "asc" } });
  res.json({ entries });
});

entriesRouter.get("/pending-deletions", async (_req, res) => {
  const entries = await prisma.listEntry.findMany({
    where: { OR: [{ anilistSyncStatus: "PENDING_DELETION" }, { kitsuSyncStatus: "PENDING_DELETION" }] },
    orderBy: { title: "asc" },
  });
  res.json({ entries });
});

function validService(service: unknown): service is TargetService {
  return service === "ANILIST" || service === "KITSU";
}

entriesRouter.post("/:mediaType/:malId/confirm-deletion", async (req, res) => {
  const { mediaType, malId } = req.params;
  const { service } = req.query;
  if (!validService(service)) return res.status(400).json({ error: "service must be ANILIST or KITSU" });

  const entry = await prisma.listEntry.findUnique({
    where: { malId_mediaType: { malId: Number(malId), mediaType: String(mediaType) } },
  });
  if (!entry) return res.status(404).json({ error: "Entry not found" });

  try {
    if (service === "ANILIST") {
      if (entry.anilistListEntryId) {
        const token = await anilist.getValidAccessToken();
        await anilist.deleteEntry(token, Number(entry.anilistListEntryId));
      }
      await prisma.listEntry.update({ where: { id: entry.id }, data: { anilistSyncStatus: "NOT_APPLICABLE", anilistListEntryId: null } });
    } else {
      if (entry.kitsuLibraryEntryId) {
        const { accessToken } = await kitsu.getValidAccessToken();
        await kitsu.deleteEntry(accessToken, entry.kitsuLibraryEntryId);
      }
      await prisma.listEntry.update({ where: { id: entry.id }, data: { kitsuSyncStatus: "NOT_APPLICABLE", kitsuLibraryEntryId: null } });
    }
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Deletion failed" });
  }
});

// Dismiss the pending-deletion flag without deleting anything on the target service.
entriesRouter.post("/:mediaType/:malId/dismiss-deletion", async (req, res) => {
  const { mediaType, malId } = req.params;
  const { service } = req.query;
  if (!validService(service)) return res.status(400).json({ error: "service must be ANILIST or KITSU" });

  const entry = await prisma.listEntry.findUnique({
    where: { malId_mediaType: { malId: Number(malId), mediaType: String(mediaType) } },
  });
  if (!entry) return res.status(404).json({ error: "Entry not found" });

  const data = service === "ANILIST" ? { anilistSyncStatus: "NOT_APPLICABLE" } : { kitsuSyncStatus: "NOT_APPLICABLE" };
  await prisma.listEntry.update({ where: { id: entry.id }, data });
  res.json({ ok: true });
});

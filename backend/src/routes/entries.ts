import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/client";
import * as anilist from "../services/anilist";
import * as kitsu from "../services/kitsu";
import { wrap } from "../http/asyncHandler";
import { HttpError } from "../http/errors";

export const entriesRouter = Router();

const mediaTypeSchema = z.enum(["ANIME", "MANGA"]);
const serviceSchema = z.enum(["ANILIST", "KITSU"]);
const statusSchema = z.enum([
  "SYNCED",
  "PENDING",
  "SKIPPED_UNMAPPABLE",
  "ERROR",
  "PENDING_DELETION",
  "NOT_APPLICABLE",
]);

const listQuerySchema = z
  .object({
    type: mediaTypeSchema.optional(),
    status: statusSchema.optional(),
    service: serviceSchema.optional(),
  })
  .strict();

const deletionParamsSchema = z.object({
  mediaType: mediaTypeSchema,
  malId: z.coerce.number().int().positive().max(2_147_483_647),
});
const deletionQuerySchema = z.object({ service: serviceSchema });

entriesRouter.get(
  "/",
  wrap(async (req, res) => {
    const { type, status, service } = listQuerySchema.parse(req.query);

    const where: Record<string, unknown> = {};
    if (type) where.mediaType = type;
    if (status) {
      if (service === "ANILIST") where.anilistSyncStatus = status;
      else if (service === "KITSU") where.kitsuSyncStatus = status;
      else {
        where.OR = [{ anilistSyncStatus: status }, { kitsuSyncStatus: status }];
      }
    }

    const entries = await prisma.listEntry.findMany({ where, orderBy: { title: "asc" } });
    res.json({ entries });
  }),
);

entriesRouter.get(
  "/pending-deletions",
  wrap(async (_req, res) => {
    const entries = await prisma.listEntry.findMany({
      where: { OR: [{ anilistSyncStatus: "PENDING_DELETION" }, { kitsuSyncStatus: "PENDING_DELETION" }] },
      orderBy: { title: "asc" },
    });
    res.json({ entries });
  }),
);

async function loadEntry(rawParams: unknown, rawQuery: unknown) {
  const { mediaType, malId } = deletionParamsSchema.parse(rawParams);
  const { service } = deletionQuerySchema.parse(rawQuery);
  const entry = await prisma.listEntry.findUnique({ where: { malId_mediaType: { malId, mediaType } } });
  if (!entry) throw new HttpError(404, "Entry not found");
  return { entry, service };
}

entriesRouter.post(
  "/:mediaType/:malId/confirm-deletion",
  wrap(async (req, res) => {
    const { entry, service } = await loadEntry(req.params, req.query);

    // A real delete must only ever follow a flagged removal, never a bare request.
    const current = service === "ANILIST" ? entry.anilistSyncStatus : entry.kitsuSyncStatus;
    if (current !== "PENDING_DELETION") throw new HttpError(409, "Entry is not pending deletion");

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
  }),
);

// Dismiss the pending-deletion flag without deleting anything on the target service.
entriesRouter.post(
  "/:mediaType/:malId/dismiss-deletion",
  wrap(async (req, res) => {
    const { entry, service } = await loadEntry(req.params, req.query);

    const data = service === "ANILIST" ? { anilistSyncStatus: "NOT_APPLICABLE" } : { kitsuSyncStatus: "NOT_APPLICABLE" };
    await prisma.listEntry.update({ where: { id: entry.id }, data });
    res.json({ ok: true });
  }),
);

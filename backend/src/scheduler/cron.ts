import { prisma } from "../db/client";
import { runSync, isSyncRunning } from "../sync/engine";
import { config } from "../config/env";
import { safeErrorMessage } from "../http/errors";

let timer: NodeJS.Timeout | null = null;
let currentIntervalMinutes: number | null = null;

async function tick() {
  if (isSyncRunning()) return;
  try {
    await runSync("SCHEDULED");
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Scheduled sync failed:", safeErrorMessage(err));
  }
}

const MIN_INTERVAL_MINUTES = 5;
const MAX_INTERVAL_MINUTES = 10080;

// A bad persisted value (0, negative, NaN) would otherwise make setInterval fire at 1ms.
function clampInterval(minutes: number): number {
  if (!Number.isFinite(minutes)) return Math.min(Math.max(config.DEFAULT_SYNC_INTERVAL_MINUTES, MIN_INTERVAL_MINUTES), MAX_INTERVAL_MINUTES);
  return Math.min(Math.max(Math.floor(minutes), MIN_INTERVAL_MINUTES), MAX_INTERVAL_MINUTES);
}

export function reschedule(intervalMinutes: number): void {
  if (timer) clearInterval(timer);
  const clamped = clampInterval(intervalMinutes);
  currentIntervalMinutes = clamped;
  timer = setInterval(tick, clamped * 60 * 1000);
}

export function getIntervalMinutes(): number | null {
  return currentIntervalMinutes;
}

export async function startScheduler(): Promise<void> {
  const settings = await prisma.appSetting.upsert({
    where: { id: 1 },
    create: { id: 1, syncIntervalMinutes: config.DEFAULT_SYNC_INTERVAL_MINUTES },
    update: {},
  });
  reschedule(settings.syncIntervalMinutes);
}

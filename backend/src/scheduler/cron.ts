import { prisma } from "../db/client";
import { runSync, isSyncRunning } from "../sync/engine";
import { config } from "../config/env";

let timer: NodeJS.Timeout | null = null;
let currentIntervalMinutes: number | null = null;

async function tick() {
  if (isSyncRunning()) return;
  try {
    await runSync("SCHEDULED");
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Scheduled sync failed:", err);
  }
}

export function reschedule(intervalMinutes: number): void {
  if (timer) clearInterval(timer);
  currentIntervalMinutes = intervalMinutes;
  timer = setInterval(tick, intervalMinutes * 60 * 1000);
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

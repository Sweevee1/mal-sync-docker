// Shared mutex so a real/dry sync and a check can never run concurrently --
// both hit the same rate-limited MAL/AniList/Kitsu APIs.
let busy = false;

export function tryAcquire(): boolean {
  if (busy) return false;
  busy = true;
  return true;
}

export function release(): void {
  busy = false;
}

export function isSyncRunning(): boolean {
  return busy;
}

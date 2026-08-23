import { RateLimitError } from "../types";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Simple per-service throttle: ensures at least `minIntervalMs` passes between
 * calls made through `schedule()`, and retries once on a RateLimitError thrown
 * by the wrapped function, waiting the duration it reports.
 */
export class RateLimiter {
  private lastCallAt = 0;

  constructor(private readonly minIntervalMs: number) {}

  async schedule<T>(fn: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const wait = this.lastCallAt + this.minIntervalMs - now;
    if (wait > 0) {
      await sleep(wait);
    }
    this.lastCallAt = Date.now();

    try {
      return await fn();
    } catch (err) {
      if (err instanceof RateLimitError) {
        await sleep(err.retryAfterMs);
        this.lastCallAt = Date.now();
        return await fn();
      }
      throw err;
    }
  }
}

// ~1 req/sec, conservative defaults for services with no published hard limit.
export const malLimiter = new RateLimiter(1000);
export const kitsuLimiter = new RateLimiter(1000);
// AniList: nominal ~90/min, currently degraded to ~30/min -> ~1 req/2sec to stay safe.
export const anilistLimiter = new RateLimiter(2000);

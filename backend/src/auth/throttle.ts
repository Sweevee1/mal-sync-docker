const IP_LIMIT = 5;
const IP_WINDOW_MS = 15 * 60 * 1000;
const MAX_TRACKED_IPS = 10000;

interface Attempt {
  t: number;
}

// One IPv6 subscriber typically controls a whole /64, so keying on the full
// address would let an attacker rotate through billions of free buckets.
export function throttleKey(ip: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1];
  if (!ip.includes(":")) return ip;
  const [head, tail = ""] = ip.split("::");
  const headParts = head ? head.split(":") : [];
  const tailParts = tail ? tail.split(":") : [];
  const gap = ip.includes("::") ? new Array(Math.max(0, 8 - headParts.length - tailParts.length)).fill("0") : [];
  const groups = [...headParts, ...gap, ...tailParts].map((g) => g.toLowerCase().padStart(4, "0"));
  return `v6:${groups.slice(0, 4).join(":")}`;
}

// Attempts are recorded before the (slow, async) password check and refunded
// on success, so parallel guesses cannot all pass a check-then-fail window.
// There is deliberately no shared global failure budget: it would let an
// anonymous client lock the owner out.
// A factory rather than module state so each app instance gets its own counters.
export function createLoginThrottle(now: () => number = Date.now) {
  const perIp = new Map<string, Attempt[]>();

  function live(ip: string): Attempt[] {
    const cutoff = now() - IP_WINDOW_MS;
    return (perIp.get(ip) ?? []).filter((a) => a.t > cutoff);
  }

  return {
    /** Records an attempt. wait is the seconds to back off, or 0 if it may proceed. */
    attempt(rawIp: string): { wait: number; refund: () => void } {
      const ip = throttleKey(rawIp);
      const mine = live(ip);
      if (mine.length >= IP_LIMIT) {
        perIp.set(ip, mine);
        const wait = Math.max(1, Math.ceil((mine[mine.length - IP_LIMIT].t + IP_WINDOW_MS - now()) / 1000));
        return { wait, refund: () => {} };
      }
      const entry: Attempt = { t: now() };
      mine.push(entry);
      // Re-inserting keeps Map order oldest-first so eviction drops the stalest IP.
      perIp.delete(ip);
      perIp.set(ip, mine);
      if (perIp.size > MAX_TRACKED_IPS) {
        const oldest = perIp.keys().next().value;
        if (oldest !== undefined) perIp.delete(oldest);
      }
      return {
        wait: 0,
        refund: () => {
          const list = perIp.get(ip);
          if (!list) return;
          const rest = list.filter((a) => a !== entry);
          if (rest.length) perIp.set(ip, rest);
          else perIp.delete(ip);
        },
      };
    },
  };
}

// Bounds how many scrypt derivations (tens of MB and ~100ms CPU each) can run
// at once, so a flood from many IPs cannot exhaust memory or starve the loop.
export function createConcurrencyGate(max: number) {
  let active = 0;
  return {
    tryEnter(): boolean {
      if (active >= max) return false;
      active++;
      return true;
    },
    leave(): void {
      active = Math.max(0, active - 1);
    },
  };
}

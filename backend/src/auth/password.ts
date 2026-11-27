import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt) as (
  password: crypto.BinaryLike,
  salt: crypto.BinaryLike,
  keylen: number,
  options: crypto.ScryptOptions
) => Promise<Buffer>;

const SHAPE = /^scrypt:(\d+):(\d+):(\d+):([A-Za-z0-9_-]+):([A-Za-z0-9_-]+)$/;

export interface ParsedHash {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
}

export function parseScryptHash(value: string): ParsedHash | null {
  const m = SHAPE.exec(value);
  if (!m) return null;
  const N = Number(m[1]);
  const r = Number(m[2]);
  const p = Number(m[3]);
  const salt = Buffer.from(m[4], "base64url");
  const hash = Buffer.from(m[5], "base64url");
  // Bounds stop a malformed env value from making every login allocate huge memory.
  if (!Number.isInteger(N) || N < 2 || N > 1 << 20 || (N & (N - 1)) !== 0) return null;
  if (!Number.isInteger(r) || r < 1 || r > 32) return null;
  if (!Number.isInteger(p) || p < 1 || p > 16) return null;
  if (salt.length < 8 || hash.length < 16 || hash.length > 128) return null;
  return { N, r, p, salt, hash };
}

export function isValidScryptHash(value: string): boolean {
  return parseScryptHash(value) !== null;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseScryptHash(stored);
  if (!parsed) return false;
  const { N, r, p, salt, hash } = parsed;
  const derived = await scrypt(password, salt, hash.length, {
    N,
    r,
    p,
    maxmem: 256 * N * r + 1024 * 1024,
  });
  return crypto.timingSafeEqual(derived, hash);
}

// N=16384, r=8, p=1 with a 64-byte key; verifyPassword reads the parameters back from the string.
export async function hashPassword(password: string): Promise<string> {
  const N = 16384;
  const r = 8;
  const p = 1;
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64, { N, r, p, maxmem: 256 * N * r + 1024 * 1024 });
  return `scrypt:${N}:${r}:${p}:${salt.toString("base64url")}:${hash.toString("base64url")}`;
}

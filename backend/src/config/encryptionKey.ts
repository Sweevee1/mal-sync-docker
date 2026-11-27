import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const KEY_FILE_NAME = "encryption.key";

export function isValidKey(value: string): boolean {
  return /^[A-Za-z0-9+/_-]+={0,2}$/.test(value) && Buffer.from(value, "base64").length === 32;
}

// Relative file: URLs resolve against backend/prisma, matching the Prisma CLI.
// The runtime client can disagree, so Docker uses an absolute path.
export function dataDirFromDatabaseUrl(databaseUrl: string): string {
  const raw = databaseUrl.replace(/^file:/, "").split("?")[0];
  const file = path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), "prisma", raw);
  return path.dirname(file);
}

export interface ResolvedKey {
  key: string;
  warnings: string[];
}

function readKeyFile(file: string): string | null {
  try {
    const value = fs.readFileSync(file, "utf8").trim();
    return value || null;
  } catch (err: any) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}

// An env value wins, but is also copied to the key file when none exists, so
// removing the variable later keeps the same key and stored credentials stay
// readable. Must stay synchronous: secretBox reads the key at import.
export function resolveEncryptionKey(envValue: string | undefined, dataDir: string): ResolvedKey {
  const file = path.join(dataDir, KEY_FILE_NAME);
  const warnings: string[] = [];
  const existing = readKeyFile(file);

  if (existing !== null && !isValidKey(existing)) {
    throw new Error(`${file} does not contain a base64-encoded 32-byte key. Fix or remove it.`);
  }

  if (envValue) {
    if (existing === null) {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(file, `${envValue}\n`, { flag: "wx", mode: 0o600 });
    } else if (existing !== envValue) {
      warnings.push(
        `ENCRYPTION_KEY differs from ${file}. The variable is used; credentials encrypted with the file's key will be unreadable until they are reconnected.`
      );
    }
    return { key: envValue, warnings };
  }

  if (existing !== null) return { key: existing, warnings };

  const key = crypto.randomBytes(32).toString("base64");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, `${key}\n`, { flag: "wx", mode: 0o600 });
  warnings.push(`Generated a new encryption key at ${file}. Keep it with your database backups.`);
  return { key, warnings };
}

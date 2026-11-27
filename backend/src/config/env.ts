import { z } from "zod";
import dotenv from "dotenv";
import { isValidScryptHash } from "../auth/password";
import { dataDirFromDatabaseUrl, isValidKey, resolveEncryptionKey } from "./encryptionKey";

dotenv.config();

const HASH_HELP =
  "Generate one with: docker run --rm -i --entrypoint node ghcr.io/sweevee1/mal-sync-docker:latest dist/tools/hashPassword.js (local dev: npm run hash-password -w backend).";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  // Optional: when unset a key is generated and kept in <data dir>/encryption.key.
  ENCRYPTION_KEY: z
    .string()
    .optional()
    .transform((v) => (v?.trim() ? v.trim() : undefined))
    .refine(
      (val) => val === undefined || isValidKey(val),
      "ENCRYPTION_KEY must be a base64-encoded 32-byte key (generate with: openssl rand -base64 32)"
    ),
  // MAL/AniList OAuth client id+secret are entered via the Connect Services UI
  // and stored in ServiceCredential, not configured here; see routes/auth.ts.
  DEFAULT_SYNC_INTERVAL_MINUTES: z.coerce.number().int().positive().default(60),
  DATABASE_URL: z.string().min(1),
  // Only set to "true" if this app sits behind a reverse proxy that terminates
  // HTTPS and sets X-Forwarded-Proto. Never enable this if the app's port is
  // exposed directly, since a client could forge that header to fake HTTPS and
  // unlock Kitsu password login over a genuinely plaintext connection.
  TRUST_PROXY: z
    .string()
    .optional()
    .default("false")
    .transform((v) => v === "true"),
  // Only consulted when TRUST_PROXY=true. Restricts which peers may set
  // X-Forwarded-* so a client on the LAN cannot forge them.
  TRUST_PROXY_CIDRS: z
    .string()
    .optional()
    .default("loopback")
    .transform((v) =>
      v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    ),
  // Optional: when unset the owner picks a password on first visit (setup mode).
  // The runtime image has no npm, so the error points at the compiled tool.
  ADMIN_PASSWORD_HASH: z
    .string()
    .optional()
    .transform((v) => (v?.trim() ? v.trim() : undefined))
    .refine(
      (val) => val === undefined || isValidScryptHash(val),
      `ADMIN_PASSWORD_HASH must look like scrypt:N:r:p:<salt>:<hash>. ${HASH_HELP}`
    ),
  // One boot only: clears the stored password and returns to setup mode.
  RESET_ADMIN_PASSWORD: z
    .string()
    .optional()
    .default("false")
    .transform((v) => v === "true"),
  // When set, used verbatim to build OAuth redirect URIs and cookie settings.
  // When unset ("LAN mode") see auth/peer.ts resolveBaseUrl.
  PUBLIC_BASE_URL: z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (!v?.trim()) return undefined;
      try {
        const u = new URL(v.trim());
        if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("protocol");
        return `${u.protocol}//${u.host}`;
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "PUBLIC_BASE_URL must be an absolute http(s) URL" });
        return z.NEVER;
      }
    }),
});

export type Config = Omit<z.infer<typeof envSchema>, "ENCRYPTION_KEY"> & { ENCRYPTION_KEY: string };

export const keyWarnings: string[] = [];

function loadConfig(): Config {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    // eslint-disable-next-line no-console
    console.error(`Invalid environment configuration:\n${issues}`);
    process.exit(1);
  }
  try {
    const resolved = resolveEncryptionKey(parsed.data.ENCRYPTION_KEY, dataDirFromDatabaseUrl(parsed.data.DATABASE_URL));
    keyWarnings.push(...resolved.warnings);
    return { ...parsed.data, ENCRYPTION_KEY: resolved.key };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`Encryption key unavailable: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

export const config = loadConfig();

export function isHttpsBase(cfg: Pick<Config, "PUBLIC_BASE_URL">): boolean {
  return cfg.PUBLIC_BASE_URL?.startsWith("https:") ?? false;
}

export function startupWarnings(cfg: Pick<Config, "PUBLIC_BASE_URL" | "TRUST_PROXY">): string[] {
  const warnings = [...keyWarnings];
  if (isHttpsBase(cfg) && !cfg.TRUST_PROXY) {
    warnings.push(
      "PUBLIC_BASE_URL is https but TRUST_PROXY is false. Logins will be rejected until TRUST_PROXY=true and TRUST_PROXY_CIDRS names your reverse proxy."
    );
  }
  if (cfg.TRUST_PROXY && !cfg.PUBLIC_BASE_URL) {
    warnings.push(
      "TRUST_PROXY is true but PUBLIC_BASE_URL is not set. Behind a proxy or tunnel, set PUBLIC_BASE_URL so OAuth redirect URIs and cookies use your public address."
    );
  }
  return warnings;
}

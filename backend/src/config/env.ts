import { z } from "zod";
import dotenv from "dotenv";
import { isValidScryptHash } from "../auth/password";

dotenv.config();

const HASH_HELP =
  "Generate one with: docker run --rm -i --entrypoint node ghcr.io/sweevee1/mal-sync-docker:latest dist/tools/hashPassword.js (local dev: npm run hash-password -w backend).";

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  ENCRYPTION_KEY: z
    .string()
    .min(1, "ENCRYPTION_KEY is required (generate with: openssl rand -base64 32)")
    .refine((val) => {
      try {
        return Buffer.from(val, "base64").length === 32;
      } catch {
        return false;
      }
    }, "ENCRYPTION_KEY must be a base64-encoded 32-byte key (generate with: openssl rand -base64 32)"),
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
  // The runtime image has no npm, so the error points at the compiled tool.
  ADMIN_PASSWORD_HASH: z
    .string()
    .min(1, `ADMIN_PASSWORD_HASH is required. ${HASH_HELP}`)
    .refine(isValidScryptHash, `ADMIN_PASSWORD_HASH must look like scrypt:N:r:p:<salt>:<hash>. ${HASH_HELP}`),
  // Used verbatim to build OAuth redirect URIs instead of trusting the Host header.
  PUBLIC_BASE_URL: z
    .string()
    .min(1, "PUBLIC_BASE_URL is required (e.g. https://malsync.example.com)")
    .transform((v, ctx) => {
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

export type Config = z.infer<typeof envSchema>;

function loadConfig() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    // eslint-disable-next-line no-console
    console.error(`Invalid environment configuration:\n${issues}`);
    process.exit(1);
  }
  return parsed.data;
}

export const config = loadConfig();

export function isHttpsBase(cfg: Pick<Config, "PUBLIC_BASE_URL">): boolean {
  return cfg.PUBLIC_BASE_URL.startsWith("https:");
}

export function startupWarnings(cfg: Pick<Config, "PUBLIC_BASE_URL" | "TRUST_PROXY">): string[] {
  if (isHttpsBase(cfg) && !cfg.TRUST_PROXY) {
    return [
      "PUBLIC_BASE_URL is https but TRUST_PROXY is false. Logins will be rejected until TRUST_PROXY=true and TRUST_PROXY_CIDRS names your reverse proxy.",
    ];
  }
  return [];
}

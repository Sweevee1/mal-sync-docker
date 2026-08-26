import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

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
  // exposed directly -- a client could forge that header to fake HTTPS and
  // unlock Kitsu password login over a genuinely plaintext connection.
  TRUST_PROXY: z
    .string()
    .optional()
    .default("false")
    .transform((v) => v === "true"),
});

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

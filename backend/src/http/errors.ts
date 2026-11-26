export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

const MAX_LENGTH = 200;

// Kitsu's JSON:API error body and AniList's GraphQL error list carry the
// actual validation reason; the generic axios "Request failed with status
// code N" message alone isn't enough to diagnose a per-entry push failure.
function rawMessage(err: any): string {
  const kitsuErrors = err?.response?.data?.errors;
  if (Array.isArray(kitsuErrors) && kitsuErrors.length > 0) {
    const joined = kitsuErrors.map((e: any) => e?.detail ?? e?.title).filter(Boolean).join("; ");
    if (joined) return joined;
  }
  const graphqlErrors = err?.response?.errors;
  if (Array.isArray(graphqlErrors) && graphqlErrors.length > 0) {
    const joined = graphqlErrors.map((e: any) => e?.message).filter(Boolean).join("; ");
    if (joined) return joined;
  }
  return typeof err?.message === "string" ? err.message : String(err);
}

// Stored and shown to the UI, so it must never carry tokens or Prisma
// internals (which embed query text and file paths).
export function safeErrorMessage(err: unknown): string {
  const message = rawMessage(err);
  if (/prisma/i.test(message)) return "Database error";
  const cleaned = message
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || "Unknown error").slice(0, MAX_LENGTH);
}

import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { Config } from "../config/env";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function hostOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

// SameSite=Strict on the session cookie is the primary defense; this is the
// second layer. A cross-site form cannot set a custom header, and Origin must
// match the request Host or the configured public host (a tunnel such as
// cloudflared may rewrite Host before it reaches us).
export function createCsrfGuard(cfg: Pick<Config, "PUBLIC_BASE_URL">): RequestHandler {
  const publicHost = hostOf(cfg.PUBLIC_BASE_URL);
  return (req: Request, res: Response, next: NextFunction) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const originHost = hostOf(req.get("origin"));
    const hostOk = originHost !== null && (originHost === req.get("host") || originHost === publicHost);
    if (!hostOk || req.get("x-msd-request") !== "1") {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
}

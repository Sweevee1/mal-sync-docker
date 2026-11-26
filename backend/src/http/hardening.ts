import express, { type ErrorRequestHandler, type Express } from "express";
import helmet from "helmet";
import { ZodError } from "zod";
import { HttpError } from "./errors";

export function applySecurityMiddleware(app: Express): void {
  app.disable("x-powered-by");
  app.set("query parser", "simple");
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          "default-src": ["'self'"],
          "script-src": ["'self'"],
          "style-src": ["'self'"],
          "img-src": ["'self'", "data:"],
          "connect-src": ["'self'"],
          "frame-ancestors": ["'none'"],
          "form-action": ["'self'"],
          "base-uri": ["'none'"],
        },
      },
    }),
  );
  app.use(express.json({ limit: "16kb" }));
}

const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) return next(err);

  // body-parser errors carry a 4xx status and a `type`; keep the status only.
  const bodyStatus = typeof err?.status === "number" && typeof err?.type === "string" ? err.status : null;
  if (bodyStatus !== null && bodyStatus >= 400 && bodyStatus < 500) {
    const message = bodyStatus === 413 ? "Request body too large" : "Invalid request body";
    return res.status(bodyStatus).json({ error: message });
  }
  if (err instanceof ZodError) return res.status(400).json({ error: "Invalid request" });
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });

  // Only the message: axios errors carry Authorization headers in err.config.
  // eslint-disable-next-line no-console
  console.error("Unhandled error:", typeof err?.message === "string" ? err.message : "unknown");
  res.status(500).json({ error: "Internal error" });
};

export function applyErrorHandler(app: Express): void {
  app.use(errorHandler);
}

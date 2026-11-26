import express from "express";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config/env";
import type { Config } from "./config/env";
import { createAuthRouters } from "./routes/auth";
import { syncRouter } from "./routes/sync";
import { entriesRouter } from "./routes/entries";
import { settingsRouter } from "./routes/settings";
import { statusRouter } from "./routes/status";
import { createSessionRouter } from "./routes/session";
import { createCsrfGuard } from "./auth/csrf";
import { createRequireSession } from "./auth/session";
import { applyErrorHandler, applySecurityMiddleware } from "./http/hardening";

// Overrides exist so tests can build apps with different proxy/base-URL
// settings in one process; production always calls createApp() with none.
export function createApp(overrides: Partial<Config> = {}) {
  const cfg: Config = { ...config, ...overrides };
  const { authRouter, authCallbackRouter } = createAuthRouters(cfg);
  const app = express();
  // Only honor X-Forwarded-* (and therefore req.secure) when the operator
  // has explicitly confirmed a reverse proxy sits in front. See config/env.ts.
  if (cfg.TRUST_PROXY) {
    app.set("trust proxy", cfg.TRUST_PROXY_CIDRS);
  }
  applySecurityMiddleware(app);

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  // Only guards non-GET/HEAD/OPTIONS, so it sits before the public session
  // routes (login/logout must be guarded too) and the GET-only OAuth callbacks.
  app.use("/api", createCsrfGuard(cfg));
  app.use("/api/session", createSessionRouter(cfg));
  app.use("/api/auth", authCallbackRouter);

  app.use("/api", createRequireSession(cfg));

  app.use("/api/auth", authRouter);
  app.use("/api/sync", syncRouter);
  app.use("/api/entries", entriesRouter);
  app.use("/api/settings", settingsRouter);
  app.use("/api/status", statusRouter);
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  const publicDir = path.join(__dirname, "..", "public");
  const indexHtml = path.join(publicDir, "index.html");
  // Only Docker's build copies the built frontend into backend/public (see
  // Dockerfile). In local dev the frontend runs separately via Vite (default
  // port 5173), so there's nothing to serve here; redirect there instead of
  // 500ing, which matters for OAuth callbacks that redirect to "/" on this
  // server's own port after connecting MAL/AniList.
  const hasBuiltFrontend = fs.existsSync(indexHtml);
  if (hasBuiltFrontend) {
    app.use(express.static(publicDir));
  }
  app.get(/^\/(?!api).*/, (req, res) => {
    if (hasBuiltFrontend) {
      res.sendFile(indexHtml);
    } else {
      res.redirect(`http://localhost:5173${req.originalUrl}`);
    }
  });

  applyErrorHandler(app);
  return app;
}

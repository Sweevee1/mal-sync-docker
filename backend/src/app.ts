import express from "express";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config/env";
import { authRouter } from "./routes/auth";
import { syncRouter } from "./routes/sync";
import { entriesRouter } from "./routes/entries";
import { settingsRouter } from "./routes/settings";
import { statusRouter } from "./routes/status";

export function createApp() {
  const app = express();
  // Only honor X-Forwarded-Proto (and therefore req.secure) when the operator
  // has explicitly confirmed a reverse proxy sits in front. See config/env.ts.
  if (config.TRUST_PROXY) {
    app.set("trust proxy", 1);
  }
  app.use(express.json());

  app.use("/api/auth", authRouter);
  app.use("/api/sync", syncRouter);
  app.use("/api/entries", entriesRouter);
  app.use("/api/settings", settingsRouter);
  app.use("/api/status", statusRouter);

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

  return app;
}

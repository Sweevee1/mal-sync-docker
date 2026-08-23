import express from "express";
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
  app.use(express.static(publicDir));
  app.get(/^\/(?!api).*/, (_req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });

  return app;
}

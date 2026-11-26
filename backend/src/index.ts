import { config, startupWarnings } from "./config/env";
import { createApp } from "./app";
import { startScheduler } from "./scheduler/cron";
import { initAuth } from "./auth/session";

async function main() {
  for (const warning of startupWarnings(config)) {
    // eslint-disable-next-line no-console
    console.warn(warning);
  }
  await initAuth();
  const app = createApp();
  await startScheduler();

  app.listen(config.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`MAL-Sync listening on port ${config.PORT}`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Fatal startup error:", err);
  process.exit(1);
});

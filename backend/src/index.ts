import { config } from "./config/env";
import { createApp } from "./app";
import { startScheduler } from "./scheduler/cron";

async function main() {
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

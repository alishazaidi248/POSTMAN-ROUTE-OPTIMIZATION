import { createApp } from "./app";
import { env } from "./config/env";
import { logger } from "./config/logger";
import { ensureUploadDirs } from "./services/imports/fileSecurity";
import { registerRouteEventListeners } from "./services/routeEvents.listener";
import { repairUnassignedDeliveries } from "./services/assignment.service";

async function main() {
  await ensureUploadDirs();
  registerRouteEventListeners();
  const app = createApp();
  app.listen(env.port, () => {
    logger.info(`Postal Admin API listening on port ${env.port}`);
  });

  // Nothing is kept in memory across restarts - PostgreSQL is the source of truth.
  // This only finishes work a previous run may have been interrupted in the middle
  // of (a delivery that was saved but not yet matched to a beat).
  repairUnassignedDeliveries()
    .then((r) => logger.info(r, "startup repair of unassigned deliveries finished"))
    .catch((err) => logger.error({ err }, "startup repair failed"));
}

main().catch((err) => {
  logger.error({ err }, "Failed to start server");
  process.exit(1);
});

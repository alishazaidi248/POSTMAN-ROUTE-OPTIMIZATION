import { createApp } from "./app";
import { env } from "./config/env";
import { logger } from "./config/logger";
import { ensureUploadDirs } from "./services/imports/fileSecurity";

async function main() {
  await ensureUploadDirs();
  const app = createApp();
  app.listen(env.port, () => {
    logger.info(`Postal Admin API listening on port ${env.port}`);
  });
}

main().catch((err) => {
  logger.error({ err }, "Failed to start server");
  process.exit(1);
});

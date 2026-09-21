import { defineConfig } from "vitest/config";
import os from "node:os";
import path from "node:path";

/**
 * Integration tests: the real PostgreSQL/PostGIS database, nothing mocked. They TRUNCATE every table, so they refuse to
 * run unless DATABASE_URL names a database ending in "_test" (see tests/integration/db.ts).
 *
 *   createdb postal_test && DATABASE_URL=postgresql://...postal_test npx prisma migrate deploy
 *   DATABASE_URL=postgresql://...postal_test npm run test:integration
 */
export default defineConfig({
  test: {
    include: ["tests/integration/**/*.itest.ts"],
    environment: "node",
    // one database, so one file at a time
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: "test",
      JWT_ACCESS_SECRET: "test-access-secret",
      JWT_REFRESH_SECRET: "test-refresh-secret",
      OSRM_BASE_URL: "",
      // proof photos and other uploads written by the tests go to a temp folder, not into the project
      UPLOAD_DIR: path.join(os.tmpdir(), "postal-integration-uploads")
    }
  }
});

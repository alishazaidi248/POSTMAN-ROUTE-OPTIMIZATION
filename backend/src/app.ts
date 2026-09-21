import express from "express";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import swaggerUi from "swagger-ui-express";
import YAML from "yamljs";
import path from "path";

import { env } from "./config/env";
import { logger } from "./config/logger";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";

import { authRouter } from "./routes/auth.routes";
import { meRouter } from "./routes/me.routes";
import { usersRouter } from "./routes/users.routes";
import { dashboardRouter } from "./routes/dashboard.routes";
import { postOfficesRouter } from "./routes/postOffices.routes";
import { postmenRouter } from "./routes/postmen.routes";
import { beatsRouter } from "./routes/beats.routes";
import { beatImportRouter } from "./routes/beatImport.routes";
import { PROFILE_URL_PREFIX, profileImageDirectory } from "./services/storage/imageStorage";
import { vehiclesRouter } from "./routes/vehicles.routes";
import { deliveriesRouter } from "./routes/deliveries.routes";
import { importsRouter } from "./routes/imports.routes";
import { geocodingRouter } from "./routes/geocoding.routes";
import { assignmentsRouter } from "./routes/assignments.routes";
import { mapsRouter } from "./routes/maps.routes";
import { reportsRouter } from "./routes/reports.routes";
import { notificationsRouter } from "./routes/notifications.routes";
import { auditLogsRouter } from "./routes/auditLogs.routes";
import { optimizationRouter } from "./routes/optimization.routes";
import { researchRouter } from "./routes/research.routes";
import { dataQualityRouter } from "./routes/dataQuality.routes";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.corsOrigin, credentials: true }));
  // Profile pictures only (never the upload folder as a whole). Names are random UUIDs, they are served
  // as images and nothing else, and the other apps (admin panel, mobile app) may embed them.
  app.use(
    PROFILE_URL_PREFIX,
    (_req, res, next) => {
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "public, max-age=86400, immutable");
      next();
    },
    express.static(profileImageDirectory(), { index: false, dotfiles: "deny" })
  );
  app.use(compression());
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(pinoHttp({ logger }));

  const globalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 600, standardHeaders: true, legacyHeaders: false });
  app.use("/api", globalLimiter);

  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });
  app.use("/api/v1/auth/login", authLimiter);

  try {
    const openapiPath = path.join(__dirname, "..", "openapi.yaml");
    const openapiDocument = YAML.load(openapiPath);
    app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(openapiDocument));
  } catch (err) {
    logger.warn({ err }, "OpenAPI spec not loaded");
  }

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/me", meRouter);
  app.use("/api/v1/users", usersRouter);
  app.use("/api/v1/dashboard", dashboardRouter);
  app.use("/api/v1/post-offices", postOfficesRouter);
  app.use("/api/v1/postmen", postmenRouter);
  // The import wizard's routes come first so "import" is never taken for a beat id.
  app.use("/api/v1/beats/import", beatImportRouter);
  app.use("/api/v1/beats", beatsRouter);
  app.use("/api/v1/vehicles", vehiclesRouter);
  app.use("/api/v1/deliveries", deliveriesRouter);
  app.use("/api/v1/imports", importsRouter);
  app.use("/api/v1/geocoding", geocodingRouter);
  app.use("/api/v1/assignments", assignmentsRouter);
  app.use("/api/v1/maps", mapsRouter);
  app.use("/api/v1/reports", reportsRouter);
  app.use("/api/v1/notifications", notificationsRouter);
  app.use("/api/v1/audit-logs", auditLogsRouter);
  app.use("/api/v1/optimization", optimizationRouter);
  app.use("/api/v1/research", researchRouter);
  app.use("/api/v1/data-quality", dataQualityRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

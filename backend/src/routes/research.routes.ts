import { Router } from "express";
import { prisma } from "../config/prisma";
import { requireAuth, resolvePostOfficeScope, adminOnly } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";

/**
 * Placeholders for the future research pipeline (spec §38). These endpoints
 * return only real, stored data — never synthetic clustering/Ripley's K
 * results. Until the research engine publishes OptimizationResult rows with
 * the relevant requestType, these come back empty so the UI can render an
 * honest "no analysis has been run yet" state instead of fabricated charts.
 */
export const researchRouter = Router();
researchRouter.use(requireAuth, adminOnly);

researchRouter.get(
  "/density",
  asyncHandler(async (req, res) => {
    const postOfficeId = resolvePostOfficeScope(req);
    const results = await prisma.optimizationResult.findMany({
      where: { optimizationRequest: { requestType: "DELIVERY_DENSITY", postOfficeId } },
      orderBy: { createdAt: "desc" },
      take: 1
    });
    res.json({ available: results.length > 0, result: results[0] ?? null });
  })
);

researchRouter.get(
  "/clusters",
  asyncHandler(async (req, res) => {
    const postOfficeId = resolvePostOfficeScope(req);
    const results = await prisma.optimizationResult.findMany({
      where: { optimizationRequest: { requestType: "DBSCAN_CLUSTERS", postOfficeId } },
      orderBy: { createdAt: "desc" },
      take: 1
    });
    res.json({ available: results.length > 0, result: results[0] ?? null });
  })
);

researchRouter.get(
  "/ripley",
  asyncHandler(async (req, res) => {
    const postOfficeId = resolvePostOfficeScope(req);
    const results = await prisma.optimizationResult.findMany({
      where: { optimizationRequest: { requestType: "RIPLEY_KL", postOfficeId } },
      orderBy: { createdAt: "desc" },
      take: 1
    });
    res.json({ available: results.length > 0, result: results[0] ?? null });
  })
);

researchRouter.get(
  "/benchmarks",
  asyncHandler(async (req, res) => {
    const postOfficeId = resolvePostOfficeScope(req);
    const results = await prisma.optimizationResult.findMany({
      where: { optimizationRequest: { requestType: "ALGORITHM_BENCHMARK", postOfficeId } },
      orderBy: { createdAt: "desc" },
      take: 20
    });
    res.json({ available: results.length > 0, results });
  })
);

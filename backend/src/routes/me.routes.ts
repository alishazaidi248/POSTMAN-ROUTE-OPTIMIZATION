import { Router } from "express";
import { z } from "zod";
import { DeliveryStatus } from "@prisma/client";
import { prisma } from "../config/prisma";
import { requireAuth, requireRole } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../utils/asyncHandler";
import { resolveSelfPostman } from "../services/postmanSelf.service";
import { getOptimizationService } from "../services/optimization";
import { recordAudit } from "../services/audit.service";

/**
 * Self-service endpoints for the React Native postman app (spec §36 gap
 * analysis). Every handler re-derives the caller's Postman record from the
 * verified access token via resolveSelfPostman — a POSTMAN login can never
 * read or write another postman's data by supplying a different id.
 */
export const meRouter = Router();
meRouter.use(requireAuth, requireRole("POSTMAN"));

meRouter.get(
  "/profile",
  asyncHandler(async (req, res) => {
    const postman = await resolveSelfPostman(req);
    const [beat, latestLocation] = await Promise.all([
      postman.assignedBeatId
        ? prisma.beat.findUnique({ where: { id: postman.assignedBeatId } })
        : Promise.resolve(null),
      prisma.postmanLocationHistory.findFirst({
        where: { postmanId: postman.id },
        orderBy: { recordedAt: "desc" }
      })
    ]);
    res.json({ postman, beat, lastKnownLocation: latestLocation });
  })
);

meRouter.get(
  "/stats",
  asyncHandler(async (req, res) => {
    const postman = await resolveSelfPostman(req);
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [total, delivered, failed, pending] = await Promise.all([
      prisma.delivery.count({ where: { assignedPostmanId: postman.id, updatedAt: { gte: startOfDay } } }),
      prisma.delivery.count({ where: { assignedPostmanId: postman.id, status: "DELIVERED", updatedAt: { gte: startOfDay } } }),
      prisma.delivery.count({
        where: {
          assignedPostmanId: postman.id,
          status: { in: ["FAILED", "REJECTED", "WRONG_ADDRESS", "ADDRESS_NOT_FOUND", "RETURNED"] },
          updatedAt: { gte: startOfDay }
        }
      }),
      prisma.delivery.count({
        where: {
          assignedPostmanId: postman.id,
          status: { in: ["ASSIGNED", "OUT_FOR_DELIVERY", "RESCHEDULED", "RECIPIENT_UNAVAILABLE"] }
        }
      })
    ]);

    res.json({
      today: { total, completed: delivered, failed, remaining: pending },
      completionRate: total > 0 ? Number((delivered / total).toFixed(2)) : 0
    });
  })
);

const deliveriesQuerySchema = z.object({
  query: z.object({
    status: z.nativeEnum(DeliveryStatus).optional(),
    page: z.string().optional(),
    pageSize: z.string().optional()
  })
});

meRouter.get(
  "/deliveries",
  validate(deliveriesQuerySchema),
  asyncHandler(async (req, res) => {
    const postman = await resolveSelfPostman(req);
    const { status, page = "1", pageSize = "50" } = req.query as Record<string, string>;
    const take = Math.min(100, Number(pageSize) || 50);
    const skip = (Math.max(1, Number(page) || 1) - 1) * take;

    const where = { assignedPostmanId: postman.id, ...(status ? { status: status as DeliveryStatus } : {}) };

    const [total, rows] = await Promise.all([
      prisma.delivery.count({ where }),
      prisma.delivery.findMany({
        where,
        include: { recipient: true, address: true, beat: { select: { beatNumber: true, name: true } } },
        orderBy: { createdAt: "asc" },
        take,
        skip
      })
    ]);

    res.json({ total, page: Number(page), pageSize: take, rows });
  })
);

meRouter.get(
  "/route",
  asyncHandler(async (req, res) => {
    const postman = await resolveSelfPostman(req);

    // Optimization results aren't stored on Route/RouteStop yet (spec §4/§18
    // gap) — the current source of truth is the most recent completed
    // OptimizationRequest scoped to this postman.
    const latestRequest = await prisma.optimizationRequest.findFirst({
      where: {
        postOfficeId: postman.postOfficeId,
        status: "COMPLETED",
        parameters: { path: ["postmanId"], equals: postman.id }
      },
      orderBy: { createdAt: "desc" },
      include: { results: { orderBy: { createdAt: "desc" }, take: 1 } }
    });

    if (!latestRequest || latestRequest.results.length === 0) {
      return res.json({ route: null });
    }

    res.json({
      routeId: latestRequest.id,
      version: latestRequest.results.length,
      trigger: latestRequest.requestType,
      status: latestRequest.status,
      generatedAt: latestRequest.results[0].createdAt,
      solution: latestRequest.results[0].resultData
    });
  })
);

const reoptimizeSchema = z.object({
  body: z.object({
    trigger: z.enum([
      "DELIVERY_COMPLETED",
      "RECIPIENT_UNAVAILABLE",
      "WRONG_ADDRESS",
      "ADDRESS_NOT_FOUND",
      "DELIVERY_FAILED",
      "ROUTE_DEVIATION",
      "MANUAL"
    ])
  })
});

meRouter.post(
  "/route/reoptimize",
  validate(reoptimizeSchema),
  asyncHandler(async (req, res) => {
    const postman = await resolveSelfPostman(req);
    if (!postman.assignedBeatId) {
      return res.status(409).json({ message: "Postman has no assigned beat" });
    }

    const remaining = await prisma.delivery.findMany({
      where: {
        assignedPostmanId: postman.id,
        status: { in: ["ASSIGNED", "OUT_FOR_DELIVERY", "RESCHEDULED"] }
      },
      select: { id: true }
    });

    if (remaining.length === 0) {
      return res.json({ route: null, message: "No remaining deliveries to route" });
    }

    const problem = {
      postOfficeId: postman.postOfficeId,
      beatId: postman.assignedBeatId,
      postmanId: postman.id,
      deliveryIds: remaining.map((d) => d.id),
      requestType: "REOPTIMIZE" as const
    };

    const request = await prisma.optimizationRequest.create({
      data: {
        postOfficeId: postman.postOfficeId,
        requestType: "REOPTIMIZE",
        parameters: problem,
        status: "RUNNING"
      }
    });

    const solution = await getOptimizationService().reoptimize(problem, req.body.trigger);

    const result = await prisma.optimizationResult.create({
      data: { optimizationRequestId: request.id, resultData: solution as any, source: "MOCK" }
    });

    await prisma.optimizationRequest.update({ where: { id: request.id }, data: { status: "COMPLETED" } });
    await recordAudit({
      req,
      action: "ROUTE_REOPTIMIZED",
      entityType: "OptimizationRequest",
      entityId: request.id,
      reason: req.body.trigger
    });

    res.status(201).json({ routeId: request.id, generatedAt: result.createdAt, solution });
  })
);

const locationSchema = z.object({
  body: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    batteryPct: z.number().min(0).max(100).optional(),
    isMock: z.boolean().optional()
  })
});

meRouter.post(
  "/location",
  validate(locationSchema),
  asyncHandler(async (req, res) => {
    const postman = await resolveSelfPostman(req);
    const { latitude, longitude, batteryPct, isMock } = req.body;

    const entry = await prisma.postmanLocationHistory.create({
      data: { postmanId: postman.id, latitude, longitude, batteryPct, isMock: !!isMock }
    });

    await prisma.$executeRawUnsafe(
      `UPDATE "Postman" SET "currentLocation" = ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, "lastActiveAt" = now() WHERE id = $3`,
      longitude, latitude, postman.id
    );

    res.status(201).json({ id: entry.id, recordedAt: entry.recordedAt });
  })
);

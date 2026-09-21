import { Router } from "express";
import { z } from "zod";
import { DeliveryStatus } from "@prisma/client";
import { prisma } from "../config/prisma";
import { requireAuth, requireRole } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../utils/asyncHandler";
import { resolveSelfPostman } from "../services/postmanSelf.service";
import { getOrPlanRoute, recalculateRoute, toPostmanRoute } from "../services/routePlanner.service";
import { recordAudit } from "../services/audit.service";
import { FinishedStatus, listFinishedDeliveries } from "../services/deliveryHistory.service";

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
    const [beat, latestLocation, postOffice] = await Promise.all([
      postman.assignedBeatId
        ? prisma.beat.findUnique({ where: { id: postman.assignedBeatId } })
        : Promise.resolve(null),
      prisma.postmanLocationHistory.findFirst({
        where: { postmanId: postman.id },
        orderBy: { recordedAt: "desc" }
      }),
      prisma.postOffice.findUnique({ where: { id: postman.postOfficeId }, select: { id: true, name: true, code: true } })
    ]);
    res.json({ postman, beat, postOffice, lastKnownLocation: latestLocation });
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

const historyQuerySchema = z.object({
  query: z.object({
    before: z.string().datetime().optional(),
    since: z.string().datetime().optional(),
    outcome: z.enum(["DELIVERED", "RETURNED"]).optional(),
    page: z.coerce.number().int().min(1).max(10_000).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).optional()
  })
});

/**
 * The postman's PAST work: deliveries finished (delivered / returned) before `before` (default: the start of the
 * server's today) and, optionally, since `since`. Newest first, paged, with a per-outcome summary of the whole window.
 * Always the caller's own deliveries: the postman comes from the token, never from a parameter.
 */
meRouter.get(
  "/deliveries/history",
  validate(historyQuerySchema),
  asyncHandler(async (req, res) => {
    const postman = await resolveSelfPostman(req);
    const q = req.query as Record<string, string | undefined>;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const page = Number(q.page ?? 1);
    const pageSize = Number(q.pageSize ?? 30);
    const result = await listFinishedDeliveries(postman.id, {
      before: q.before ? new Date(q.before) : startOfToday,
      since: q.since ? new Date(q.since) : undefined,
      outcome: q.outcome as FinishedStatus | undefined,
      page,
      pageSize
    });
    res.json({ ...result, page, pageSize });
  })
);

const routeQuerySchema = z.object({
  query: z
    .object({
      // The app's live GPS fix, when it wants the route to begin exactly there.
      startLat: z.coerce.number().min(-90).max(90).optional(),
      startLng: z.coerce.number().min(-180).max(180).optional(),
      refresh: z.enum(["true", "false"]).optional()
      // There is deliberately no algorithm parameter: the server always runs its one pipeline
      // (DBSCAN -> NN -> 2-opt -> ALNS). Anything a client sends besides these fields is dropped.
    })
    .refine((q) => (q.startLat === undefined) === (q.startLng === undefined), {
      message: "startLat and startLng must be supplied together"
    })
});

/**
 * The postman's current optimized route (the server's one pipeline over a road travel-time
 * matrix, with road geometry when a routing engine is configured), without the optimizer's
 * diagnostics - see toPostmanRoute(). Served from the stored result while the set of active
 * deliveries is unchanged; otherwise refreshed first — see
 * services/routePlanner.service.ts for the freshness rules.
 */
meRouter.get(
  "/route",
  validate(routeQuerySchema),
  asyncHandler(async (req, res) => {
    const postman = await resolveSelfPostman(req);
    const { startLat, startLng, refresh } = req.query as Record<string, string | undefined>;

    const route = await getOrPlanRoute(postman, {
      refresh: refresh === "true",
      start:
        startLat !== undefined && startLng !== undefined
          ? { latitude: Number(startLat), longitude: Number(startLng) }
          : undefined,
      trigger: "MANUAL"
    });

    res.json(route ? toPostmanRoute(route) : { route: null });
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
    ]),
    start: z
      .object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) })
      .optional()
  })
});

// Forces a full re-optimization of the remaining deliveries. (A route no longer
// needs an assigned beat: the optimizer only needs delivery coordinates.)
meRouter.post(
  "/route/reoptimize",
  validate(reoptimizeSchema),
  asyncHandler(async (req, res) => {
    const postman = await resolveSelfPostman(req);

    const route = await recalculateRoute(postman, {
      trigger: req.body.trigger,
      start: req.body.start
    });
    if (!route) {
      return res.json({ route: null, message: "No remaining deliveries to route" });
    }

    await recordAudit({
      req,
      action: "ROUTE_REOPTIMIZED",
      entityType: "OptimizationRequest",
      entityId: route.routeId,
      reason: req.body.trigger
    });

    res.status(201).json(toPostmanRoute(route));
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

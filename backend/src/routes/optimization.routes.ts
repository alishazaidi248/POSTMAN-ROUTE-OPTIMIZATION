import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { requireAuth, requireRole, assertCanWriteToPostOffice, assertOwnsResource } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../utils/asyncHandler";
import { getOptimizationService } from "../services/optimization";
import { recordAudit } from "../services/audit.service";

export const optimizationRouter = Router();
optimizationRouter.use(requireAuth);

const requestSchema = z.object({
  body: z.object({
    postOfficeId: z.string().uuid(),
    beatId: z.string().uuid(),
    postmanId: z.string().uuid(),
    deliveryIds: z.array(z.string().uuid()).min(1),
    requestType: z.enum(["ROUTE_PLAN", "REOPTIMIZE"]).default("ROUTE_PLAN")
  })
});

optimizationRouter.post(
  "/requests",
  requireRole("ADMIN", "SUPER_ADMIN"),
  validate(requestSchema),
  asyncHandler(async (req, res) => {
    assertCanWriteToPostOffice(req, req.body.postOfficeId);
    const request = await prisma.optimizationRequest.create({
      data: {
        postOfficeId: req.body.postOfficeId,
        requestType: req.body.requestType,
        parameters: { beatId: req.body.beatId, postmanId: req.body.postmanId, deliveryIds: req.body.deliveryIds },
        status: "RUNNING"
      }
    });

    const service = getOptimizationService();
    const solution =
      req.body.requestType === "REOPTIMIZE"
        ? await service.reoptimize(req.body, "MANUAL_TRIGGER")
        : await service.planRoute(req.body);

    const result = await prisma.optimizationResult.create({
      data: { optimizationRequestId: request.id, resultData: solution as any, source: "MOCK" }
    });

    await prisma.optimizationRequest.update({ where: { id: request.id }, data: { status: "COMPLETED" } });
    await recordAudit({
      req,
      action: req.body.requestType === "REOPTIMIZE" ? "ROUTE_REOPTIMIZED" : "ROUTE_GENERATED",
      entityType: "OptimizationRequest",
      entityId: request.id
    });

    res.status(201).json({ request, result });
  })
);

optimizationRouter.get(
  "/requests/:id",
  asyncHandler(async (req, res) => {
    const request = await prisma.optimizationRequest.findUniqueOrThrow({
      where: { id: req.params.id },
      include: { results: true }
    });
    assertOwnsResource(req, request.postOfficeId);
    res.json(request);
  })
);

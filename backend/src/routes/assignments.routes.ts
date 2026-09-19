import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { requireAuth, requireRole, resolvePostOfficeScope, assertOwnsResource } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../utils/asyncHandler";
import { overrideAssignment } from "../services/assignment.service";

export const assignmentsRouter = Router();
assignmentsRouter.use(requireAuth);

assignmentsRouter.get(
  "/exceptions",
  asyncHandler(async (req, res) => {
    const postOfficeId = resolvePostOfficeScope(req);
    const exceptions = await prisma.assignmentException.findMany({
      where: {
        resolvedAt: null,
        delivery: postOfficeId ? { postOfficeId } : undefined
      },
      include: { delivery: { include: { recipient: true, address: true } } },
      orderBy: { createdAt: "desc" }
    });
    res.json(exceptions);
  })
);

assignmentsRouter.post(
  "/exceptions/:id/ignore",
  requireRole("ADMIN", "SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const exception = await prisma.assignmentException.findUniqueOrThrow({
      where: { id: req.params.id },
      include: { delivery: true }
    });
    assertOwnsResource(req, exception.delivery.postOfficeId);
    const updated = await prisma.assignmentException.update({
      where: { id: req.params.id },
      data: { resolvedAt: new Date(), lastAction: "IGNORED" }
    });
    res.json(updated);
  })
);

assignmentsRouter.post(
  "/exceptions/:id/resolve",
  requireRole("ADMIN", "SUPER_ADMIN"),
  validate(
    z.object({
      body: z.object({
        beatId: z.string().uuid().optional(),
        postmanId: z.string().uuid().optional(),
        reason: z.string().min(3)
      })
    })
  ),
  asyncHandler(async (req, res) => {
    const exception = await prisma.assignmentException.findUniqueOrThrow({
      where: { id: req.params.id },
      include: { delivery: true }
    });
    assertOwnsResource(req, exception.delivery.postOfficeId);
    if (req.body.beatId) {
      const beat = await prisma.beat.findUniqueOrThrow({ where: { id: req.body.beatId } });
      assertOwnsResource(req, beat.postOfficeId);
    }
    if (req.body.postmanId) {
      const postman = await prisma.postman.findUniqueOrThrow({ where: { id: req.body.postmanId } });
      assertOwnsResource(req, postman.postOfficeId);
    }

    await overrideAssignment({
      deliveryId: exception.deliveryId,
      beatId: req.body.beatId,
      postmanId: req.body.postmanId,
      reason: req.body.reason,
      userId: req.user!.sub
    });

    const updated = await prisma.assignmentException.update({
      where: { id: req.params.id },
      data: { resolvedAt: new Date(), lastAction: "MANUALLY_ASSIGNED" }
    });

    res.json(updated);
  })
);

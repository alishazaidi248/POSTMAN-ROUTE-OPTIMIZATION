import { Router } from "express";
import { z } from "zod";
import { Prisma, DeliveryStatus, ParcelPriority } from "@prisma/client";
import { prisma } from "../config/prisma";
import { requireAuth, requireRole, resolvePostOfficeScope, assertOwnsResource } from "../middleware/auth";
import { assertPostmanOwnsDelivery } from "../services/postmanSelf.service";
import { AppError } from "../utils/AppError";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../utils/asyncHandler";
import { transitionDeliveryStatus } from "../services/deliveryStatus.service";
import { overrideAssignment } from "../services/assignment.service";
import { recordAudit } from "../services/audit.service";

export const deliveriesRouter = Router();
deliveriesRouter.use(requireAuth);

deliveriesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const postOfficeId = resolvePostOfficeScope(req);
    const {
      q, status, priority, beatId, postmanId, dateFrom, dateTo,
      page = "1", pageSize = "25"
    } = req.query as Record<string, string>;

    const where: Prisma.DeliveryWhereInput = {
      ...(postOfficeId ? { postOfficeId } : {}),
      ...(status ? { status: status as DeliveryStatus } : {}),
      ...(priority ? { priority: priority as ParcelPriority } : {}),
      ...(beatId ? { beatId } : {}),
      ...(postmanId ? { assignedPostmanId: postmanId } : {}),
      ...(dateFrom || dateTo
        ? { createdAt: { gte: dateFrom ? new Date(dateFrom) : undefined, lte: dateTo ? new Date(dateTo) : undefined } }
        : {}),
      ...(q
        ? {
            OR: [
              { trackingId: { contains: q, mode: "insensitive" } },
              { recipient: { name: { contains: q, mode: "insensitive" } } },
              { recipient: { phone: { contains: q } } },
              { address: { pincode: { contains: q } } },
              { address: { addressLine1: { contains: q, mode: "insensitive" } } }
            ]
          }
        : {})
    };

    const take = Math.min(100, Number(pageSize) || 25);
    const skip = (Math.max(1, Number(page) || 1) - 1) * take;

    const [total, rows] = await Promise.all([
      prisma.delivery.count({ where }),
      prisma.delivery.findMany({
        where,
        include: { recipient: true, address: true, beat: { select: { beatNumber: true } }, assignedPostman: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take,
        skip
      })
    ]);

    res.json({ total, page: Number(page), pageSize: take, rows });
  })
);

deliveriesRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const delivery = await prisma.delivery.findUniqueOrThrow({
      where: { id: req.params.id },
      include: {
        recipient: true,
        address: true,
        beat: true,
        assignedPostman: true,
        statusHistory: { orderBy: { createdAt: "desc" } },
        assignmentHistory: { orderBy: { createdAt: "desc" } },
        exceptions: true
      }
    });
    assertOwnsResource(req, delivery.postOfficeId);
    await assertPostmanOwnsDelivery(req, delivery.assignedPostmanId);
    res.json(delivery);
  })
);

deliveriesRouter.post(
  "/:id/status",
  requireRole("ADMIN", "SUPER_ADMIN", "POSTMAN"),
  validate(z.object({ body: z.object({ status: z.nativeEnum(DeliveryStatus), reason: z.string().optional() }) })),
  asyncHandler(async (req, res) => {
    const existing = await prisma.delivery.findUniqueOrThrow({ where: { id: req.params.id } });
    assertOwnsResource(req, existing.postOfficeId);
    await assertPostmanOwnsDelivery(req, existing.assignedPostmanId);
    const updated = await transitionDeliveryStatus({
      deliveryId: req.params.id,
      toStatus: req.body.status,
      reason: req.body.reason,
      changedBy: req.user!.sub
    });
    await recordAudit({
      req,
      action: "DELIVERY_STATUS_CHANGED",
      entityType: "Delivery",
      entityId: updated.id,
      newValue: { status: updated.status },
      reason: req.body.reason
    });
    res.json(updated);
  })
);

deliveriesRouter.post(
  "/:id/reassign",
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
    const existing = await prisma.delivery.findUniqueOrThrow({ where: { id: req.params.id } });
    assertOwnsResource(req, existing.postOfficeId);
    if (req.body.beatId) {
      const beat = await prisma.beat.findUniqueOrThrow({ where: { id: req.body.beatId } });
      assertOwnsResource(req, beat.postOfficeId);
    }
    if (req.body.postmanId) {
      const postman = await prisma.postman.findUniqueOrThrow({ where: { id: req.body.postmanId } });
      assertOwnsResource(req, postman.postOfficeId);
    }
    const updated = await overrideAssignment({
      deliveryId: req.params.id,
      beatId: req.body.beatId,
      postmanId: req.body.postmanId,
      reason: req.body.reason,
      userId: req.user!.sub
    });
    res.json(updated);
  })
);

deliveriesRouter.post(
  "/bulk",
  requireRole("ADMIN", "SUPER_ADMIN"),
  validate(
    z.object({
      body: z.object({
        deliveryIds: z.array(z.string().uuid()).min(1),
        action: z.enum(["ASSIGN_BEAT", "ASSIGN_POSTMAN", "SET_PRIORITY"]),
        beatId: z.string().uuid().optional(),
        postmanId: z.string().uuid().optional(),
        priority: z.nativeEnum(ParcelPriority).optional(),
        reason: z.string().min(3)
      })
    })
  ),
  asyncHandler(async (req, res) => {
    const { deliveryIds, action, beatId, postmanId, priority, reason } = req.body;

    const postOfficeId = resolvePostOfficeScope(req);
    const ownedCount = await prisma.delivery.count({
      where: { id: { in: deliveryIds }, ...(postOfficeId ? { postOfficeId } : {}) }
    });
    if (ownedCount !== deliveryIds.length) {
      throw AppError.forbidden("One or more deliveries do not belong to your post office");
    }
    if (beatId) {
      const beat = await prisma.beat.findUniqueOrThrow({ where: { id: beatId } });
      assertOwnsResource(req, beat.postOfficeId);
    }
    if (postmanId) {
      const postman = await prisma.postman.findUniqueOrThrow({ where: { id: postmanId } });
      assertOwnsResource(req, postman.postOfficeId);
    }

    if (action === "SET_PRIORITY") {
      await prisma.delivery.updateMany({ where: { id: { in: deliveryIds } }, data: { priority } });
    } else {
      for (const deliveryId of deliveryIds) {
        await overrideAssignment({ deliveryId, beatId, postmanId, reason, userId: req.user!.sub });
      }
    }

    await recordAudit({
      req,
      action: "ASSIGNMENT_OVERRIDDEN",
      entityType: "Delivery",
      newValue: { deliveryIds, action, beatId, postmanId, priority },
      reason
    });

    res.json({ updated: deliveryIds.length });
  })
);

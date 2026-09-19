import { Router } from "express";
import { z } from "zod";
import { PostmanStatus } from "@prisma/client";
import { prisma } from "../config/prisma";
import { requireAuth, requireRole, resolvePostOfficeScope, assertCanWriteToPostOffice, assertOwnsResource } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../utils/asyncHandler";
import { AppError } from "../utils/AppError";
import { recordAudit } from "../services/audit.service";
import { setPostmanBeatAssignment } from "../services/assignment.service";

export const postmenRouter = Router();
postmenRouter.use(requireAuth);

postmenRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const postOfficeId = resolvePostOfficeScope(req);
    const postmen = await prisma.postman.findMany({
      where: postOfficeId ? { postOfficeId } : undefined,
      include: {
        assignedBeat: { select: { beatNumber: true, name: true } },
        postOffice: { select: { id: true, name: true, code: true } }
      },
      orderBy: { name: "asc" }
    });

    // Career delivery counts are always derived, never stored/edited directly (spec §20).
    const withCounts = await Promise.all(
      postmen.map(async (p) => {
        const [assigned, delivered, failed, rescheduled] = await Promise.all([
          prisma.delivery.count({ where: { assignedPostmanId: p.id } }),
          prisma.delivery.count({ where: { assignedPostmanId: p.id, status: "DELIVERED" } }),
          prisma.delivery.count({ where: { assignedPostmanId: p.id, status: "FAILED" } }),
          prisma.delivery.count({ where: { assignedPostmanId: p.id, status: "RESCHEDULED" } })
        ]);
        return {
          id: p.id,
          employeeId: p.employeeId,
          name: p.name,
          phone: p.phone,
          status: p.status,
          beat: p.assignedBeat,
          postOffice: p.postOffice,
          lastActiveAt: p.lastActiveAt,
          totals: { assigned, delivered, failed, rescheduled }
        };
      })
    );

    res.json(withCounts);
  })
);

postmenRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const postman = await prisma.postman.findUniqueOrThrow({
      where: { id: req.params.id },
      include: { assignedBeat: true, vehicleAssignments: true }
    });
    assertOwnsResource(req, postman.postOfficeId);

    const [assigned, delivered, failed, rescheduled] = await Promise.all([
      prisma.delivery.count({ where: { assignedPostmanId: postman.id } }),
      prisma.delivery.count({ where: { assignedPostmanId: postman.id, status: "DELIVERED" } }),
      prisma.delivery.count({ where: { assignedPostmanId: postman.id, status: "FAILED" } }),
      prisma.delivery.count({ where: { assignedPostmanId: postman.id, status: "RESCHEDULED" } })
    ]);

    const lastLocation = await prisma.postmanLocationHistory.findFirst({
      where: { postmanId: postman.id },
      orderBy: { recordedAt: "desc" }
    });

    res.json({
      ...postman,
      currentLocation: lastLocation
        ? { latitude: lastLocation.latitude, longitude: lastLocation.longitude, isMock: lastLocation.isMock, recordedAt: lastLocation.recordedAt }
        : null,
      performance: {
        totalAssigned: assigned,
        totalDelivered: delivered,
        totalFailed: failed,
        totalRescheduled: rescheduled,
        successRate: assigned > 0 ? Number(((delivered / assigned) * 100).toFixed(1)) : 0
      }
    });
  })
);

const postmanSchema = z.object({
  body: z.object({
    employeeId: z.string().min(1),
    postOfficeId: z.string().uuid(),
    name: z.string().min(1),
    phone: z.string().min(10),
    email: z.string().email().optional(),
    address: z.string().optional(),
    emergencyContact: z.string().optional(),
    joiningDate: z.string().datetime().optional()
  })
});

postmenRouter.post(
  "/",
  requireRole("ADMIN", "SUPER_ADMIN"),
  validate(postmanSchema),
  asyncHandler(async (req, res) => {
    assertCanWriteToPostOffice(req, req.body.postOfficeId);
    const created = await prisma.postman.create({
      data: { ...req.body, joiningDate: req.body.joiningDate ? new Date(req.body.joiningDate) : undefined }
    });
    await recordAudit({ req, action: "POSTMAN_CREATED", entityType: "Postman", entityId: created.id, newValue: created });
    res.status(201).json(created);
  })
);

const postmanUpdateSchema = z.object({
  body: z.object({
    name: z.string().min(1).optional(),
    phone: z.string().min(10).optional(),
    email: z.string().email().optional().or(z.literal("")),
    address: z.string().optional(),
    emergencyContact: z.string().optional(),
    joiningDate: z.string().datetime().optional(),
    status: z.nativeEnum(PostmanStatus).optional()
  })
});

postmenRouter.put(
  "/:id",
  requireRole("ADMIN", "SUPER_ADMIN"),
  validate(postmanUpdateSchema),
  asyncHandler(async (req, res) => {
    const before = await prisma.postman.findUniqueOrThrow({ where: { id: req.params.id } });
    assertOwnsResource(req, before.postOfficeId);
    const { joiningDate, ...rest } = req.body;
    const updated = await prisma.postman.update({
      where: { id: req.params.id },
      data: { ...rest, joiningDate: joiningDate ? new Date(joiningDate) : undefined }
    });
    await recordAudit({ req, action: "POSTMAN_UPDATED", entityType: "Postman", entityId: updated.id, oldValue: before, newValue: updated });
    res.json(updated);
  })
);

postmenRouter.post(
  "/:id/deactivate",
  requireRole("ADMIN", "SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const existing = await prisma.postman.findUniqueOrThrow({ where: { id: req.params.id } });
    assertOwnsResource(req, existing.postOfficeId);
    const updated = await prisma.postman.update({ where: { id: req.params.id }, data: { status: "INACTIVE" } });
    await recordAudit({ req, action: "POSTMAN_DEACTIVATED", entityType: "Postman", entityId: updated.id });
    res.json(updated);
  })
);

postmenRouter.post(
  "/:id/activate",
  requireRole("ADMIN", "SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const existing = await prisma.postman.findUniqueOrThrow({ where: { id: req.params.id } });
    assertOwnsResource(req, existing.postOfficeId);
    const updated = await prisma.postman.update({ where: { id: req.params.id }, data: { status: "ACTIVE" } });
    await recordAudit({ req, action: "POSTMAN_UPDATED", entityType: "Postman", entityId: updated.id, newValue: { status: "ACTIVE" } });
    res.json(updated);
  })
);

/**
 * Postman-centric beat assignment (the mirror of POST /beats/:id/assign-postman)
 * so the Postmen UI can assign/change/clear a beat without going through the
 * map. Goes through the same setPostmanBeatAssignment so both views agree.
 */
postmenRouter.post(
  "/:id/assign-beat",
  requireRole("ADMIN", "SUPER_ADMIN"),
  validate(z.object({ body: z.object({ beatId: z.string().uuid().nullable() }) })),
  asyncHandler(async (req, res) => {
    const existing = await prisma.postman.findUniqueOrThrow({ where: { id: req.params.id } });
    assertOwnsResource(req, existing.postOfficeId);
    const updated = await setPostmanBeatAssignment(req.params.id, req.body.beatId);
    await recordAudit({
      req,
      action: "POSTMAN_UPDATED",
      entityType: "Postman",
      entityId: req.params.id,
      newValue: { assignedBeatId: req.body.beatId }
    });
    res.json(updated);
  })
);

/**
 * Hard delete is only permitted when the postman has no delivery/location
 * history — deleting a postman with real operational history would sever
 * DeliveryAttempt/AssignmentHistory/LocationHistory records that must stay
 * auditable (spec §18 lists Create/Read/Update/Deactivate; this endpoint
 * adds a true delete for the case the admin explicitly wants one, while
 * still refusing to silently destroy history). Use /deactivate instead once
 * a postman has done real work.
 */
postmenRouter.delete(
  "/:id",
  requireRole("ADMIN", "SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const postman = await prisma.postman.findUniqueOrThrow({ where: { id: req.params.id } });
    assertOwnsResource(req, postman.postOfficeId);

    const [deliveryCount, attemptCount, historyCount, locationCount] = await Promise.all([
      prisma.delivery.count({ where: { assignedPostmanId: postman.id } }),
      prisma.deliveryAttempt.count({ where: { postmanId: postman.id } }),
      prisma.deliveryAssignmentHistory.count({ where: { postmanId: postman.id } }),
      prisma.postmanLocationHistory.count({ where: { postmanId: postman.id } })
    ]);

    if (deliveryCount + attemptCount + historyCount + locationCount > 0) {
      throw AppError.conflict(
        "This postman has delivery or location history and cannot be permanently deleted. Deactivate instead to preserve records."
      );
    }

    await prisma.vehicle.updateMany({ where: { assignedPostmanId: postman.id }, data: { assignedPostmanId: null } });
    await prisma.postman.delete({ where: { id: postman.id } });

    await recordAudit({ req, action: "POSTMAN_DELETED", entityType: "Postman", entityId: postman.id, oldValue: postman });
    res.status(204).send();
  })
);

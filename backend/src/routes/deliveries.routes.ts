import { NextFunction, Request, RequestHandler, Response, Router } from "express";
import { z } from "zod";
import { Prisma, DeliveryStatus, ParcelPriority } from "@prisma/client";
import { prisma } from "../config/prisma";
import { requireAuth, requireRole, adminOnly, resolvePostOfficeScope, assertOwnsResource, assertCanWriteToPostOffice } from "../middleware/auth";
import { assertPostmanOwnsDelivery } from "../services/postmanSelf.service";
import { AppError } from "../utils/AppError";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../utils/asyncHandler";
import { transitionDeliveryStatus } from "../services/deliveryStatus.service";
import { overrideAssignment } from "../services/assignment.service";
import { createAndAssignDelivery } from "../services/delivery.service";
import { recordAudit } from "../services/audit.service";
import { learnFromDelivery } from "../services/addressLearning.service";
import multer from "multer";
import fs from "fs";
import { env } from "../config/env";
import { saveDeliveryProof } from "../services/deliveryProof.service";
import { proofPhotoPath } from "../services/storage/proofStorage";
import { logger } from "../config/logger";

export const deliveriesRouter = Router();
deliveriesRouter.use(requireAuth);

// A postman never lists deliveries here: they use GET /me/deliveries, where the
// server filters by THEIR postman id. This is the back-office search.
deliveriesRouter.get(
  "/",
  adminOnly,
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

const createDeliverySchema = z.object({
  body: z
    .object({
      // Omit for an ADMIN: their own post office is used.
      postOfficeId: z.string().uuid().optional(),
      trackingId: z.string().trim().min(1).max(60).optional(),
      recipientName: z.string().trim().min(1),
      phone: z.string().optional(),
      altPhone: z.string().optional(),
      addressLine1: z.string().trim().min(1),
      addressLine2: z.string().optional(),
      area: z.string().optional(),
      city: z.string().trim().min(1),
      state: z.string().trim().min(1),
      pincode: z.string().regex(/^\d{6}$/, "Pincode must be 6 digits"),
      parcelType: z.string().optional(),
      parcelCount: z.number().int().min(1).max(1000).optional(),
      weightKg: z.number().positive().max(1000).optional(),
      priority: z.nativeEnum(ParcelPriority).optional(),
      urgency: z.string().optional(),
      serviceTimeMinutes: z.number().int().min(0).max(600).optional(),
      // Known coordinates skip geocoding (stored as a MANUAL geocode).
      latitude: z.number().min(-90).max(90).optional(),
      longitude: z.number().min(-180).max(180).optional()
    })
    .refine((b) => (b.latitude === undefined) === (b.longitude === undefined), {
      message: "latitude and longitude must be given together",
      path: ["latitude"]
    })
});

/**
 * Creates ONE delivery in PostgreSQL: geocode (or use the coordinates given),
 * persist Recipient + Address + Delivery, then PostGIS beat match and the beat's
 * postman. The response is the stored record read back from the database.
 */
deliveriesRouter.post(
  "/",
  adminOnly,
  validate(createDeliverySchema),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const postOfficeId = b.postOfficeId ?? req.user!.postOfficeId;
    if (!postOfficeId) throw AppError.badRequest("postOfficeId is required for a Super Admin");
    assertCanWriteToPostOffice(req, postOfficeId);

    const trackingId = b.trackingId ?? `AUTO-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    if (await prisma.delivery.findUnique({ where: { trackingId }, select: { id: true } })) {
      throw AppError.conflict(`A delivery with tracking id ${trackingId} already exists`);
    }

    const { deliveryId, assignment } = await createAndAssignDelivery(
      {
        postOfficeId,
        trackingId,
        recipient: { name: b.recipientName, phone: b.phone, altPhone: b.altPhone },
        address: { addressLine1: b.addressLine1, addressLine2: b.addressLine2, area: b.area, city: b.city, state: b.state, pincode: b.pincode },
        parcelType: b.parcelType,
        parcelCount: b.parcelCount,
        weightKg: b.weightKg,
        priority: b.priority,
        urgency: b.urgency,
        serviceTimeMinutes: b.serviceTimeMinutes
      },
      b.latitude !== undefined && b.longitude !== undefined ? { latitude: b.latitude, longitude: b.longitude } : undefined
    );

    const delivery = await prisma.delivery.findUniqueOrThrow({
      where: { id: deliveryId },
      include: { recipient: true, address: true, beat: { select: { beatNumber: true } }, assignedPostman: { select: { id: true, name: true } } }
    });
    await recordAudit({ req, action: "DELIVERY_IMPORTED", entityType: "Delivery", entityId: deliveryId, newValue: { trackingId, assignment: assignment.status } });
    res.status(201).json({ ...delivery, assignment: assignment.status });
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
        exceptions: true,
        // metadata only: the storage key never leaves the server, the photo is read through GET /:id/proof
        proof: { select: { id: true, type: true, capturedAt: true, contentType: true, sizeBytes: true, latitude: true, longitude: true } }
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
  validate(
    z.object({
      body: z.object({
        status: z.nativeEnum(DeliveryStatus),
        reason: z.string().optional(),
        // The postman's GPS fix at the door; only used to learn where the address is (see addressing/locationLearning.ts).
        location: z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), accuracyMeters: z.number().positive().optional() }).optional()
      })
    })
  ),
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
    if (updated.status === "DELIVERED" && req.body.location) {
      // Learning is a by-product: it never fails or delays the delivery itself.
      await learnFromDelivery(updated.id, req.body.location).catch((err) => logger.warn({ err, deliveryId: updated.id }, "address learning failed"));
    }
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

    // All-or-nothing: refuse the whole batch up front rather than half-applying it.
    if (action !== "SET_PRIORITY") {
      const finished = await prisma.delivery.count({
        where: { id: { in: deliveryIds }, status: { in: ["DELIVERED", "RETURNED", "CANCELLED"] } }
      });
      if (finished > 0) throw AppError.conflict(`${finished} of the selected deliveries are finished and cannot be reassigned`);
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

// ── proof of delivery ──────────────────────────────────────────────────────

const proofUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: env.maxProofPhotoMb * 1024 * 1024, files: 1 } });
const receiveProof: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  proofUpload.single("photo")(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return next(AppError.badRequest(`This photo is too large. Please use one under ${env.maxProofPhotoMb} MB.`));
    }
    return next(AppError.badRequest("The photo could not be uploaded. Please try again."));
  });
};

/** The postman the delivery belongs to (or an administrator of its post office) adds the photo while it is out for delivery. */
deliveriesRouter.post(
  "/:id/proof",
  requireRole("ADMIN", "SUPER_ADMIN", "POSTMAN"),
  receiveProof,
  asyncHandler(async (req, res) => {
    const existing = await prisma.delivery.findUniqueOrThrow({ where: { id: req.params.id } });
    assertOwnsResource(req, existing.postOfficeId);
    await assertPostmanOwnsDelivery(req, existing.assignedPostmanId);
    const num = (v: unknown) => (typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);
    const capturedAt = typeof req.body?.capturedAt === "string" && !Number.isNaN(Date.parse(req.body.capturedAt)) ? new Date(req.body.capturedAt) : undefined;
    const proof = await saveDeliveryProof({
      deliveryId: existing.id,
      buffer: req.file?.buffer,
      userId: req.user!.sub,
      latitude: num(req.body?.latitude),
      longitude: num(req.body?.longitude),
      capturedAt: capturedAt && capturedAt.getTime() <= Date.now() + 60_000 ? capturedAt : undefined
    });
    res.status(201).json(proof);
  })
);

/** The photo itself: only for the office's administrators and the delivery's own postman, never cached or shared. */
deliveriesRouter.get(
  "/:id/proof",
  asyncHandler(async (req, res) => {
    const delivery = await prisma.delivery.findUniqueOrThrow({ where: { id: req.params.id }, include: { proof: true } });
    assertOwnsResource(req, delivery.postOfficeId);
    await assertPostmanOwnsDelivery(req, delivery.assignedPostmanId);
    if (!delivery.proof) throw AppError.notFound("This delivery has no proof photo");
    const file = proofPhotoPath(delivery.proof.storageKey);
    if (!fs.existsSync(file)) throw AppError.notFound("This delivery has no proof photo");
    res.setHeader("Content-Type", delivery.proof.contentType);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    fs.createReadStream(file).pipe(res);
  })
);

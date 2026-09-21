import { NextFunction, Request, RequestHandler, Response, Router } from "express";
import multer from "multer";
import { z } from "zod";
import { PostmanStatus } from "@prisma/client";
import { prisma } from "../config/prisma";
import { requireAuth, adminOnly, resolvePostOfficeScope, assertCanWriteToPostOffice, assertOwnsResource } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../utils/asyncHandler";
import { AppError } from "../utils/AppError";
import { recordAudit } from "../services/audit.service";
import { hashPassword } from "../services/auth.service";
import { setPostmanBeatAssignment } from "../services/assignment.service";
import { applyPostmanStatus } from "../services/postman.service";
import { getOrPlanRoute, recalculateRoute } from "../services/routePlanner.service";
import { getImageStorage, validateImage } from "../services/storage/imageStorage";
import { ROUTABLE_STATUSES } from "../services/optimization/RoadRouteOptimizationService";
import { env } from "../config/env";
import { notifyPostman } from "../services/postmanNotifications.service";

export const postmenRouter = Router();
postmenRouter.use(requireAuth, adminOnly);

type CountRow = { assignedPostmanId: string | null; _count: number };

/** Today's work per postman: what is still to do, what was delivered today, and who is out on a round. */
async function todaysWork(postmanIds: string[]) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const [remaining, completed, outNow] = await Promise.all([
    prisma.delivery.groupBy({ by: ["assignedPostmanId"], where: { assignedPostmanId: { in: postmanIds }, status: { in: ROUTABLE_STATUSES } }, _count: true }),
    prisma.delivery.groupBy({ by: ["assignedPostmanId"], where: { assignedPostmanId: { in: postmanIds }, status: "DELIVERED", updatedAt: { gte: startOfDay } }, _count: true }),
    prisma.delivery.groupBy({ by: ["assignedPostmanId"], where: { assignedPostmanId: { in: postmanIds }, status: "OUT_FOR_DELIVERY" }, _count: true })
  ]);
  const by = (rows: CountRow[]) => new Map(rows.map((r) => [r.assignedPostmanId, r._count]));
  const [rem, done, out] = [by(remaining), by(completed), by(outNow)];
  return (postmanId: string) => {
    const r = rem.get(postmanId) ?? 0;
    const c = done.get(postmanId) ?? 0;
    return { total: r + c, completed: c, remaining: r, onDelivery: (out.get(postmanId) ?? 0) > 0 };
  };
}

postmenRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const postOfficeId = resolvePostOfficeScope(req);
    const postmen = await prisma.postman.findMany({
      where: postOfficeId ? { postOfficeId } : undefined,
      include: {
        assignedBeat: { select: { beatNumber: true, name: true } },
        postOffice: { select: { id: true, name: true, code: true } },
        user: { select: { id: true, email: true, status: true } }
      },
      orderBy: { name: "asc" }
    });

    const work = await todaysWork(postmen.map((p) => p.id));

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
          account: p.user,
          lastActiveAt: p.lastActiveAt,
          photoUrl: p.profilePhotoUrl,
          today: { total: work(p.id).total, completed: work(p.id).completed, remaining: work(p.id).remaining },
          onDelivery: work(p.id).onDelivery,
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
      include: {
        assignedBeat: true,
        postOffice: { select: { name: true } },
        vehicleAssignments: true,
        user: { select: { id: true, email: true, status: true, lastLoginAt: true } }
      }
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

    const { user, postOffice, ...rest } = postman;
    const today = (await todaysWork([postman.id]))(postman.id);
    res.json({
      ...rest,
      postOfficeName: postOffice.name,
      photoUrl: postman.profilePhotoUrl,
      today: { total: today.total, completed: today.completed, remaining: today.remaining },
      onDelivery: today.onDelivery,
      account: user,
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

// ── profile picture ────────────────────────────────────────────────────────

const photoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: env.maxProfilePhotoMb * 1024 * 1024, files: 1 } });

/** multer's own errors become plain messages instead of a server error. */
const receivePhoto: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  photoUpload.single("photo")(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return next(AppError.badRequest(`This photo is too large. Please choose one under ${env.maxProfilePhotoMb} MB.`));
    }
    return next(AppError.badRequest("The photo could not be uploaded. Please try again."));
  });
};

// Admin-only (the whole router is): the postman sees the picture in their app, but cannot change it.
postmenRouter.put(
  "/:id/photo",
  receivePhoto,
  asyncHandler(async (req, res) => {
    const postman = await prisma.postman.findUniqueOrThrow({ where: { id: req.params.id } });
    assertOwnsResource(req, postman.postOfficeId);

    const image = validateImage(req.file?.buffer); // real type from the bytes, size limit, plain-language errors
    const storage = getImageStorage();
    const url = await storage.save(image);
    try {
      await prisma.postman.update({ where: { id: postman.id }, data: { profilePhotoUrl: url } });
    } catch (err) {
      await storage.remove(url); // the database did not take it: do not leave an orphan file behind
      throw err;
    }
    await storage.remove(postman.profilePhotoUrl);
    await recordAudit({ req, action: "POSTMAN_UPDATED", entityType: "Postman", entityId: postman.id, reason: "Profile photo changed" });
    res.json({ photoUrl: url });
  })
);

postmenRouter.delete(
  "/:id/photo",
  asyncHandler(async (req, res) => {
    const postman = await prisma.postman.findUniqueOrThrow({ where: { id: req.params.id } });
    assertOwnsResource(req, postman.postOfficeId);
    if (postman.profilePhotoUrl) {
      await prisma.postman.update({ where: { id: postman.id }, data: { profilePhotoUrl: null } });
      await getImageStorage().remove(postman.profilePhotoUrl);
      await recordAudit({ req, action: "POSTMAN_UPDATED", entityType: "Postman", entityId: postman.id, reason: "Profile photo removed" });
    }
    res.json({ photoUrl: null });
  })
);

// The admin sees exactly the route the postman's app shows: same planner, same stored
// result - there is no separate admin optimizer.
postmenRouter.get(
  "/:id/route",
  asyncHandler(async (req, res) => {
    const postman = await prisma.postman.findUniqueOrThrow({ where: { id: req.params.id } });
    assertOwnsResource(req, postman.postOfficeId);
    const route = await getOrPlanRoute(postman, { trigger: "ADMIN_VIEW" });
    res.json(route ?? { route: null });
  })
);

postmenRouter.post(
  "/:id/route/recalculate",
  asyncHandler(async (req, res) => {
    const postman = await prisma.postman.findUniqueOrThrow({ where: { id: req.params.id } });
    assertCanWriteToPostOffice(req, postman.postOfficeId);
    const route = await recalculateRoute(postman, { trigger: "ADMIN_RECALCULATE" });
    if (!route) return res.json({ route: null, message: "No remaining deliveries to route" });
    await recordAudit({
      req,
      action: "ROUTE_REOPTIMIZED",
      entityType: "OptimizationRequest",
      entityId: route.routeId,
      reason: "ADMIN_RECALCULATE"
    });
    res.status(201).json(route);
  })
);

const postmanSchema = z.object({
  body: z.object({
    employeeId: z.string().trim().min(1),
    // Omit for an ADMIN: their own post office is used.
    postOfficeId: z.string().uuid().optional(),
    name: z.string().trim().min(1),
    phone: z.string().min(10),
    email: z.string().email().optional(),
    address: z.string().optional(),
    emergencyContact: z.string().optional(),
    joiningDate: z.string().datetime().optional()
  })
});

postmenRouter.post(
  "/",
  validate(postmanSchema),
  asyncHandler(async (req, res) => {
    const postOfficeId = req.body.postOfficeId ?? req.user!.postOfficeId;
    if (!postOfficeId) throw AppError.badRequest("postOfficeId is required for a Super Admin");
    assertCanWriteToPostOffice(req, postOfficeId);

    const created = await prisma.postman.create({
      data: { ...req.body, postOfficeId, joiningDate: req.body.joiningDate ? new Date(req.body.joiningDate) : undefined }
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
  validate(postmanUpdateSchema),
  asyncHandler(async (req, res) => {
    const before = await prisma.postman.findUniqueOrThrow({ where: { id: req.params.id } });
    assertOwnsResource(req, before.postOfficeId);
    const { joiningDate, status, ...rest } = req.body;
    await prisma.postman.update({
      where: { id: req.params.id },
      data: { ...rest, joiningDate: joiningDate ? new Date(joiningDate) : undefined }
    });
    // A status change carries consequences (login, parcels), so it goes through one place.
    const updated = status && status !== before.status
      ? await applyPostmanStatus(req.params.id, status, req.user!.sub)
      : await prisma.postman.findUniqueOrThrow({ where: { id: req.params.id } });
    await recordAudit({ req, action: "POSTMAN_UPDATED", entityType: "Postman", entityId: updated.id, oldValue: before, newValue: updated });
    res.json(updated);
  })
);

postmenRouter.post(
  "/:id/deactivate",
  asyncHandler(async (req, res) => {
    const existing = await prisma.postman.findUniqueOrThrow({ where: { id: req.params.id } });
    assertOwnsResource(req, existing.postOfficeId);
    const updated = await applyPostmanStatus(req.params.id, "INACTIVE", req.user!.sub);
    await recordAudit({ req, action: "POSTMAN_DEACTIVATED", entityType: "Postman", entityId: updated.id });
    res.json(updated);
  })
);

postmenRouter.post(
  "/:id/activate",
  asyncHandler(async (req, res) => {
    const existing = await prisma.postman.findUniqueOrThrow({ where: { id: req.params.id } });
    assertOwnsResource(req, existing.postOfficeId);
    const updated = await applyPostmanStatus(req.params.id, "ACTIVE", req.user!.sub);
    await recordAudit({ req, action: "POSTMAN_UPDATED", entityType: "Postman", entityId: updated.id, newValue: { status: "ACTIVE" } });
    res.json(updated);
  })
);

/**
 * Postman-centric beat assignment (the mirror of POST /beats/:id/assign-postman)
 * so the Postmen UI can assign/change/clear a beat without going through the
 * map. Goes through the same transactional writer so both views agree, and the
 * beat's parcels follow the change.
 */
postmenRouter.post(
  "/:id/assign-beat",
  validate(z.object({ body: z.object({ beatId: z.string().uuid().nullable() }) })),
  asyncHandler(async (req, res) => {
    const existing = await prisma.postman.findUniqueOrThrow({ where: { id: req.params.id } });
    assertOwnsResource(req, existing.postOfficeId);
    if (req.body.beatId) {
      const beat = await prisma.beat.findUniqueOrThrow({ where: { id: req.body.beatId } });
      assertOwnsResource(req, beat.postOfficeId);
    }
    const updated = await setPostmanBeatAssignment(req.params.id, req.body.beatId, req.user!.sub);
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

// ── the postman's login ────────────────────────────────────────────────────

const accountSchema = z.object({
  body: z.object({
    email: z.string().trim().toLowerCase().email(),
    password: z.string().min(8, "Password must be at least 8 characters")
  })
});

/**
 * Creates the POSTMAN login the mobile app signs in with. It is linked through
 * User.postmanId, and the app later resolves "who am I" from that link on the
 * server — never from anything the device sends.
 */
postmenRouter.post(
  "/:id/account",
  validate(accountSchema),
  asyncHandler(async (req, res) => {
    const postman = await prisma.postman.findUniqueOrThrow({ where: { id: req.params.id }, include: { user: { select: { id: true } } } });
    assertOwnsResource(req, postman.postOfficeId);
    if (postman.user) throw AppError.conflict("This postman already has a login account");
    if (await prisma.user.findUnique({ where: { email: req.body.email } })) {
      throw AppError.conflict("A user with this email already exists");
    }

    const user = await prisma.user.create({
      data: {
        name: postman.name,
        email: req.body.email,
        passwordHash: await hashPassword(req.body.password),
        mustChangePassword: true, // set by the administrator: the postman chooses their own at first sign-in
        role: "POSTMAN",
        status: postman.status === "ACTIVE" ? "ACTIVE" : "INACTIVE",
        postOfficeId: postman.postOfficeId,
        postmanId: postman.id
      },
      select: { id: true, email: true, status: true, role: true, postOfficeId: true, postmanId: true }
    });
    await recordAudit({ req, action: "USER_CREATED", entityType: "User", entityId: user.id, newValue: { email: user.email, role: "POSTMAN", postmanId: postman.id } });
    res.status(201).json(user);
  })
);

postmenRouter.post(
  "/:id/account/password",
  validate(z.object({ body: z.object({ password: z.string().min(8, "Password must be at least 8 characters") }) })),
  asyncHandler(async (req, res) => {
    const postman = await prisma.postman.findUniqueOrThrow({ where: { id: req.params.id }, include: { user: true } });
    assertOwnsResource(req, postman.postOfficeId);
    if (!postman.user) throw AppError.notFound("This postman has no login account");

    await prisma.$transaction([
      prisma.user.update({ where: { id: postman.user.id }, data: { passwordHash: await hashPassword(req.body.password), mustChangePassword: true, passwordChangedAt: null } }),
      // Every signed-in device must sign in again with the new password.
      prisma.refreshToken.updateMany({ where: { userId: postman.user.id, revokedAt: null }, data: { revokedAt: new Date() } })
    ]);
    await recordAudit({ req, action: "USER_UPDATED", entityType: "User", entityId: postman.user.id, reason: "PASSWORD_RESET" });
    res.status(204).send();
  })
);

/**
 * Hard delete is only permitted when the postman has no delivery/location
 * history and no login — deleting a postman with real operational history would
 * sever DeliveryAttempt/AssignmentHistory/LocationHistory records that must stay
 * auditable. Use /deactivate instead once a postman has done real work.
 */
postmenRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const postman = await prisma.postman.findUniqueOrThrow({ where: { id: req.params.id } });
    assertOwnsResource(req, postman.postOfficeId);

    const [deliveryCount, attemptCount, historyCount, locationCount, accountCount] = await Promise.all([
      prisma.delivery.count({ where: { assignedPostmanId: postman.id } }),
      prisma.deliveryAttempt.count({ where: { postmanId: postman.id } }),
      prisma.deliveryAssignmentHistory.count({ where: { postmanId: postman.id } }),
      prisma.postmanLocationHistory.count({ where: { postmanId: postman.id } }),
      prisma.user.count({ where: { postmanId: postman.id } })
    ]);

    if (deliveryCount + attemptCount + historyCount + locationCount + accountCount > 0) {
      throw AppError.conflict(
        "This postman has a login account, or delivery or location history, and cannot be permanently deleted. Deactivate instead to preserve records."
      );
    }

    await prisma.$transaction([
      prisma.postmanBeatAssignment.deleteMany({ where: { postmanId: postman.id } }),
      prisma.vehicle.updateMany({ where: { assignedPostmanId: postman.id }, data: { assignedPostmanId: null } }),
      prisma.postman.delete({ where: { id: postman.id } })
    ]);

    await getImageStorage().remove(postman.profilePhotoUrl); // the picture goes with the person
    await recordAudit({ req, action: "POSTMAN_DELETED", entityType: "Postman", entityId: postman.id, oldValue: postman });
    res.status(204).send();
  })
);

// ── message to a postman ───────────────────────────────────────────────────

/** An administrator writes to one postman: it is stored in their Notifications and pushed to their phone. */
postmenRouter.post(
  "/:id/message",
  validate(z.object({ body: z.object({ message: z.string().trim().min(1).max(500), title: z.string().trim().min(1).max(80).optional(), urgent: z.boolean().optional() }) })),
  asyncHandler(async (req, res) => {
    const postman = await prisma.postman.findUniqueOrThrow({ where: { id: req.params.id } });
    assertOwnsResource(req, postman.postOfficeId);
    const delivered = await notifyPostman(postman.id, {
      type: "ADMIN_MESSAGE",
      title: req.body.title ?? "Message from your post office",
      message: req.body.message,
      severity: req.body.urgent ? "CRITICAL" : "INFO"
    });
    if (!delivered) throw AppError.conflict("This postman has no login, so there is no app to send the message to.");
    res.status(201).json({ sent: true });
  })
);

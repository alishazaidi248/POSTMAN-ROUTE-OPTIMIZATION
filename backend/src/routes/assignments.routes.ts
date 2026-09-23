import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { requireAuth, requireRole, resolvePostOfficeScope, assertOwnsResource, adminOnly } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../utils/asyncHandler";
import { overrideAssignment } from "../services/assignment.service";
import { retryGeocodeAllExceptions } from "../services/geocoding";
import { DEFAULT_THRESHOLDS } from "../services/addressing/beatMatcher";
import { QUALITY_LABEL } from "../services/addressing/assignmentDecision";

export const assignmentsRouter = Router();
assignmentsRouter.use(requireAuth, adminOnly);

assignmentsRouter.get(
  "/exceptions",
  asyncHandler(async (req, res) => {
    const postOfficeId = resolvePostOfficeScope(req);
    const exceptions = await prisma.assignmentException.findMany({
      where: {
        resolvedAt: null,
        delivery: postOfficeId ? { postOfficeId } : undefined
      },
      include: {
        delivery: { include: { recipient: true, address: true } },
        suggestedBeat: { select: { id: true, beatNumber: true, name: true } }
      },
      orderBy: { createdAt: "desc" }
    });
    // The words the administrator reads are decided here, once, from the same thresholds the matcher used.
    const levelOf = (c: number) => (c >= DEFAULT_THRESHOLDS.high ? "High" : c >= DEFAULT_THRESHOLDS.medium ? "Medium" : "Low");
    // A high score shared by two beats is not a high confidence in either: the address is ambiguous, and it is labelled so.
    const isAmbiguous = (e: { evidence: unknown }) => (e.evidence as { nameLevel?: string } | null)?.nameLevel === "AMBIGUOUS";
    res.json(
      exceptions.map((e) => ({
        ...e,
        confidenceLevel: e.confidence == null ? null : isAmbiguous(e) ? "Ambiguous" : levelOf(e.confidence),
        locationQualityLabel: e.locationQuality ? QUALITY_LABEL[e.locationQuality] : null
      }))
    );
  })
);

/** Retries geocoding for every open exception a location fix could plausibly resolve, bounded and scoped exactly
 * like the exception list above (GET /exceptions) - an office-scoped admin only retries their own office's work. */
assignmentsRouter.post(
  "/exceptions/retry-geocode-all",
  requireRole("ADMIN", "SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const postOfficeId = resolvePostOfficeScope(req);
    const summary = await retryGeocodeAllExceptions(postOfficeId);
    res.json(summary);
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

    const delivery = await overrideAssignment({
      deliveryId: exception.deliveryId,
      beatId: req.body.beatId,
      postmanId: req.body.postmanId,
      reason: req.body.reason,
      userId: req.user!.sub
    });

    // Still waiting for a postman: the (refreshed) "no postman" exception stays open, otherwise this one is done.
    const stillOpen = exception.reason === "NO_POSTMAN_ASSIGNED" && !delivery.assignedPostmanId;
    const updated = stillOpen
      ? exception
      : await prisma.assignmentException.update({ where: { id: req.params.id }, data: { resolvedAt: new Date(), lastAction: "MANUALLY_ASSIGNED" } });

    res.json(updated);
  })
);

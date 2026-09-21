import { Router } from "express";
import { z } from "zod";
import { UserRole } from "@prisma/client";
import { prisma } from "../config/prisma";
import { requireAuth, requireRole } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../utils/asyncHandler";
import { AppError } from "../utils/AppError";
import { hashPassword } from "../services/auth.service";
import { recordAudit } from "../services/audit.service";

/**
 * Account management is SUPER_ADMIN-only (spec §44): only a super admin
 * spans multiple post offices, so only a super admin should be minting the
 * ADMIN accounts scoped to each one.
 */
export const usersRouter = Router();
usersRouter.use(requireAuth, requireRole("SUPER_ADMIN"));

usersRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const users = await prisma.user.findMany({
      include: { postOffice: { select: { id: true, name: true, code: true } } },
      orderBy: { createdAt: "desc" }
    });
    res.json(users.map(({ passwordHash: _drop, ...rest }) => rest));
  })
);

const createUserSchema = z.object({
  body: z
    .object({
      name: z.string().min(1),
      email: z.string().email(),
      password: z.string().min(8, "Password must be at least 8 characters"),
      role: z.nativeEnum(UserRole),
      postOfficeId: z.string().uuid().optional(),
      // Required for a POSTMAN login: the postman record the account belongs to.
      postmanId: z.string().uuid().optional()
    })
    .refine((data) => data.role !== "POSTMAN" || !!data.postmanId, {
      message: "postmanId is required for a POSTMAN account",
      path: ["postmanId"]
    })
    .refine((data) => data.role === "SUPER_ADMIN" || !!data.postOfficeId, {
      message: "postOfficeId is required for ADMIN and POSTMAN accounts",
      path: ["postOfficeId"]
    })
});

usersRouter.post(
  "/",
  validate(createUserSchema),
  asyncHandler(async (req, res) => {
    const existing = await prisma.user.findUnique({ where: { email: req.body.email } });
    if (existing) throw AppError.conflict("A user with this email already exists");

    if (req.body.role === "POSTMAN") {
      const postman = await prisma.postman.findUnique({ where: { id: req.body.postmanId }, include: { user: { select: { id: true } } } });
      if (!postman || postman.postOfficeId !== req.body.postOfficeId) {
        throw AppError.badRequest("That postman does not exist in the given post office");
      }
      if (postman.user) throw AppError.conflict("This postman already has a login account");
    }

    const passwordHash = await hashPassword(req.body.password);
    const created = await prisma.user.create({
      data: {
        name: req.body.name,
        email: req.body.email,
        passwordHash,
        mustChangePassword: true, // the administrator chose this one: the person chooses their own at first sign-in
        role: req.body.role,
        postOfficeId: req.body.role === "SUPER_ADMIN" ? null : req.body.postOfficeId,
        postmanId: req.body.role === "POSTMAN" ? req.body.postmanId : undefined
      },
      include: { postOffice: { select: { id: true, name: true, code: true } } }
    });

    await recordAudit({
      req,
      action: "USER_CREATED",
      entityType: "User",
      entityId: created.id,
      newValue: { email: created.email, role: created.role, postOfficeId: created.postOfficeId }
    });

    const { passwordHash: _drop, ...safeUser } = created;
    res.status(201).json(safeUser);
  })
);

usersRouter.post(
  "/:id/deactivate",
  asyncHandler(async (req, res) => {
    const updated = await prisma.user.update({ where: { id: req.params.id }, data: { status: "INACTIVE" } });
    await recordAudit({ req, action: "USER_UPDATED", entityType: "User", entityId: updated.id, newValue: { status: "INACTIVE" } });
    const { passwordHash: _drop, ...safeUser } = updated;
    res.json(safeUser);
  })
);

usersRouter.post(
  "/:id/activate",
  asyncHandler(async (req, res) => {
    const updated = await prisma.user.update({ where: { id: req.params.id }, data: { status: "ACTIVE" } });
    await recordAudit({ req, action: "USER_UPDATED", entityType: "User", entityId: updated.id, newValue: { status: "ACTIVE" } });
    const { passwordHash: _drop, ...safeUser } = updated;
    res.json(safeUser);
  })
);

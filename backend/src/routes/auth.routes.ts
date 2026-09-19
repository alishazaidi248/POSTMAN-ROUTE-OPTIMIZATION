import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../utils/asyncHandler";
import { AppError } from "../utils/AppError";
import {
  hashPassword,
  verifyPassword,
  signAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken
} from "../services/auth.service";
import { recordAudit } from "../services/audit.service";
import { requireAuth } from "../middleware/auth";

export const authRouter = Router();

const loginSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(8)
  })
});

authRouter.post(
  "/login",
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || user.status !== "ACTIVE" || !(await verifyPassword(user.passwordHash, password))) {
      throw AppError.unauthorized("Invalid email or password");
    }

    const accessToken = signAccessToken({
      sub: user.id,
      role: user.role,
      postOfficeId: user.postOfficeId,
      email: user.email
    });
    const refreshToken = await issueRefreshToken(user.id);

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await recordAudit({ req, userId: user.id, action: "LOGIN", entityType: "User", entityId: user.id });

    res.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        postOfficeId: user.postOfficeId,
        postmanId: user.postmanId
      }
    });
  })
);

authRouter.post(
  "/refresh",
  validate(z.object({ body: z.object({ refreshToken: z.string() }) })),
  asyncHandler(async (req, res) => {
    const { user, refreshToken } = await rotateRefreshToken(req.body.refreshToken);
    const accessToken = signAccessToken({
      sub: user.id,
      role: user.role,
      postOfficeId: user.postOfficeId,
      email: user.email
    });
    res.json({ accessToken, refreshToken });
  })
);

authRouter.post(
  "/logout",
  requireAuth,
  validate(z.object({ body: z.object({ refreshToken: z.string() }) })),
  asyncHandler(async (req, res) => {
    await revokeRefreshToken(req.body.refreshToken);
    await recordAudit({ req, action: "LOGOUT", entityType: "User", entityId: req.user!.sub });
    res.status(204).send();
  })
);

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.user!.sub },
      select: { id: true, name: true, email: true, role: true, postOfficeId: true, status: true, postmanId: true }
    });
    res.json(user);
  })
);

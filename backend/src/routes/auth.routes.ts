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
  revokeRefreshToken,
  revokeAllRefreshTokens,
  checkPasswordPolicy,
  tokenClaims
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

    // A POSTMAN login is only useful (and only allowed) when it is linked to a
    // Postman record: that link is how the server later decides whose deliveries to return.
    if (user.role === "POSTMAN" && !user.postmanId) {
      throw AppError.forbidden("This account is not linked to a Postman profile. Contact your post office admin.");
    }

    const accessToken = signAccessToken(tokenClaims(user));
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
        postmanId: user.postmanId,
        mustChangePassword: user.mustChangePassword
      },
      mustChangePassword: user.mustChangePassword
    });
  })
);

/**
 * The signed-in user chooses a new password. Required after an account was created or reset by someone else (the first
 * password is temporary), and available to everyone. It checks the current password, applies the password rules, ends every
 * other session, and answers with fresh tokens that are no longer restricted.
 */
authRouter.post(
  "/change-password",
  requireAuth,
  validate(z.object({ body: z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(1).max(200) }) })),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.sub } });
    if (user.status !== "ACTIVE" || !(await verifyPassword(user.passwordHash, req.body.currentPassword))) {
      throw AppError.unauthorized("The current password is not correct.");
    }
    const problems = checkPasswordPolicy(req.body.newPassword, { email: user.email, current: req.body.currentPassword });
    if (problems.length > 0) throw AppError.badRequest(`The new password is not acceptable. ${problems.join(" ")}`, { problems });

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(req.body.newPassword), mustChangePassword: false, passwordChangedAt: new Date() }
    });
    await revokeAllRefreshTokens(user.id);
    await recordAudit({ req, action: "PASSWORD_CHANGED", entityType: "User", entityId: user.id });
    res.json({
      accessToken: signAccessToken(tokenClaims(updated)),
      refreshToken: await issueRefreshToken(user.id),
      mustChangePassword: false
    });
  })
);

authRouter.post(
  "/refresh",
  validate(z.object({ body: z.object({ refreshToken: z.string() }) })),
  asyncHandler(async (req, res) => {
    const { user, refreshToken } = await rotateRefreshToken(req.body.refreshToken);
    const accessToken = signAccessToken(tokenClaims(user));
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
      select: { id: true, name: true, email: true, role: true, postOfficeId: true, status: true, postmanId: true, mustChangePassword: true, postOffice: { select: { name: true } } }
    });
    const { postOffice, ...rest } = user;
    res.json({ ...rest, postOfficeName: postOffice?.name ?? null });
  })
);

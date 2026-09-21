import argon2 from "argon2";
import jwt, { SignOptions } from "jsonwebtoken";
import { randomBytes, createHash } from "crypto";
import { UserRole } from "@prisma/client";
import { prisma } from "../config/prisma";
import { env } from "../config/env";
import { AppError } from "../utils/AppError";

export interface AccessTokenPayload {
  sub: string;
  role: UserRole;
  postOfficeId: string | null;
  email: string;
  /** Set while the account must choose a new password: the token then opens only the change-password endpoint. */
  mcp?: true;
}

/** The claims of a user's access token, including whether they must first choose a new password. */
export function tokenClaims(user: { id: string; role: UserRole; postOfficeId: string | null; email: string; mustChangePassword: boolean }): AccessTokenPayload {
  return { sub: user.id, role: user.role, postOfficeId: user.postOfficeId, email: user.email, ...(user.mustChangePassword ? { mcp: true as const } : {}) };
}

const WELL_KNOWN = new Set(["password", "password1", "password123", "changeme", "changeme123", "changeme123!", "welcome123", "qwerty123", "admin123", "letmein123", "12345678", "123456789", "1234567890"]);

/**
 * What a password must satisfy. Returns the problems in plain words (empty = fine). Length matters more than tricks, so
 * the rules are short: 10 characters or more, a letter and a digit, not the account's own name, not a well-known password,
 * and not the password it replaces.
 */
export function checkPasswordPolicy(password: string, ctx: { email: string; current?: string }): string[] {
  const problems: string[] = [];
  if (password.length < 10) problems.push("Use at least 10 characters.");
  if (password.length > 128) problems.push("Use at most 128 characters.");
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) problems.push("Include at least one letter and one number.");
  const local = ctx.email.split("@")[0].toLowerCase();
  if (local.length >= 3 && password.toLowerCase().includes(local)) problems.push("Do not use your email name in the password.");
  if (WELL_KNOWN.has(password.toLowerCase())) problems.push("That password is too common. Choose another.");
  if (ctx.current !== undefined && password === ctx.current) problems.push("Choose a password different from the current one.");
  return problems;
}

/** Ends every session of the user (all refresh tokens), e.g. after the password changed. */
export async function revokeAllRefreshTokens(userId: string) {
  await prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password);
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.jwtAccessSecret, {
    expiresIn: env.jwtAccessExpiresIn
  } as SignOptions);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function issueRefreshToken(userId: string): Promise<string> {
  const token = randomBytes(48).toString("hex");
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  await prisma.refreshToken.create({
    data: { userId, tokenHash: hashToken(token), expiresAt }
  });

  return token;
}

export async function rotateRefreshToken(oldToken: string) {
  const tokenHash = hashToken(oldToken);
  const record = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: { include: { postOffice: true } } }
  });

  if (!record || record.revokedAt || record.expiresAt < new Date()) {
    throw AppError.unauthorized("Invalid or expired refresh token");
  }

  await prisma.refreshToken.update({
    where: { id: record.id },
    data: { revokedAt: new Date() }
  });

  const newToken = await issueRefreshToken(record.userId);
  return { user: record.user, refreshToken: newToken };
}

export async function revokeRefreshToken(token: string) {
  const tokenHash = hashToken(token);
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() }
  });
}

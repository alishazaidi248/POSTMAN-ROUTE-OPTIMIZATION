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

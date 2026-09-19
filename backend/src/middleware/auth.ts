import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { UserRole } from "@prisma/client";
import { env } from "../config/env";
import { AppError } from "../utils/AppError";
import { AccessTokenPayload } from "../services/auth.service";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AccessTokenPayload;
    }
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return next(AppError.unauthorized("Missing bearer token"));
  }

  const token = header.slice("Bearer ".length);

  try {
    const payload = jwt.verify(token, env.jwtAccessSecret) as AccessTokenPayload;
    req.user = payload;
    next();
  } catch {
    next(AppError.unauthorized("Invalid or expired access token"));
  }
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(AppError.unauthorized());
    if (!roles.includes(req.user.role)) {
      return next(AppError.forbidden("Insufficient role for this operation"));
    }
    next();
  };
}

/**
 * Every scoped resource lookup must filter by this postOfficeId (except
 * SUPER_ADMIN, who may pass ?postOfficeId= explicitly). This is the single
 * choke point enforcing section 44 (multi-post-office data isolation) —
 * never trust a postOfficeId supplied by an ADMIN's request body/query.
 */
export function resolvePostOfficeScope(req: Request): string | undefined {
  if (!req.user) throw AppError.unauthorized();
  if (req.user.role === "SUPER_ADMIN") {
    return (req.query.postOfficeId as string) || undefined;
  }
  if (!req.user.postOfficeId) {
    throw AppError.forbidden("User is not attached to a post office");
  }
  return req.user.postOfficeId;
}

/**
 * Guards CREATE endpoints that take a postOfficeId in the request body
 * (postmen, beats, vehicles, optimization requests, ...). An ADMIN must not
 * be able to create a resource in a post office other than their own just
 * by naming a different id in the payload — that's a straightforward
 * cross-tenant write otherwise. SUPER_ADMIN has no home office and may
 * legitimately target any of them.
 */
export function assertCanWriteToPostOffice(req: Request, requestedPostOfficeId: string): void {
  if (!req.user) throw AppError.unauthorized();
  if (req.user.role === "SUPER_ADMIN") return;
  if (req.user.postOfficeId !== requestedPostOfficeId) {
    throw AppError.forbidden("Cannot create resources for another post office");
  }
}

/**
 * Guards single-resource GET/mutation endpoints reached by id
 * (/postmen/:id, /beats/:id, /deliveries/:id, ...). Listing endpoints are
 * already filtered by resolvePostOfficeScope, but a direct id lookup
 * bypasses that filter entirely unless it re-checks the fetched record's
 * own postOfficeId against the caller — otherwise any authenticated admin
 * could read or modify another post office's record just by guessing/
 * knowing its id.
 */
export function assertOwnsResource(req: Request, resourcePostOfficeId: string): void {
  if (!req.user) throw AppError.unauthorized();
  if (req.user.role === "SUPER_ADMIN") return;
  if (req.user.postOfficeId !== resourcePostOfficeId) {
    throw AppError.notFound("Resource not found");
  }
}

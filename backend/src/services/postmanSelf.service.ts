import { Request } from "express";
import { prisma } from "../config/prisma";
import { AppError } from "../utils/AppError";

/**
 * Resolves the Postman record linked to the authenticated login. Identity is
 * always re-derived from the verified access token's `sub` (never from a
 * client-supplied postmanId) so a POSTMAN login can never impersonate another
 * postman by passing a different id.
 */
export async function resolveSelfPostman(req: Request) {
  if (!req.user) throw AppError.unauthorized();
  if (req.user.role !== "POSTMAN") {
    throw AppError.forbidden("Only POSTMAN accounts have a linked Postman profile");
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: req.user.sub },
    select: { postmanId: true, status: true }
  });

  // The access token stays valid for its lifetime; a disabled account must not
  // keep reading data until it expires.
  if (user.status !== "ACTIVE") throw AppError.unauthorized("This account is disabled");

  if (!user.postmanId) {
    throw AppError.forbidden("This account is not linked to a Postman profile");
  }

  const postman = await prisma.postman.findUniqueOrThrow({ where: { id: user.postmanId } });
  return postman;
}

/**
 * Guards single-delivery lookups (GET /deliveries/:id, POST /:id/status)
 * so a POSTMAN login can only reach deliveries assigned to their own
 * Postman record. ADMIN/SUPER_ADMIN are unaffected (already scoped by
 * assertOwnsResource at the post-office level).
 */
export async function assertPostmanOwnsDelivery(req: Request, assignedPostmanId: string | null): Promise<void> {
  if (!req.user || req.user.role !== "POSTMAN") return;
  const self = await resolveSelfPostman(req);
  if (assignedPostmanId !== self.id) {
    throw AppError.notFound("Resource not found");
  }
}

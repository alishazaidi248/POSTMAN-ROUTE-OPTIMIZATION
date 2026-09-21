import { PostmanStatus } from "@prisma/client";
import { prisma } from "../config/prisma";
import { syncBeatDeliveries } from "./assignment.service";

/**
 * Everything that must follow a postman's status, in one transaction:
 *
 *  - the postman's login account is enabled only while the postman is ACTIVE
 *    for INACTIVE it is disabled AND every refresh token is revoked, so the
 *    device can no longer renew its session;
 *  - the parcels of the beat the postman covers are re-synced: a postman who is
 *    not ACTIVE (inactive / on leave) no longer holds parcels, they go back to the
 *    admin's exception queue; reactivating hands them back.
 */
export async function applyPostmanStatus(postmanId: string, status: PostmanStatus, changedBy?: string) {
  return prisma.$transaction(
    async (tx) => {
      const postman = await tx.postman.update({ where: { id: postmanId }, data: { status } });

      const user = await tx.user.findUnique({ where: { postmanId } });
      if (user && status !== "ON_LEAVE") {
        await tx.user.update({ where: { id: user.id }, data: { status: status === "ACTIVE" ? "ACTIVE" : "INACTIVE" } });
        if (status !== "ACTIVE") {
          await tx.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
        }
      }

      const covering = await tx.postmanBeatAssignment.findMany({ where: { postmanId, isActive: true }, select: { beatId: true } });
      for (const { beatId } of covering) await syncBeatDeliveries(tx, beatId, changedBy);

      return postman;
    },
    { timeout: 30_000 }
  );
}

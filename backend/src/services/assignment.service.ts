import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { recordAudit } from "./audit.service";

export interface BeatMatch {
  beatId: string;
  beatNumber: string;
  matchCount: number;
}

/**
 * Single source of truth for "postman X covers beat Y" — used both from the
 * beat-centric UI (Beats page / map territory assignment) and the
 * postman-centric UI (Postman detail page). Keeps at most one active
 * PostmanBeatAssignment per beat and per postman so the two views never
 * disagree about who covers what.
 *
 * Runs as one transaction because it touches multiple postmen: assigning
 * postman A to a beat that postman B currently holds must also clear B's
 * denormalized Postman.assignedBeatId, or B is left pointing at a beat they
 * no longer actively cover (that stale field is what beats.routes reads for
 * display, so leaving it dangling shows the wrong postman as "assigned").
 */
export async function setPostmanBeatAssignment(postmanId: string, beatId: string | null) {
  return prisma.$transaction(async (tx) => {
    await tx.postmanBeatAssignment.updateMany({
      where: { postmanId, isActive: true },
      data: { isActive: false, endDate: new Date() }
    });

    if (beatId) {
      const displaced = await tx.postmanBeatAssignment.findMany({
        where: { beatId, isActive: true, postmanId: { not: postmanId } },
        select: { postmanId: true }
      });

      await tx.postmanBeatAssignment.updateMany({
        where: { beatId, isActive: true },
        data: { isActive: false, endDate: new Date() }
      });

      for (const { postmanId: displacedPostmanId } of displaced) {
        await tx.postman.update({ where: { id: displacedPostmanId }, data: { assignedBeatId: null } });
      }

      await tx.postmanBeatAssignment.create({ data: { beatId, postmanId } });
    }

    return tx.postman.update({ where: { id: postmanId }, data: { assignedBeatId: beatId } });
  });
}

/**
 * Point-in-polygon beat lookup via PostGIS ST_Contains — never a
 * nearest-center-distance approximation (spec §24).
 */
export async function findContainingBeats(postOfficeId: string, latitude: number, longitude: number): Promise<BeatMatch[]> {
  const rows = await prisma.$queryRaw<BeatMatch[]>(Prisma.sql`
    SELECT id AS "beatId", beat_number AS "beatNumber", 1 AS "matchCount"
    FROM "Beat"
    WHERE "postOfficeId" = ${postOfficeId}
      AND status = 'ACTIVE'
      AND boundary IS NOT NULL
      AND ST_Contains(boundary, ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326))
  `);
  return rows;
}

export async function assignDeliveryToBeat(deliveryId: string, latitude: number, longitude: number) {
  const delivery = await prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId } });

  // Geocoding just succeeded (that's the only way this function gets
  // called), so any earlier GEOCODING_FAILED exception for this delivery is
  // stale — close it out here so it doesn't sit open forever alongside
  // whatever new exception (or none) this attempt produces.
  await prisma.assignmentException.updateMany({
    where: { deliveryId, reason: "GEOCODING_FAILED", resolvedAt: null },
    data: { resolvedAt: new Date(), lastAction: "GEOCODING_RETRIED" }
  });

  const matches = await findContainingBeats(delivery.postOfficeId, latitude, longitude);

  if (matches.length === 0) {
    await prisma.$transaction([
      prisma.delivery.update({ where: { id: deliveryId }, data: { status: "SORTED" } }),
      prisma.assignmentException.create({ data: { deliveryId, reason: "NO_BEAT_MATCH" } })
    ]);
    return { status: "NO_BEAT_MATCH" as const };
  }

  if (matches.length > 1) {
    await prisma.$transaction([
      prisma.delivery.update({ where: { id: deliveryId }, data: { status: "SORTED" } }),
      prisma.assignmentException.create({
        data: { deliveryId, reason: "MULTIPLE_BEAT_MATCH", details: JSON.stringify(matches) }
      })
    ]);
    return { status: "MULTIPLE_BEAT_MATCH" as const, matches };
  }

  const beat = await prisma.beat.findUnique({
    where: { id: matches[0].beatId },
    include: { postmanAssignments: { where: { isActive: true }, include: { postman: true } } }
  });

  if (!beat) {
    await prisma.assignmentException.create({ data: { deliveryId, reason: "NO_BEAT_MATCH" } });
    return { status: "NO_BEAT_MATCH" as const };
  }

  const activePostman = beat.postmanAssignments.find((a) => a.postman.status === "ACTIVE")?.postman;

  await prisma.delivery.update({
    where: { id: deliveryId },
    data: {
      beatId: beat.id,
      assignedPostmanId: activePostman?.id ?? null,
      status: activePostman ? "ASSIGNED" : "SORTED"
    }
  });

  await prisma.deliveryAssignmentHistory.create({
    data: { deliveryId, beatId: beat.id, postmanId: activePostman?.id, reason: "AUTO_BEAT_MATCH" }
  });

  if (!activePostman) {
    await prisma.assignmentException.create({
      data: { deliveryId, reason: "NO_POSTMAN_ASSIGNED" }
    });
    return { status: "NO_POSTMAN_ASSIGNED" as const, beatId: beat.id };
  }

  return { status: "ASSIGNED" as const, beatId: beat.id, postmanId: activePostman.id };
}

export async function overrideAssignment(params: {
  deliveryId: string;
  beatId?: string;
  postmanId?: string;
  reason: string;
  userId: string;
}) {
  const delivery = await prisma.delivery.update({
    where: { id: params.deliveryId },
    data: {
      beatId: params.beatId,
      assignedPostmanId: params.postmanId,
      status: params.postmanId ? "ASSIGNED" : undefined
    }
  });

  await prisma.deliveryAssignmentHistory.create({
    data: {
      deliveryId: params.deliveryId,
      beatId: params.beatId,
      postmanId: params.postmanId,
      reason: params.reason,
      changedBy: params.userId,
      isOverride: true
    }
  });

  await recordAudit({
    userId: params.userId,
    action: "ASSIGNMENT_OVERRIDDEN",
    entityType: "Delivery",
    entityId: params.deliveryId,
    newValue: { beatId: params.beatId, postmanId: params.postmanId },
    reason: params.reason
  });

  return delivery;
}

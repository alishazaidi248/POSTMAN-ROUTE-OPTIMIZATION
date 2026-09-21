import { DeliveryStatus, ExceptionReason, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../config/prisma";
import { AppError } from "../utils/AppError";
import { recordAudit } from "./audit.service";

/**
 * Assignment is the one place that decides "which postman serves this
 * delivery". PostgreSQL is the source of truth, and these three relations must
 * always agree (this file is what keeps them in step):
 *
 *   PostmanBeatAssignment (isActive)  -- who covers a beat
 *   Postman.assignedBeatId            -- denormalised copy of the above
 *   Delivery.beatId / assignedPostmanId -- who a parcel is with
 *
 * Every write that changes one of them runs in a single transaction together
 * with the others, so a crash or a failed request can never leave a beat with
 * one postman and its parcels with another.
 */

type Db = Prisma.TransactionClient | PrismaClient;

/** Deliveries the system may (re)assign on its own. Anything else — OUT_FOR_DELIVERY,
 * DELIVERED, failed attempts, RETURNED, CANCELLED — is left with whoever has it. */
export const AUTO_ASSIGNABLE_STATUSES: DeliveryStatus[] = ["SORTED", "ASSIGNED", "RESCHEDULED"];
const TERMINAL_STATUSES: DeliveryStatus[] = ["DELIVERED", "RETURNED", "CANCELLED"];
const ALL_ASSIGNMENT_REASONS: ExceptionReason[] = [
  "GEOCODING_FAILED",
  "NO_BEAT_MATCH",
  "MULTIPLE_BEAT_MATCH",
  "NO_POSTMAN_ASSIGNED",
  "INACTIVE_POSTMAN"
];

export interface BeatMatch {
  beatId: string;
  beatNumber: string;
  matchCount: number;
}

// ── exceptions ─────────────────────────────────────────────────────────────

/** Opens an exception unless the same one is already open (re-running an
 * assignment must not pile up duplicate work items for the admin). */
async function openException(db: Db, deliveryId: string, reason: ExceptionReason, details?: string) {
  const existing = await db.assignmentException.findFirst({ where: { deliveryId, reason, resolvedAt: null } });
  if (existing) return existing;
  return db.assignmentException.create({ data: { deliveryId, reason, details } });
}

/** Closes open exceptions the system has just fixed itself. */
async function resolveExceptions(db: Db, deliveryId: string, reasons: ExceptionReason[]) {
  await db.assignmentException.updateMany({
    where: { deliveryId, reason: { in: reasons }, resolvedAt: null },
    data: {
      resolvedAt: new Date(),
      lastAction: reasons.includes("GEOCODING_FAILED") ? "GEOCODING_RETRIED" : "BEAT_CHANGED"
    }
  });
}

// ── postman <-> beat ───────────────────────────────────────────────────────

async function activePostmanOfBeat(db: Db, beatId: string) {
  const row = await db.postmanBeatAssignment.findFirst({
    where: { beatId, isActive: true, postman: { status: "ACTIVE" } },
    select: { postmanId: true }
  });
  return row?.postmanId ?? null;
}

/**
 * Makes every open delivery of `beatId` match the beat's CURRENT active postman:
 *   - a postman covers the beat  -> their parcels move to that postman (SORTED -> ASSIGNED)
 *   - nobody covers it           -> the parcels are released (ASSIGNED -> SORTED) and a
 *                                   NO_POSTMAN_ASSIGNED exception is opened for the admin
 * Parcels an admin assigned by hand (an override in the history) and parcels already
 * out for delivery are never touched.
 */
export async function syncBeatDeliveries(db: Db, beatId: string, changedBy?: string) {
  const postmanId = await activePostmanOfBeat(db, beatId);

  const deliveries = await db.delivery.findMany({
    where: {
      beatId,
      status: { in: AUTO_ASSIGNABLE_STATUSES },
      assignmentHistory: { none: { isOverride: true } }
    },
    select: { id: true, status: true, assignedPostmanId: true }
  });

  let assigned = 0;
  let released = 0;

  for (const d of deliveries) {
    if (postmanId) {
      if (d.assignedPostmanId === postmanId && d.status !== "SORTED") continue;
      await db.delivery.update({
        where: { id: d.id },
        data: { assignedPostmanId: postmanId, status: d.status === "SORTED" ? "ASSIGNED" : d.status }
      });
      await db.deliveryAssignmentHistory.create({
        data: { deliveryId: d.id, beatId, postmanId, reason: "BEAT_POSTMAN_CHANGED", changedBy }
      });
      await resolveExceptions(db, d.id, ["NO_POSTMAN_ASSIGNED", "INACTIVE_POSTMAN"]);
      assigned++;
    } else {
      if (d.assignedPostmanId === null && d.status === "SORTED") continue;
      await db.delivery.update({
        where: { id: d.id },
        data: { assignedPostmanId: null, status: d.status === "ASSIGNED" ? "SORTED" : d.status }
      });
      await db.deliveryAssignmentHistory.create({
        data: { deliveryId: d.id, beatId, postmanId: null, reason: "BEAT_LEFT_WITHOUT_POSTMAN", changedBy }
      });
      await openException(db, d.id, "NO_POSTMAN_ASSIGNED", "The beat has no active postman");
      released++;
    }
  }

  return { assigned, released, postmanId };
}

/**
 * The single writer for "postman X covers beat Y" (beatId = null clears it).
 * Keeps at most one active assignment per beat and per postman, keeps the
 * denormalised Postman.assignedBeatId right for everyone it touches, and then
 * re-syncs the parcels of every beat that changed hands. Runs inside the
 * caller's transaction so it can be combined with other writes (creating a beat
 * and giving it a postman is ONE atomic step).
 */
export async function assignPostmanToBeatTx(tx: Prisma.TransactionClient, postmanId: string, beatId: string | null, changedBy?: string) {
  const postman = await tx.postman.findUniqueOrThrow({ where: { id: postmanId } });

  if (beatId) {
    const beat = await tx.beat.findUniqueOrThrow({ where: { id: beatId } });
    if (beat.postOfficeId !== postman.postOfficeId) {
      throw AppError.badRequest("The postman and the beat belong to different post offices");
    }
    if (beat.status !== "ACTIVE") throw AppError.conflict("Cannot assign a postman to an inactive beat");
  }

  const affectedBeats = new Set<string>();

  // The postman leaves whatever beat they currently cover.
  const leaving = await tx.postmanBeatAssignment.findMany({ where: { postmanId, isActive: true } });
  leaving.forEach((a) => affectedBeats.add(a.beatId));
  await tx.postmanBeatAssignment.updateMany({
    where: { postmanId, isActive: true },
    data: { isActive: false, endDate: new Date() }
  });

  if (beatId) {
    // Whoever held the beat before is displaced.
    const displaced = await tx.postmanBeatAssignment.findMany({
      where: { beatId, isActive: true, postmanId: { not: postmanId } },
      select: { postmanId: true }
    });
    await tx.postmanBeatAssignment.updateMany({
      where: { beatId, isActive: true },
      data: { isActive: false, endDate: new Date() }
    });
    for (const { postmanId: displacedId } of displaced) {
      await tx.postman.update({ where: { id: displacedId }, data: { assignedBeatId: null } });
    }
    await tx.postmanBeatAssignment.create({ data: { beatId, postmanId } });
    affectedBeats.add(beatId);
  }

  const updated = await tx.postman.update({ where: { id: postmanId }, data: { assignedBeatId: beatId } });

  for (const id of affectedBeats) await syncBeatDeliveries(tx, id, changedBy);

  return updated;
}

export function setPostmanBeatAssignment(postmanId: string, beatId: string | null, changedBy?: string) {
  return prisma.$transaction((tx) => assignPostmanToBeatTx(tx, postmanId, beatId, changedBy), { timeout: 30_000 });
}

/** Clears (postmanId null) or sets the postman of a beat — the beat-centric mirror of the above. */
export async function setBeatPostman(beatId: string, postmanId: string | null, changedBy?: string) {
  if (postmanId) return setPostmanBeatAssignment(postmanId, beatId, changedBy);

  return prisma.$transaction(
    async (tx) => {
      const beat = await tx.beat.findUniqueOrThrow({ where: { id: beatId } });
      const current = await tx.postmanBeatAssignment.findMany({ where: { beatId, isActive: true } });
      await tx.postmanBeatAssignment.updateMany({
        where: { beatId, isActive: true },
        data: { isActive: false, endDate: new Date() }
      });
      for (const a of current) await tx.postman.update({ where: { id: a.postmanId }, data: { assignedBeatId: null } });
      await syncBeatDeliveries(tx, beat.id, changedBy);
      return beat;
    },
    { timeout: 30_000 }
  );
}

// ── delivery -> beat -> postman ────────────────────────────────────────────

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
      AND "verificationStatus" = 'VERIFIED'
      AND ST_Contains(boundary, ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326))
  `);
  return rows;
}

export type AssignResult =
  | { status: "ASSIGNED"; beatId: string; postmanId: string }
  | { status: "NO_POSTMAN_ASSIGNED"; beatId: string }
  | { status: "NO_BEAT_MATCH" }
  | { status: "MULTIPLE_BEAT_MATCH"; matches: BeatMatch[] }
  | { status: "SKIPPED"; reason: "NOT_ASSIGNABLE_STATUS" | "MANUAL_OVERRIDE" };

/**
 * delivery address -> lat/lng -> ST_Contains -> beat -> the beat's active postman,
 * written atomically together with the assignment history and exception updates.
 */
export async function assignDeliveryToBeat(deliveryId: string, latitude: number, longitude: number): Promise<AssignResult> {
  const delivery = await prisma.delivery.findUniqueOrThrow({
    where: { id: deliveryId },
    include: { assignmentHistory: { where: { isOverride: true }, take: 1, select: { id: true } } }
  });

  // A parcel that is out for delivery / finished must never be pulled back by a
  // re-geocode, and a hand-made assignment is not overwritten by an automatic one.
  if (delivery.status !== "RECEIVED" && !AUTO_ASSIGNABLE_STATUSES.includes(delivery.status)) {
    return { status: "SKIPPED", reason: "NOT_ASSIGNABLE_STATUS" };
  }
  if (delivery.assignmentHistory.length > 0) return { status: "SKIPPED", reason: "MANUAL_OVERRIDE" };

  const matches = await findContainingBeats(delivery.postOfficeId, latitude, longitude);

  return prisma.$transaction(async (tx) => {
    // Geocoding just succeeded (that's the only way this runs), so an earlier
    // GEOCODING_FAILED exception is stale.
    await resolveExceptions(tx, deliveryId, ["GEOCODING_FAILED"]);

    if (matches.length !== 1) {
      const reason: ExceptionReason = matches.length === 0 ? "NO_BEAT_MATCH" : "MULTIPLE_BEAT_MATCH";
      await tx.delivery.update({
        where: { id: deliveryId },
        data: { status: delivery.status === "RESCHEDULED" ? "RESCHEDULED" : "SORTED", beatId: null, assignedPostmanId: null }
      });
      await openException(tx, deliveryId, reason, matches.length > 1 ? JSON.stringify(matches) : undefined);
      // The other outcome can no longer be true.
      await resolveExceptions(tx, deliveryId, ALL_ASSIGNMENT_REASONS.filter((r) => r !== reason && r !== "GEOCODING_FAILED"));
      return matches.length === 0
        ? ({ status: "NO_BEAT_MATCH" } as const)
        : ({ status: "MULTIPLE_BEAT_MATCH", matches } as const);
    }

    const beatId = matches[0].beatId;
    const postmanId = await activePostmanOfBeat(tx, beatId);

    await tx.delivery.update({
      where: { id: deliveryId },
      data: {
        beatId,
        assignedPostmanId: postmanId,
        status: delivery.status === "RESCHEDULED" ? "RESCHEDULED" : postmanId ? "ASSIGNED" : "SORTED"
      }
    });
    await tx.deliveryAssignmentHistory.create({
      data: { deliveryId, beatId, postmanId, reason: "AUTO_BEAT_MATCH" }
    });

    if (!postmanId) {
      await openException(tx, deliveryId, "NO_POSTMAN_ASSIGNED", "The matched beat has no active postman");
      await resolveExceptions(tx, deliveryId, ["NO_BEAT_MATCH", "MULTIPLE_BEAT_MATCH"]);
      return { status: "NO_POSTMAN_ASSIGNED", beatId } as const;
    }

    await resolveExceptions(tx, deliveryId, ["NO_BEAT_MATCH", "MULTIPLE_BEAT_MATCH", "NO_POSTMAN_ASSIGNED", "INACTIVE_POSTMAN"]);
    return { status: "ASSIGNED", beatId, postmanId } as const;
  });
}

/**
 * Re-runs the PostGIS beat match for every delivery of an office that the system
 * (not an admin) placed. Called when a beat boundary changes or a beat becomes
 * active, so Delivery.beatId always reflects the CURRENT polygons.
 */
export async function rematchOfficeDeliveries(postOfficeId: string, limit = 2000) {
  const candidates = await prisma.delivery.findMany({
    where: {
      postOfficeId,
      status: { in: ["RECEIVED", ...AUTO_ASSIGNABLE_STATUSES] },
      assignmentHistory: { none: { isOverride: true } },
      address: { latitude: { not: null }, longitude: { not: null } }
    },
    include: { address: { select: { latitude: true, longitude: true } } },
    take: limit
  });

  let changed = 0;
  for (const d of candidates) {
    if (d.address.latitude == null || d.address.longitude == null) continue;
    const before = `${d.beatId}|${d.assignedPostmanId}`;
    await assignDeliveryToBeat(d.id, d.address.latitude, d.address.longitude);
    const after = await prisma.delivery.findUniqueOrThrow({ where: { id: d.id }, select: { beatId: true, assignedPostmanId: true } });
    if (before !== `${after.beatId}|${after.assignedPostmanId}`) changed++;
  }
  return { checked: candidates.length, changed };
}

/**
 * Safety net for a crash between "delivery committed" and "beat matched" (an
 * import confirms row by row): parcels that were geocoded but never assigned are
 * assigned now. Idempotent and cheap; run at startup.
 */
export async function repairUnassignedDeliveries(olderThanMs = 60_000, postOfficeId?: string) {
  const stuck = await prisma.delivery.findMany({
    where: {
      status: "RECEIVED",
      beatId: null,
      createdAt: { lt: new Date(Date.now() - olderThanMs) },
      ...(postOfficeId ? { postOfficeId } : {}),
      address: { latitude: { not: null }, longitude: { not: null } },
      exceptions: { none: { resolvedAt: null } }
    },
    include: { address: { select: { latitude: true, longitude: true } } },
    take: 500
  });

  let repaired = 0;
  for (const d of stuck) {
    if (d.address.latitude == null || d.address.longitude == null) continue;
    await assignDeliveryToBeat(d.id, d.address.latitude, d.address.longitude);
    repaired++;
  }
  return { checked: stuck.length, repaired };
}

// ── manual override ────────────────────────────────────────────────────────

export async function overrideAssignment(params: {
  deliveryId: string;
  beatId?: string;
  postmanId?: string;
  reason: string;
  userId: string;
}) {
  const existing = await prisma.delivery.findUniqueOrThrow({ where: { id: params.deliveryId } });

  if (TERMINAL_STATUSES.includes(existing.status)) {
    throw AppError.conflict(`A ${existing.status} delivery cannot be reassigned`);
  }

  if (params.beatId) {
    const beat = await prisma.beat.findUniqueOrThrow({ where: { id: params.beatId } });
    if (beat.postOfficeId !== existing.postOfficeId) {
      throw AppError.badRequest("The beat belongs to a different post office than the delivery");
    }
  }
  if (params.postmanId) {
    const postman = await prisma.postman.findUniqueOrThrow({ where: { id: params.postmanId } });
    if (postman.postOfficeId !== existing.postOfficeId) {
      throw AppError.badRequest("The postman belongs to a different post office than the delivery");
    }
    if (postman.status !== "ACTIVE") throw AppError.conflict("Only an active postman can be assigned deliveries");
  }

  const postmanChanged = !!params.postmanId && params.postmanId !== existing.assignedPostmanId;
  // A parcel handed to a different postman must be started by them, so it goes
  // back to ASSIGNED — except a rescheduled one, which keeps its meaning.
  const nextStatus: DeliveryStatus | undefined =
    params.postmanId && (postmanChanged || existing.status === "SORTED" || existing.status === "RECEIVED")
      ? existing.status === "RESCHEDULED"
        ? "RESCHEDULED"
        : "ASSIGNED"
      : undefined;

  const delivery = await prisma.$transaction(async (tx) => {
    const updated = await tx.delivery.update({
      where: { id: params.deliveryId },
      data: { beatId: params.beatId, assignedPostmanId: params.postmanId, status: nextStatus }
    });
    await tx.deliveryAssignmentHistory.create({
      data: {
        deliveryId: params.deliveryId,
        beatId: params.beatId,
        postmanId: params.postmanId,
        reason: params.reason,
        changedBy: params.userId,
        isOverride: true
      }
    });
    if (params.postmanId) {
      await resolveExceptions(tx, params.deliveryId, ["NO_POSTMAN_ASSIGNED", "INACTIVE_POSTMAN"]);
    }
    if (params.beatId) {
      await resolveExceptions(tx, params.deliveryId, ["NO_BEAT_MATCH", "MULTIPLE_BEAT_MATCH"]);
    }
    return updated;
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

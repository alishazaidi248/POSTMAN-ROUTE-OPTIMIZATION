import { AssignmentMethod, DeliveryStatus, ExceptionAction, ExceptionReason, GeocodingPrecision, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../config/prisma";
import { AppError } from "../utils/AppError";
import { recordAudit } from "./audit.service";
import { loadDirectory } from "./addressing/beatDirectory.service";
import { matchBeatByName } from "./addressing/beatMatcher";
import { Decision, ExceptionKind, Explanation, decideAssignment, isUsable } from "./addressing/assignmentDecision";
import { AssignmentChange, announceAssignmentChanges } from "./postmanNotifications.service";

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
/** The reasons the matching step can raise. Re-running the match replaces them all (the newest verdict is the only true one). */
const MATCHING_REASONS: ExceptionReason[] = [
  "GEOCODING_FAILED",
  "NO_BEAT_MATCH",
  "MULTIPLE_BEAT_MATCH",
  "AMBIGUOUS_MATCH",
  "LOW_CONFIDENCE_MATCH",
  "WEAK_LOCATION"
];
const ALL_ASSIGNMENT_REASONS: ExceptionReason[] = [...MATCHING_REASONS, "NO_POSTMAN_ASSIGNED", "INACTIVE_POSTMAN"];

export interface BeatMatch {
  beatId: string;
  beatNumber: string;
  matchCount: number;
}

// ── exceptions ─────────────────────────────────────────────────────────────

interface ExceptionDetail {
  details?: string;
  suggestedBeatId?: string | null;
  confidence?: number | null;
  locationQuality?: GeocodingPrecision | null;
  evidence?: Explanation;
}

/** Opens an exception unless the same one is already open (re-running an assignment must not pile up duplicate work
 * items for the admin); an open one is refreshed with the latest suggestion and evidence. */
async function openException(db: Db, deliveryId: string, reason: ExceptionReason, detail: ExceptionDetail = {}) {
  const data = {
    details: detail.details,
    suggestedBeatId: detail.suggestedBeatId ?? null,
    confidence: detail.confidence == null ? null : Math.round(detail.confidence),
    locationQuality: detail.locationQuality ?? null,
    evidence: detail.evidence ? (detail.evidence as unknown as Prisma.InputJsonValue) : Prisma.DbNull
  };
  const existing = await db.assignmentException.findFirst({ where: { deliveryId, reason, resolvedAt: null } });
  if (existing) return db.assignmentException.update({ where: { id: existing.id }, data });
  return db.assignmentException.create({ data: { deliveryId, reason, ...data } });
}

/** Closes open exceptions the system has just fixed itself. */
async function resolveExceptions(db: Db, deliveryId: string, reasons: ExceptionReason[], action?: ExceptionAction) {
  await db.assignmentException.updateMany({
    where: { deliveryId, reason: { in: reasons }, resolvedAt: null },
    data: {
      resolvedAt: new Date(),
      lastAction: action ?? (reasons.includes("GEOCODING_FAILED") ? "GEOCODING_RETRIED" : "BEAT_CHANGED")
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
export async function syncBeatDeliveries(db: Db, beatId: string, changedBy?: string, sink?: AssignmentChange[]) {
  const postmanId = await activePostmanOfBeat(db, beatId);

  const deliveries = await db.delivery.findMany({
    where: {
      beatId,
      status: { in: AUTO_ASSIGNABLE_STATUSES },
      assignmentHistory: { none: { isOverride: true } }
    },
    select: { id: true, status: true, assignedPostmanId: true, trackingId: true, priority: true }
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
      sink?.push({ deliveryId: d.id, trackingId: d.trackingId, priority: d.priority, fromPostmanId: d.assignedPostmanId, toPostmanId: postmanId });
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
      await openException(db, d.id, "NO_POSTMAN_ASSIGNED", { details: "The beat has no active postman" });
      sink?.push({ deliveryId: d.id, trackingId: d.trackingId, priority: d.priority, fromPostmanId: d.assignedPostmanId, toPostmanId: null });
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
export async function assignPostmanToBeatTx(tx: Prisma.TransactionClient, postmanId: string, beatId: string | null, changedBy?: string, sink?: AssignmentChange[]) {
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

  for (const id of affectedBeats) await syncBeatDeliveries(tx, id, changedBy, sink);

  return updated;
}

export async function setPostmanBeatAssignment(postmanId: string, beatId: string | null, changedBy?: string) {
  const changes: AssignmentChange[] = [];
  const updated = await prisma.$transaction((tx) => assignPostmanToBeatTx(tx, postmanId, beatId, changedBy, changes), { timeout: 30_000 });
  announceAssignmentChanges(changes); // after the commit: nobody is told about something that was rolled back
  return updated;
}

/** Clears (postmanId null) or sets the postman of a beat — the beat-centric mirror of the above. */
export async function setBeatPostman(beatId: string, postmanId: string | null, changedBy?: string) {
  if (postmanId) return setPostmanBeatAssignment(postmanId, beatId, changedBy);

  const changes: AssignmentChange[] = [];
  const beat = await prisma.$transaction(
    async (tx) => {
      const beat = await tx.beat.findUniqueOrThrow({ where: { id: beatId } });
      const current = await tx.postmanBeatAssignment.findMany({ where: { beatId, isActive: true } });
      await tx.postmanBeatAssignment.updateMany({
        where: { beatId, isActive: true },
        data: { isActive: false, endDate: new Date() }
      });
      for (const a of current) await tx.postman.update({ where: { id: a.postmanId }, data: { assignedBeatId: null } });
      await syncBeatDeliveries(tx, beat.id, changedBy, changes);
      return beat;
    },
    { timeout: 30_000 }
  );
  announceAssignmentChanges(changes);
  return beat;
}

// ── delivery -> beat -> postman ────────────────────────────────────────────

export type AssignResult =
  | { status: "ASSIGNED"; beatId: string; postmanId: string; method: AssignmentMethod; confidence: number }
  | { status: "NO_POSTMAN_ASSIGNED"; beatId: string; method: AssignmentMethod; confidence: number }
  | { status: "NO_BEAT_MATCH" }
  | { status: "MULTIPLE_BEAT_MATCH"; matches: BeatMatch[] }
  | { status: "EXCEPTION"; reason: ExceptionKind; suggestedBeatId?: string }
  | { status: "SKIPPED"; reason: "NOT_ASSIGNABLE_STATUS" | "MANUAL_OVERRIDE" };

const EXCEPTION_REASON: Record<ExceptionKind, ExceptionReason> = {
  NO_BEAT_MATCH: "NO_BEAT_MATCH",
  MULTIPLE_BEAT_MATCH: "MULTIPLE_BEAT_MATCH",
  AMBIGUOUS_MATCH: "AMBIGUOUS_MATCH",
  LOW_CONFIDENCE_MATCH: "LOW_CONFIDENCE_MATCH",
  WEAK_LOCATION: "WEAK_LOCATION",
  GEOCODING_FAILED: "GEOCODING_FAILED"
};

/**
 * delivery address -> normalise -> match against the BEAT LIST -> (only if that is not conclusive) location precision +
 * verified territory (PostGIS ST_Contains) -> assign the beat's active postman, or open an assignment exception.
 * See services/addressing/assignmentDecision.ts for the rules and ADDRESS_MATCHING.md for how they were validated.
 *
 * The delivery's address row is the input: the beat list does NOT need coordinates, so a delivery whose geocoding failed
 * is still matched by name. The verdict, its confidence and its evidence are stored on the delivery (assignmentMethod /
 * assignmentConfidence / assignmentEvidence) or on the exception, written atomically with the assignment history.
 */
export async function assignDeliveryToBeat(deliveryId: string): Promise<AssignResult> {
  const delivery = await prisma.delivery.findUniqueOrThrow({
    where: { id: deliveryId },
    include: {
      address: true,
      postOffice: { select: { name: true, pincode: true } },
      assignmentHistory: { where: { isOverride: true }, take: 1, select: { id: true } }
    }
  });

  // A parcel that is out for delivery / finished must never be pulled back by a re-match, and a hand-made assignment is
  // not overwritten by an automatic one.
  if (delivery.status !== "RECEIVED" && !AUTO_ASSIGNABLE_STATUSES.includes(delivery.status)) {
    return { status: "SKIPPED", reason: "NOT_ASSIGNABLE_STATUS" };
  }
  if (delivery.assignmentHistory.length > 0) return { status: "SKIPPED", reason: "MANUAL_OVERRIDE" };

  const a = delivery.address;
  const located = (a.geocodingStatus === "SUCCESS" || a.geocodingStatus === "MANUAL") && a.latitude != null && a.longitude != null;
  // A located address written before precision existed (or by a provider that could not say) is treated as the weakest
  // usable kind: it can support a name match but never decide on its own.
  const precision: GeocodingPrecision = !located ? "NONE" : a.geocodingPrecision ?? "AREA";

  const directory = await loadDirectory(delivery.postOfficeId);
  const name = matchBeatByName(
    {
      parts: [a.addressLine1, a.addressLine2, a.area, a.city, a.state, a.pincode],
      localityField: a.area,
      postOfficeName: delivery.postOffice.name,
      postOfficePincode: delivery.postOffice.pincode
    },
    directory
  );
  // Territories are only consulted for a location precise enough to be believed.
  const territories = located && isUsable(precision) ? await findContainingBeats(delivery.postOfficeId, a.latitude!, a.longitude!) : [];

  const decision = decideAssignment({ name, location: { located, precision }, territories });
  const result = await applyDecision(deliveryId, delivery.status, decision, precision, territories);
  // Tell the postmen once the decision is committed: the new one (batched, or at once when URGENT) and the one who lost it.
  const now = result.status === "ASSIGNED" ? result.postmanId : null;
  announceAssignmentChanges([{ deliveryId, trackingId: delivery.trackingId, priority: delivery.priority, fromPostmanId: delivery.assignedPostmanId, toPostmanId: now }]);
  return result;
}

async function applyDecision(
  deliveryId: string,
  status: DeliveryStatus,
  decision: Decision,
  precision: GeocodingPrecision,
  territories: BeatMatch[]
): Promise<AssignResult> {
  return prisma.$transaction(async (tx) => {
    const keepStatus: DeliveryStatus = status === "RESCHEDULED" ? "RESCHEDULED" : "SORTED";

    if (decision.action === "EXCEPTION") {
      const reason = EXCEPTION_REASON[decision.reason];
      await tx.delivery.update({
        where: { id: deliveryId },
        data: { status: keepStatus, beatId: null, assignedPostmanId: null, assignmentMethod: null, assignmentConfidence: null, assignmentEvidence: Prisma.DbNull }
      });
      await openException(tx, deliveryId, reason, {
        details: decision.message,
        suggestedBeatId: decision.suggestedBeatId,
        confidence: decision.confidence,
        locationQuality: precision,
        evidence: decision.explanation
      });
      // The newest verdict is the only true one; and with no beat there is no postman to be missing.
      await resolveExceptions(tx, deliveryId, ALL_ASSIGNMENT_REASONS.filter((r) => r !== reason));
      if (decision.reason === "NO_BEAT_MATCH") return { status: "NO_BEAT_MATCH" } as const;
      if (decision.reason === "MULTIPLE_BEAT_MATCH") return { status: "MULTIPLE_BEAT_MATCH", matches: territories } as const;
      return { status: "EXCEPTION", reason: decision.reason, suggestedBeatId: decision.suggestedBeatId } as const;
    }

    const { beatId, method, confidence, explanation } = decision;
    const postmanId = await activePostmanOfBeat(tx, beatId);

    await tx.delivery.update({
      where: { id: deliveryId },
      data: {
        beatId,
        assignedPostmanId: postmanId,
        status: status === "RESCHEDULED" ? "RESCHEDULED" : postmanId ? "ASSIGNED" : "SORTED",
        assignmentMethod: method,
        assignmentConfidence: Math.round(confidence),
        assignmentEvidence: explanation as unknown as Prisma.InputJsonValue
      }
    });
    await tx.deliveryAssignmentHistory.create({
      data: { deliveryId, beatId, postmanId, reason: `AUTO_${method}` }
    });

    await resolveExceptions(tx, deliveryId, MATCHING_REASONS);
    if (!postmanId) {
      await openException(tx, deliveryId, "NO_POSTMAN_ASSIGNED", { details: "The matched beat has no active postman", suggestedBeatId: beatId });
      return { status: "NO_POSTMAN_ASSIGNED", beatId, method, confidence } as const;
    }
    await resolveExceptions(tx, deliveryId, ["NO_POSTMAN_ASSIGNED", "INACTIVE_POSTMAN"]);
    return { status: "ASSIGNED", beatId, postmanId, method, confidence } as const;
  });
}

/**
 * Point-in-polygon beat lookup via PostGIS ST_Contains over VERIFIED territories only - never a nearest-centre
 * approximation, and an unverified polygon is a draft, not evidence.
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

/**
 * Re-runs the whole match for every delivery of an office that the system (not an admin) placed. Called when a beat, its
 * list of localities or its boundary changes, so Delivery.beatId always reflects the CURRENT beat list and territories.
 */
export async function rematchOfficeDeliveries(postOfficeId: string, limit = 2000, opts: { onlyUnassigned?: boolean } = {}) {
  const candidates = await prisma.delivery.findMany({
    where: {
      postOfficeId,
      ...(opts.onlyUnassigned ? { beatId: null } : {}),
      status: { in: ["RECEIVED", ...AUTO_ASSIGNABLE_STATUSES] },
      assignmentHistory: { none: { isOverride: true } }
    },
    select: { id: true, beatId: true, assignedPostmanId: true },
    take: limit
  });

  let changed = 0;
  for (const d of candidates) {
    await assignDeliveryToBeat(d.id);
    const after = await prisma.delivery.findUniqueOrThrow({ where: { id: d.id }, select: { beatId: true, assignedPostmanId: true } });
    if (`${d.beatId}|${d.assignedPostmanId}` !== `${after.beatId}|${after.assignedPostmanId}`) changed++;
  }
  return { checked: candidates.length, changed };
}

/**
 * Safety net for a crash between "delivery committed" and "beat matched" (an import confirms row by row): parcels that
 * were never assigned and have no open exception are matched now. Idempotent and cheap; run at startup.
 */
export async function repairUnassignedDeliveries(olderThanMs = 60_000, postOfficeId?: string) {
  const stuck = await prisma.delivery.findMany({
    where: {
      status: "RECEIVED",
      beatId: null,
      createdAt: { lt: new Date(Date.now() - olderThanMs) },
      ...(postOfficeId ? { postOfficeId } : {}),
      exceptions: { none: { resolvedAt: null } }
    },
    select: { id: true },
    take: 500
  });

  for (const d of stuck) await assignDeliveryToBeat(d.id);
  return { checked: stuck.length, repaired: stuck.length };
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

  // "Choose Beat" without a postman: the parcel goes to whoever covers that beat now.
  const postmanId = params.postmanId ?? (params.beatId ? (await activePostmanOfBeat(prisma, params.beatId)) ?? undefined : undefined);

  const postmanChanged = !!postmanId && postmanId !== existing.assignedPostmanId;
  // A parcel handed to a different postman must be started by them, so it goes
  // back to ASSIGNED — except a rescheduled one, which keeps its meaning.
  const nextStatus: DeliveryStatus | undefined =
    postmanId && (postmanChanged || existing.status === "SORTED" || existing.status === "RECEIVED")
      ? existing.status === "RESCHEDULED"
        ? "RESCHEDULED"
        : "ASSIGNED"
      : undefined;

  const delivery = await prisma.$transaction(async (tx) => {
    const updated = await tx.delivery.update({
      where: { id: params.deliveryId },
      data: {
        beatId: params.beatId,
        assignedPostmanId: postmanId,
        status: nextStatus,
        // A person decided: the automatic evidence no longer describes this assignment.
        ...(params.beatId
          ? {
              assignmentMethod: "MANUAL" as const,
              assignmentConfidence: 100,
              assignmentEvidence: { by: params.userId, reason: params.reason, previousBeatId: existing.beatId, previousMethod: existing.assignmentMethod, previousConfidence: existing.assignmentConfidence } as Prisma.InputJsonValue
            }
          : {})
      }
    });
    await tx.deliveryAssignmentHistory.create({
      data: {
        deliveryId: params.deliveryId,
        beatId: params.beatId,
        postmanId,
        reason: params.reason,
        changedBy: params.userId,
        isOverride: true
      }
    });
    if (postmanId) {
      await resolveExceptions(tx, params.deliveryId, ["NO_POSTMAN_ASSIGNED", "INACTIVE_POSTMAN"], "MANUALLY_ASSIGNED");
    }
    if (params.beatId) {
      await resolveExceptions(tx, params.deliveryId, MATCHING_REASONS, "MANUALLY_ASSIGNED");
      // A beat nobody covers is not a finished assignment: the parcel waits, and the administrator is still told.
      if (!postmanId) await openException(tx, params.deliveryId, "NO_POSTMAN_ASSIGNED", { details: "The chosen beat has no active postman", suggestedBeatId: params.beatId });
    }
    return updated;
  });

  announceAssignmentChanges([
    { deliveryId: existing.id, trackingId: existing.trackingId, priority: existing.priority, fromPostmanId: existing.assignedPostmanId, toPostmanId: delivery.assignedPostmanId }
  ]);

  await recordAudit({
    userId: params.userId,
    action: "ASSIGNMENT_OVERRIDDEN",
    entityType: "Delivery",
    entityId: params.deliveryId,
    newValue: { beatId: params.beatId, postmanId },
    reason: params.reason
  });

  return delivery;
}

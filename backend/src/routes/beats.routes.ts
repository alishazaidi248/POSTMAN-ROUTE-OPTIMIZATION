import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { requireAuth, adminOnly, resolvePostOfficeScope, assertOwnsResource } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../utils/asyncHandler";
import { AppError } from "../utils/AppError";
import { recordAudit } from "../services/audit.service";
import { assignPostmanToBeatTx, rematchOfficeDeliveries, setBeatPostman } from "../services/assignment.service";
import { TerritoryAnalysis, analyseTerritory, geoJsonPolygon, overlapPairs } from "../services/beats/territory";
import { invalidateDirectory } from "../services/addressing/beatDirectory.service";
import { AssignmentChange, announceAssignmentChanges } from "../services/postmanNotifications.service";

/**
 * Beats are stored ONLY in PostgreSQL/PostGIS. The polygon is a PostGIS
 * geometry(Polygon, 4326); every read rebuilds the GeoJSON from that column, so
 * nothing about a beat lives in the browser. All endpoints are back-office only.
 */
export const beatsRouter = Router();
beatsRouter.use(requireAuth, adminOnly);

// ── reads (the database, always) ───────────────────────────────────────────

const beatSelect = Prisma.sql`
  SELECT b.id, b."postOfficeId", po.name AS "postOfficeName", b.beat_number AS "beatNumber", b.name, b.status,
         b."centerLatitude", b."centerLongitude", b.metadata, b."createdAt", b."updatedAt",
         b."verificationStatus", b."verifiedAt",
         (SELECT u.name FROM "User" u WHERE u.id = b."verifiedById") AS "verifiedByName",
         (b.boundary IS NOT NULL) AS "hasTerritory",
         ST_AsGeoJSON(b.boundary)::json AS boundary,
         (SELECT COUNT(*)::int FROM "Delivery" d WHERE d."beatId" = b.id) AS "deliveryCount",
         (SELECT pba."postmanId" FROM "PostmanBeatAssignment" pba
            WHERE pba."beatId" = b.id AND pba."isActive" = true LIMIT 1) AS "assignedPostmanId",
         (SELECT p.name FROM "PostmanBeatAssignment" pba
            JOIN "Postman" p ON p.id = pba."postmanId"
            WHERE pba."beatId" = b.id AND pba."isActive" = true LIMIT 1) AS "assignedPostmanName"
  FROM "Beat" b
  JOIN "PostOffice" po ON po.id = b."postOfficeId"
`;

async function readBeat(db: Prisma.TransactionClient | typeof prisma, id: string) {
  const rows = await db.$queryRaw<any[]>(Prisma.sql`${beatSelect} WHERE b.id = ${id}`);
  if (rows.length === 0) throw AppError.notFound("Beat not found");
  // boundaryGeoJson kept as an alias for older callers.
  return { ...rows[0], boundaryGeoJson: rows[0].boundary };
}

/** Other ACTIVE beats of the same office whose polygon overlaps this one (a delivery inside both would need manual resolution). */
async function overlappingBeats(db: Prisma.TransactionClient | typeof prisma, beatId: string) {
  return db.$queryRaw<{ id: string; beatNumber: string }[]>(Prisma.sql`
    SELECT o.id, o.beat_number AS "beatNumber"
    FROM "Beat" b JOIN "Beat" o ON o."postOfficeId" = b."postOfficeId" AND o.id <> b.id AND o.status = 'ACTIVE'
    WHERE b.id = ${beatId} AND b.boundary IS NOT NULL AND o.boundary IS NOT NULL
      AND ST_Area(ST_Intersection(b.boundary, o.boundary)::geography) > 1
  `);
}

/**
 * A territory is only saved when it is a real shape of a sensible size in the right place, and - unless the administrator
 * says they have seen it - when it overlaps no other beat: an address inside two territories cannot be assigned, so an
 * overlap is a decision, never an accident. Returns the analysis (centre point, overlaps) for the caller.
 */
async function requireSoundTerritory(
  db: Prisma.TransactionClient | typeof prisma,
  boundary: z.infer<typeof geoJsonPolygon>,
  ctx: { postOfficeId: string; excludeBeatId?: string; beatNumber?: string; acknowledgeOverlap?: boolean }
): Promise<TerritoryAnalysis> {
  const analysis = await analyseTerritory(db, boundary, ctx);
  if (!analysis.valid) throw AppError.badRequest(`The territory cannot be saved: ${analysis.problems.join(" ")}`, { problems: analysis.problems });
  if (analysis.overlaps.length > 0 && !ctx.acknowledgeOverlap) {
    throw new AppError(
      `${analysis.overlaps.map((o) => o.message).join(" ")} Adjust the outline, or confirm that the overlap is intended (addresses inside it will need to be assigned by hand).`,
      409,
      { overlaps: analysis.overlaps, requiresAcknowledgement: true }
    );
  }
  return analysis;
}

beatsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const postOfficeId = resolvePostOfficeScope(req);
    const beats = await prisma.$queryRaw<any[]>(Prisma.sql`
      ${beatSelect}
      WHERE (${postOfficeId}::text IS NULL OR b."postOfficeId" = ${postOfficeId})
      ORDER BY po.name ASC, b.beat_number ASC
    `);
    const pairs = await overlapPairs(prisma, postOfficeId ?? null);
    const overlapsOf = (id: string) =>
      pairs.flatMap((p) => (p.a.id === id ? [{ id: p.b.id, beatNumber: p.b.beatNumber, areaSqm: p.areaSqm }] : p.b.id === id ? [{ id: p.a.id, beatNumber: p.a.beatNumber, areaSqm: p.areaSqm }] : []));
    res.json(beats.map((b) => ({ ...b, boundaryGeoJson: b.boundary, overlaps: overlapsOf(b.id) })));
  })
);

/**
 * The state of every territory of the office in one place: which beats have a verified territory, which are waiting for
 * verification, which have none, and which overlap which. Read from PostGIS on every call.
 */
beatsRouter.get(
  "/territory-report",
  asyncHandler(async (req, res) => {
    const postOfficeId = resolvePostOfficeScope(req);
    const beats = await prisma.$queryRaw<
      { id: string; beatNumber: string; name: string; status: string; verificationStatus: string; hasTerritory: boolean; areaSqm: number | null; postmen: number; deliveries: number }[]
    >(Prisma.sql`
      SELECT b.id, b.beat_number AS "beatNumber", b.name, b.status, b."verificationStatus", (b.boundary IS NOT NULL) AS "hasTerritory",
             CASE WHEN b.boundary IS NULL THEN NULL ELSE ROUND(ST_Area(b.boundary::geography))::float END AS "areaSqm",
             (SELECT COUNT(*)::int FROM "PostmanBeatAssignment" pba WHERE pba."beatId" = b.id AND pba."isActive" = true) AS postmen,
             (SELECT COUNT(*)::int FROM "Delivery" d WHERE d."beatId" = b.id) AS deliveries
      FROM "Beat" b
      WHERE b.status = 'ACTIVE' AND (${postOfficeId}::text IS NULL OR b."postOfficeId" = ${postOfficeId})
      ORDER BY b.beat_number
    `);
    const pairs = await overlapPairs(prisma, postOfficeId ?? null);
    const overlapping = new Set(pairs.flatMap((p) => [p.a.id, p.b.id]));
    const state = (b: (typeof beats)[number]) =>
      !b.hasTerritory ? "MISSING" : b.verificationStatus === "VERIFIED" ? "VERIFIED" : "NEEDS_VERIFICATION";
    res.json({
      summary: {
        total: beats.length,
        verified: beats.filter((b) => state(b) === "VERIFIED").length,
        needsVerification: beats.filter((b) => state(b) === "NEEDS_VERIFICATION").length,
        missing: beats.filter((b) => state(b) === "MISSING").length,
        overlapping: overlapping.size,
        overlapPairs: pairs.length
      },
      beats: beats.map((b) => ({ ...b, territory: state(b), overlapping: overlapping.has(b.id) })),
      overlaps: pairs
    });
  })
);

beatsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const beat = await readBeat(prisma, req.params.id);
    assertOwnsResource(req, beat.postOfficeId);
    res.json(beat);
  })
);

// ── create ─────────────────────────────────────────────────────────────────

const beatSchema = z.object({
  body: z.object({
    // Omit for an ADMIN: their own post office is used. A SUPER_ADMIN must say which.
    postOfficeId: z.string().uuid().optional(),
    beatNumber: z.string().trim().min(1).max(30),
    name: z.string().trim().min(1).max(120),
    // Optional: computed by PostGIS (a point guaranteed to be inside the polygon) when omitted.
    centerLatitude: z.number().min(-90).max(90).optional(),
    centerLongitude: z.number().min(-180).max(180).optional(),
    boundary: geoJsonPolygon,
    metadata: z.record(z.any()).optional(),
    // Give the new beat its postman in the same transaction.
    postmanId: z.string().uuid().nullable().optional(),
    // The administrator has seen that this territory overlaps another beat and wants it anyway.
    acknowledgeOverlap: z.boolean().optional()
  })
});

beatsRouter.post(
  "/",
  validate(beatSchema),
  asyncHandler(async (req, res) => {
    const { beatNumber, name, boundary, metadata, postmanId } = req.body;

    const postOfficeId = req.user!.role === "SUPER_ADMIN" ? req.body.postOfficeId : (req.body.postOfficeId ?? req.user!.postOfficeId);
    if (!postOfficeId) throw AppError.badRequest("postOfficeId is required for a Super Admin");
    // An ADMIN naming another office is refused; a SUPER_ADMIN may target any.
    if (req.user!.role !== "SUPER_ADMIN" && postOfficeId !== req.user!.postOfficeId) {
      throw AppError.forbidden("Cannot create resources for another post office");
    }

    const assignmentChanges: AssignmentChange[] = [];
    const id = await prisma.$transaction(
      async (tx) => {
        const office = await tx.postOffice.findUnique({ where: { id: postOfficeId }, select: { id: true } });
        if (!office) throw AppError.notFound("Post office not found");

        const duplicate = await tx.beat.findUnique({ where: { postOfficeId_beatNumber: { postOfficeId, beatNumber } }, select: { id: true } });
        if (duplicate) throw AppError.conflict(`Beat ${beatNumber} already exists in this post office`);

        const computed = await requireSoundTerritory(tx, boundary, { postOfficeId, beatNumber, acknowledgeOverlap: req.body.acknowledgeOverlap });
        const centerLatitude = req.body.centerLatitude ?? computed.centerLatitude!;
        const centerLongitude = req.body.centerLongitude ?? computed.centerLongitude!;

        const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
          INSERT INTO "Beat" (id, "postOfficeId", beat_number, name, boundary, "centerLatitude", "centerLongitude", status, metadata,
                              "verificationStatus", "verifiedAt", "verifiedById", "createdAt", "updatedAt")
          VALUES (gen_random_uuid(), ${postOfficeId}, ${beatNumber}, ${name}, ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(boundary)}), 4326),
                  ${centerLatitude}, ${centerLongitude}, 'ACTIVE', ${metadata ? JSON.stringify(metadata) : null}::jsonb,
                  'VERIFIED', now(), ${req.user!.sub}, now(), now())
          RETURNING id
        `);
        const beatId = rows[0].id;

        if (postmanId) await assignPostmanToBeatTx(tx, postmanId, beatId, req.user!.sub, assignmentChanges);
        return beatId;
      },
      { timeout: 30_000 }
    );

    announceAssignmentChanges(assignmentChanges);
    // A new beat (and polygon) may now identify addresses that had no beat.
    invalidateDirectory(postOfficeId);
    const rematch = await rematchOfficeDeliveries(postOfficeId);

    // The record the client shows is read back from PostgreSQL, not echoed.
    const created = await readBeat(prisma, id);
    const overlaps = await overlappingBeats(prisma, id);
    await recordAudit({ req, action: "BEAT_CREATED", entityType: "Beat", entityId: id, newValue: { ...created, boundary: undefined, boundaryGeoJson: undefined } });
    res.status(201).json({ ...created, overlaps, rematch });
  })
);

// ── update ─────────────────────────────────────────────────────────────────

const beatUpdateSchema = z.object({
  body: z
    .object({
      beatNumber: z.string().trim().min(1).max(30).optional(),
      name: z.string().trim().min(1).max(120).optional(),
      centerLatitude: z.number().min(-90).max(90).optional(),
      centerLongitude: z.number().min(-180).max(180).optional(),
      boundary: geoJsonPolygon.optional(),
      // With a new boundary: mark the beat verified in the same action (the administrator has just
      // looked at the territory). Without it a changed territory awaits verification.
      verified: z.boolean().optional(),
      acknowledgeOverlap: z.boolean().optional(),
      metadata: z.record(z.any()).optional()
    })
    .refine((b) => Object.keys(b).length > 0, { message: "Nothing to update" })
});

beatsRouter.put(
  "/:id",
  validate(beatUpdateSchema),
  asyncHandler(async (req, res) => {
    const { boundary, verified, acknowledgeOverlap, ...fields } = req.body as z.infer<typeof beatUpdateSchema>["body"];
    const before = await readBeat(prisma, req.params.id);
    assertOwnsResource(req, before.postOfficeId);

    if (fields.beatNumber && fields.beatNumber !== before.beatNumber) {
      const clash = await prisma.beat.findUnique({
        where: { postOfficeId_beatNumber: { postOfficeId: before.postOfficeId, beatNumber: fields.beatNumber } },
        select: { id: true }
      });
      if (clash) throw AppError.conflict(`Beat ${fields.beatNumber} already exists in this post office`);
    }

    // Boundary and attributes change together or not at all.
    await prisma.$transaction(async (tx) => {
      if (boundary) {
        const computed = await requireSoundTerritory(tx, boundary, {
          postOfficeId: before.postOfficeId,
          excludeBeatId: req.params.id,
          beatNumber: fields.beatNumber ?? before.beatNumber,
          acknowledgeOverlap
        });
        await tx.$executeRaw(Prisma.sql`
          UPDATE "Beat" SET boundary = ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(boundary)}), 4326), "updatedAt" = now(),
            "verificationStatus" = ${verified ? "VERIFIED" : "PENDING_VERIFICATION"}::"BeatVerificationStatus",
            "verifiedAt" = ${verified ? new Date() : null},
            "verifiedById" = ${verified ? req.user!.sub : null}
          WHERE id = ${req.params.id}
        `);
        if (fields.centerLatitude === undefined) fields.centerLatitude = computed.centerLatitude!;
        if (fields.centerLongitude === undefined) fields.centerLongitude = computed.centerLongitude!;
      }
      await tx.beat.update({
        where: { id: req.params.id },
        data: {
          beatNumber: fields.beatNumber,
          name: fields.name,
          centerLatitude: fields.centerLatitude,
          centerLongitude: fields.centerLongitude,
          metadata: fields.metadata as Prisma.InputJsonValue | undefined
        }
      });
    });

    // Parcels whose address now falls in a different (or no) polygon follow it; a rename changes how the beat is found.
    invalidateDirectory(before.postOfficeId);
    const rematch = boundary || fields.name || fields.beatNumber ? await rematchOfficeDeliveries(before.postOfficeId) : undefined;

    const updated = await readBeat(prisma, req.params.id);
    await recordAudit({
      req,
      action: boundary ? "BEAT_TERRITORY_UPDATED" : "BEAT_UPDATED",
      entityType: "Beat",
      entityId: req.params.id,
      oldValue: { ...before, boundary: undefined, boundaryGeoJson: undefined },
      newValue: { ...updated, boundary: undefined, boundaryGeoJson: undefined }
    });
    res.json({ ...updated, overlaps: boundary ? await overlappingBeats(prisma, req.params.id) : undefined, rematch });
  })
);

// ── verification ───────────────────────────────────────────────────────────

/**
 * An administrator confirms that this beat's territory is right. Stored in PostgreSQL (who, when),
 * so it survives refresh, logout and restart. Only a beat that HAS a territory can be verified;
 * from then on its territory takes part in matching deliveries to the beat.
 */
beatsRouter.post(
  "/:id/verify",
  asyncHandler(async (req, res) => {
    const before = await readBeat(prisma, req.params.id);
    assertOwnsResource(req, before.postOfficeId);
    if (!before.hasTerritory) {
      throw AppError.badRequest("This beat has no territory yet. Draw its territory on the map, then verify it.");
    }
    if (before.verificationStatus !== "VERIFIED") {
      // A territory that overlaps another beat is verified only knowingly.
      const overlaps = await overlappingBeats(prisma, req.params.id);
      if (overlaps.length > 0 && req.body?.acknowledgeOverlap !== true) {
        throw new AppError(
          `Beat ${before.beatNumber} overlaps Beat ${overlaps.map((o) => o.beatNumber).join(", Beat ")}. Adjust the outline, or confirm that the overlap is intended before verifying.`,
          409,
          { overlaps, requiresAcknowledgement: true }
        );
      }
      await prisma.beat.update({
        where: { id: req.params.id },
        data: { verificationStatus: "VERIFIED", verifiedAt: new Date(), verifiedById: req.user!.sub }
      });
    }
    // Verified territories are the ones deliveries are matched against.
    const rematch = await rematchOfficeDeliveries(before.postOfficeId);
    const verified = await readBeat(prisma, req.params.id);
    if (before.verificationStatus !== "VERIFIED") {
      await recordAudit({
        req,
        action: "BEAT_VERIFIED",
        entityType: "Beat",
        entityId: req.params.id,
        oldValue: { verificationStatus: before.verificationStatus },
        newValue: { verificationStatus: "VERIFIED", beatNumber: verified.beatNumber }
      });
    }
    res.json({ ...verified, overlaps: await overlappingBeats(prisma, req.params.id), rematch });
  })
);

// ── status ─────────────────────────────────────────────────────────────────

beatsRouter.post(
  "/:id/deactivate",
  asyncHandler(async (req, res) => {
    const existing = await prisma.beat.findUniqueOrThrow({ where: { id: req.params.id } });
    assertOwnsResource(req, existing.postOfficeId);
    await prisma.beat.update({ where: { id: req.params.id }, data: { status: "INACTIVE" } });
    invalidateDirectory(existing.postOfficeId);
    await recordAudit({ req, action: "BEAT_DEACTIVATED", entityType: "Beat", entityId: req.params.id });
    res.json(await readBeat(prisma, req.params.id));
  })
);

beatsRouter.post(
  "/:id/activate",
  asyncHandler(async (req, res) => {
    const existing = await prisma.beat.findUniqueOrThrow({ where: { id: req.params.id } });
    assertOwnsResource(req, existing.postOfficeId);
    await prisma.beat.update({ where: { id: req.params.id }, data: { status: "ACTIVE" } });
    invalidateDirectory(existing.postOfficeId);
    await rematchOfficeDeliveries(existing.postOfficeId);
    await recordAudit({ req, action: "BEAT_UPDATED", entityType: "Beat", entityId: req.params.id, newValue: { status: "ACTIVE" } });
    res.json(await readBeat(prisma, req.params.id));
  })
);

// ── postman assignment ─────────────────────────────────────────────────────

beatsRouter.post(
  "/:id/assign-postman",
  // postmanId: null clears the beat's postman.
  validate(z.object({ body: z.object({ postmanId: z.string().uuid().nullable() }) })),
  asyncHandler(async (req, res) => {
    const beat = await prisma.beat.findUniqueOrThrow({ where: { id: req.params.id } });
    assertOwnsResource(req, beat.postOfficeId);
    if (req.body.postmanId) {
      const postman = await prisma.postman.findUniqueOrThrow({ where: { id: req.body.postmanId } });
      assertOwnsResource(req, postman.postOfficeId);
    }

    // One transaction: assignment rows, both postmen's denormalised beat, and the beat's parcels.
    await setBeatPostman(req.params.id, req.body.postmanId, req.user!.sub);

    await recordAudit({
      req,
      action: "BEAT_POSTMAN_ASSIGNED",
      entityType: "Beat",
      entityId: req.params.id,
      newValue: { assignedPostmanId: req.body.postmanId }
    });
    res.status(201).json(await readBeat(prisma, req.params.id));
  })
);

beatsRouter.get(
  "/:id/workload",
  asyncHandler(async (req, res) => {
    const beat = await prisma.beat.findUniqueOrThrow({ where: { id: req.params.id } });
    assertOwnsResource(req, beat.postOfficeId);
    const counts = await prisma.delivery.groupBy({
      by: ["status"],
      where: { beatId: req.params.id },
      _count: true
    });
    res.json(counts);
  })
);

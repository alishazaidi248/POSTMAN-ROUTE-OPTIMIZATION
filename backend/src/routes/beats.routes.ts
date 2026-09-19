import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { requireAuth, requireRole, resolvePostOfficeScope, assertCanWriteToPostOffice, assertOwnsResource } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../utils/asyncHandler";
import { AppError } from "../utils/AppError";
import { recordAudit } from "../services/audit.service";
import { setPostmanBeatAssignment } from "../services/assignment.service";

export const beatsRouter = Router();
beatsRouter.use(requireAuth);

const geoJsonPolygon = z.object({
  type: z.literal("Polygon"),
  coordinates: z.array(z.array(z.tuple([z.number(), z.number()])))
});

beatsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const postOfficeId = resolvePostOfficeScope(req);
    const beats = await prisma.$queryRaw(Prisma.sql`
      SELECT b.id, b."postOfficeId", po.name AS "postOfficeName", b.beat_number AS "beatNumber", b.name, b.status,
             b."centerLatitude", b."centerLongitude", b.metadata,
             ST_AsGeoJSON(b.boundary)::json AS boundary,
             (SELECT COUNT(*)::int FROM "Delivery" d WHERE d."beatId" = b.id) AS "deliveryCount",
             (SELECT p.name FROM "PostmanBeatAssignment" pba
                JOIN "Postman" p ON p.id = pba."postmanId"
                WHERE pba."beatId" = b.id AND pba."isActive" = true
                LIMIT 1) AS "assignedPostmanName"
      FROM "Beat" b
      JOIN "PostOffice" po ON po.id = b."postOfficeId"
      WHERE (${postOfficeId}::text IS NULL OR b."postOfficeId" = ${postOfficeId})
      ORDER BY po.name ASC, b.beat_number ASC
    `);
    res.json(beats);
  })
);

beatsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT b.id, b."postOfficeId", po.name AS "postOfficeName", b.beat_number AS "beatNumber", b.name, b.status,
             b."centerLatitude", b."centerLongitude", b.metadata, b."createdAt", b."updatedAt",
             ST_AsGeoJSON(b.boundary)::json AS "boundaryGeoJson",
             (SELECT COUNT(*)::int FROM "Delivery" d WHERE d."beatId" = b.id) AS "deliveryCount",
             (SELECT p.name FROM "PostmanBeatAssignment" pba
                JOIN "Postman" p ON p.id = pba."postmanId"
                WHERE pba."beatId" = b.id AND pba."isActive" = true
                LIMIT 1) AS "assignedPostmanName"
      FROM "Beat" b
      JOIN "PostOffice" po ON po.id = b."postOfficeId"
      WHERE b.id = ${req.params.id}
    `);
    if (rows.length === 0) throw AppError.notFound("Beat not found");
    assertOwnsResource(req, rows[0].postOfficeId);
    res.json(rows[0]);
  })
);

const beatSchema = z.object({
  body: z.object({
    postOfficeId: z.string().uuid(),
    beatNumber: z.string().min(1),
    name: z.string().min(1),
    centerLatitude: z.number(),
    centerLongitude: z.number(),
    boundary: geoJsonPolygon,
    metadata: z.record(z.any()).optional()
  })
});

beatsRouter.post(
  "/",
  requireRole("ADMIN", "SUPER_ADMIN"),
  validate(beatSchema),
  asyncHandler(async (req, res) => {
    const { postOfficeId, beatNumber, name, centerLatitude, centerLongitude, boundary, metadata } = req.body;
    assertCanWriteToPostOffice(req, postOfficeId);
    const geoJsonStr = JSON.stringify(boundary);

    const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
      INSERT INTO "Beat" (id, "postOfficeId", beat_number, name, boundary, "centerLatitude", "centerLongitude", status, metadata, "createdAt", "updatedAt")
      VALUES (gen_random_uuid(), ${postOfficeId}, ${beatNumber}, ${name}, ST_SetSRID(ST_GeomFromGeoJSON(${geoJsonStr}), 4326),
              ${centerLatitude}, ${centerLongitude}, 'ACTIVE', ${metadata ? JSON.stringify(metadata) : null}::jsonb, now(), now())
      RETURNING id, "postOfficeId", beat_number AS "beatNumber", name, "centerLatitude", "centerLongitude", status
    `);

    await recordAudit({ req, action: "BEAT_CREATED", entityType: "Beat", entityId: rows[0].id, newValue: rows[0] });
    res.status(201).json(rows[0]);
  })
);

beatsRouter.put(
  "/:id",
  requireRole("ADMIN", "SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const { beatNumber, name, centerLatitude, centerLongitude, boundary, metadata } = req.body as {
      beatNumber?: string; name?: string; centerLatitude?: number; centerLongitude?: number; boundary?: unknown; metadata?: Record<string, unknown>;
    };

    const before = await prisma.beat.findUniqueOrThrow({ where: { id: req.params.id } });
    assertOwnsResource(req, before.postOfficeId);

    if (boundary) {
      await prisma.$executeRaw(Prisma.sql`
        UPDATE "Beat" SET boundary = ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(boundary)}), 4326), "updatedAt" = now()
        WHERE id = ${req.params.id}
      `);
    }

    const updated = await prisma.beat.update({
      where: { id: req.params.id },
      data: {
        beatNumber,
        name,
        centerLatitude,
        centerLongitude,
        metadata: metadata as any
      }
    });

    await recordAudit({ req, action: "BEAT_UPDATED", entityType: "Beat", entityId: updated.id, oldValue: before, newValue: updated });
    res.json(updated);
  })
);

beatsRouter.post(
  "/:id/deactivate",
  requireRole("ADMIN", "SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const existing = await prisma.beat.findUniqueOrThrow({ where: { id: req.params.id } });
    assertOwnsResource(req, existing.postOfficeId);
    const updated = await prisma.beat.update({ where: { id: req.params.id }, data: { status: "INACTIVE" } });
    await recordAudit({ req, action: "BEAT_DEACTIVATED", entityType: "Beat", entityId: updated.id });
    res.json(updated);
  })
);

beatsRouter.post(
  "/:id/activate",
  requireRole("ADMIN", "SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const existing = await prisma.beat.findUniqueOrThrow({ where: { id: req.params.id } });
    assertOwnsResource(req, existing.postOfficeId);
    const updated = await prisma.beat.update({ where: { id: req.params.id }, data: { status: "ACTIVE" } });
    await recordAudit({ req, action: "BEAT_UPDATED", entityType: "Beat", entityId: updated.id, newValue: { status: "ACTIVE" } });
    res.json(updated);
  })
);

beatsRouter.post(
  "/:id/assign-postman",
  requireRole("ADMIN", "SUPER_ADMIN"),
  validate(z.object({ body: z.object({ postmanId: z.string().uuid() }) })),
  asyncHandler(async (req, res) => {
    const beat = await prisma.beat.findUniqueOrThrow({ where: { id: req.params.id } });
    assertOwnsResource(req, beat.postOfficeId);
    const postman = await prisma.postman.findUniqueOrThrow({ where: { id: req.body.postmanId } });
    assertOwnsResource(req, postman.postOfficeId);
    const updated = await setPostmanBeatAssignment(req.body.postmanId, req.params.id);
    await recordAudit({ req, action: "BEAT_UPDATED", entityType: "Beat", entityId: req.params.id, newValue: updated });
    res.status(201).json(updated);
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

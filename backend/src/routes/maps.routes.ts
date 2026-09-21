import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { requireAuth, resolvePostOfficeScope, adminOnly } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";

export const mapsRouter = Router();
mapsRouter.use(requireAuth, adminOnly);

mapsRouter.get(
  "/beats",
  asyncHandler(async (req, res) => {
    const postOfficeId = resolvePostOfficeScope(req);
    const beats = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT b.id, b.beat_number AS "beatNumber", b.name, b.status, b."postOfficeId",
             po.name AS "postOfficeName", b."verificationStatus",
             ST_AsGeoJSON(b.boundary)::json AS geometry
      FROM "Beat" b
      JOIN "PostOffice" po ON po.id = b."postOfficeId"
      WHERE (${postOfficeId}::text IS NULL OR b."postOfficeId" = ${postOfficeId})
        AND b.boundary IS NOT NULL
    `);

    res.json({
      type: "FeatureCollection",
      features: beats.map((b) => ({
        type: "Feature",
        geometry: b.geometry,
        properties: {
          id: b.id,
          beatNumber: b.beatNumber,
          name: b.name,
          status: b.status,
          postOfficeId: b.postOfficeId,
          postOfficeName: b.postOfficeName,
          verificationStatus: b.verificationStatus
        }
      }))
    });
  })
);

mapsRouter.get(
  "/deliveries",
  asyncHandler(async (req, res) => {
    const postOfficeId = resolvePostOfficeScope(req);
    const status = req.query.status as string | undefined;

    const deliveries = await prisma.delivery.findMany({
      where: {
        ...(postOfficeId ? { postOfficeId } : {}),
        ...(status ? { status: status as any } : {}),
        address: { latitude: { not: null }, longitude: { not: null } }
      },
      include: { address: true, recipient: true, beat: true, assignedPostman: true },
      take: 5000
    });

    res.json({
      type: "FeatureCollection",
      features: deliveries.map((d) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [d.address.longitude, d.address.latitude] },
        properties: {
          id: d.id,
          trackingId: d.trackingId,
          status: d.status,
          recipient: d.recipient.name,
          pincode: d.address.pincode,
          beat: d.beat?.beatNumber ?? null,
          postman: d.assignedPostman?.name ?? null
        }
      }))
    });
  })
);

mapsRouter.get(
  "/postmen",
  asyncHandler(async (req, res) => {
    const postOfficeId = resolvePostOfficeScope(req);
    const postmen = await prisma.postman.findMany({
      where: { ...(postOfficeId ? { postOfficeId } : {}), status: "ACTIVE" },
      include: { assignedBeat: { select: { beatNumber: true } } }
    });

    const locations = await Promise.all(
      postmen.map((p) => prisma.postmanLocationHistory.findFirst({ where: { postmanId: p.id }, orderBy: { recordedAt: "desc" } }))
    );

    res.json({
      type: "FeatureCollection",
      features: postmen
        .map((p, i) => ({ postman: p, location: locations[i] }))
        .filter((x) => x.location)
        .map(({ postman, location }) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [location!.longitude, location!.latitude] },
          properties: {
            id: postman.id,
            name: postman.name,
            beat: postman.assignedBeat?.beatNumber ?? null,
            isMock: location!.isMock,
            recordedAt: location!.recordedAt
          }
        }))
    });
  })
);

mapsRouter.get(
  "/post-offices",
  asyncHandler(async (req, res) => {
    const postOfficeId = resolvePostOfficeScope(req);
    const postOffices = await prisma.postOffice.findMany({
      where: postOfficeId ? { id: postOfficeId } : undefined
    });

    res.json({
      type: "FeatureCollection",
      features: postOffices.map((po) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [po.longitude, po.latitude] },
        properties: { id: po.id, name: po.name, code: po.code }
      }))
    });
  })
);

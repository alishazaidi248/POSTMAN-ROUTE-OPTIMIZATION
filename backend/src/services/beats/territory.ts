import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../config/prisma";
import { AppError } from "../../utils/AppError";

/** A beat's territory: a GeoJSON polygon (longitude, latitude), stored as a PostGIS geometry(Polygon, 4326). */
const position = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

export const geoJsonPolygon = z
  .object({
    type: z.literal("Polygon"),
    coordinates: z.array(z.array(position).min(4, "A polygon ring needs at least 4 positions").max(2000)).min(1).max(1 + 20)
  })
  .refine(
    (poly) =>
      poly.coordinates.every((ring) => {
        const first = ring[0];
        const last = ring[ring.length - 1];
        return first[0] === last[0] && first[1] === last[1];
      }),
    { message: "Every polygon ring must be closed (its first and last position must be identical)" }
  );

export type Polygon = z.infer<typeof geoJsonPolygon>;

type Db = Prisma.TransactionClient | typeof prisma;

export interface TerritoryCheck {
  valid: boolean;
  reason: string | null;
  centerLatitude: number | null;
  centerLongitude: number | null;
}

/** Asks PostGIS whether the polygon is a real, non-degenerate shape (no self-intersection, has area). */
export async function checkTerritory(db: Db, boundary: Polygon): Promise<TerritoryCheck> {
  const geo = JSON.stringify(boundary);
  try {
    const rows = await db.$queryRaw<{ valid: boolean; reason: string; area: number; lat: number; lng: number }[]>(Prisma.sql`
      SELECT ST_IsValid(g) AS valid, ST_IsValidReason(g) AS reason,
             ST_Area(g::geography) AS area,
             ST_Y(ST_PointOnSurface(g)) AS lat, ST_X(ST_PointOnSurface(g)) AS lng
      FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON(${geo}), 4326) AS g) t
    `);
    const r = rows[0];
    if (!r.valid) return { valid: false, reason: r.reason, centerLatitude: null, centerLongitude: null };
    if (!(r.area > 1)) return { valid: false, reason: "the territory has no area", centerLatitude: null, centerLongitude: null };
    return { valid: true, reason: null, centerLatitude: r.lat, centerLongitude: r.lng };
  } catch {
    return { valid: false, reason: "the territory is not a readable shape", centerLatitude: null, centerLongitude: null };
  }
}

/** Throws unless the polygon is valid; returns a point guaranteed to be inside it. */
export async function assertValidBoundary(db: Db, boundary: Polygon): Promise<{ centerLatitude: number; centerLongitude: number }> {
  const r = await checkTerritory(db, boundary);
  if (!r.valid || r.centerLatitude === null || r.centerLongitude === null) {
    throw AppError.badRequest(`Invalid beat boundary: ${r.reason}`);
  }
  return { centerLatitude: r.centerLatitude, centerLongitude: r.centerLongitude };
}

/**
 * Reads a territory written in a spreadsheet cell: GeoJSON (a Polygon, a Feature or a
 * geometry with a Polygon) or WKT (`POLYGON((lng lat, ...))`). Returns null when the cell
 * is empty; throws a plain-language Error when it is filled in but unreadable.
 */
export function parseTerritoryCell(raw: string): Polygon | null {
  const text = raw.trim();
  if (!text) return null;

  let candidate: unknown;
  if (text.startsWith("{")) {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error("The territory is not readable (the GeoJSON is broken).");
    }
    const obj = json as { type?: string; geometry?: unknown; coordinates?: unknown };
    candidate = obj.type === "Feature" ? obj.geometry : json;
  } else if (/^polygon\s*\(/i.test(text)) {
    const inner = text.replace(/^polygon\s*\(\s*\(/i, "").replace(/\)\s*\)\s*$/, "");
    const ring = inner.split(",").map((pair) => {
      const [lng, lat] = pair.trim().split(/\s+/).map(Number);
      return [lng, lat];
    });
    candidate = { type: "Polygon", coordinates: [ring] };
  } else {
    throw new Error("The territory format is not recognised (use GeoJSON or WKT POLYGON).");
  }

  const parsed = geoJsonPolygon.safeParse(candidate);
  if (!parsed.success) {
    throw new Error("The territory is incomplete: it needs a closed outline of at least 3 corners with valid coordinates.");
  }
  return parsed.data;
}

// ── territory analysis: validity, size, position and overlap ────────────────────────────────────────────────

/**
 * What a saved territory has to satisfy. The numbers are deliberately loose bounds that catch mistakes (a doodle, a polygon
 * around the wrong city, a swapped latitude/longitude, a whole district), not a judgement of a beat's real size.
 */
export const TERRITORY_LIMITS = {
  /** Smaller than this is a click, not a beat. */
  minAreaM2: 1_000,
  /** Larger than this is not a postman's beat (25 km2). */
  maxAreaM2: 25_000_000,
  /** The territory's centre must be this close to its post office; further means the wrong place or a swapped lat/lng. */
  maxDistanceFromOfficeM: 30_000,
  /** Overlaps smaller than this are drawing slivers along a shared edge and are not reported. */
  overlapToleranceM2: 25
} as const;

export interface TerritoryOverlap {
  id: string;
  beatNumber: string;
  name: string;
  areaSqm: number;
  /** "Beat 20 overlaps Beat 21" - the sentence an administrator reads. */
  message: string;
}

export interface TerritoryAnalysis {
  valid: boolean;
  /** Plain-language reasons when not valid (self-intersection, no area, too small / large, wrong place). */
  problems: string[];
  areaSqm: number | null;
  centerLatitude: number | null;
  centerLongitude: number | null;
  distanceFromOfficeM: number | null;
  overlaps: TerritoryOverlap[];
}

/**
 * Checks a territory with PostGIS and reports overlaps with the OTHER active beats of the office. Nothing is accepted
 * silently: the caller decides what to do with `problems` (refuse) and `overlaps` (refuse unless acknowledged).
 * `excludeBeatId`: the beat being edited (it does not overlap itself). `beatNumber`: used only to word the messages.
 */
export async function analyseTerritory(
  db: Db,
  boundary: Polygon,
  ctx: { postOfficeId: string; excludeBeatId?: string; beatNumber?: string }
): Promise<TerritoryAnalysis> {
  const geo = JSON.stringify(boundary);
  const own = ctx.beatNumber ? `Beat ${ctx.beatNumber}` : "This territory";
  const problems: string[] = [];
  let rows: { valid: boolean; reason: string; area: number; lat: number; lng: number; dist: number | null }[];
  try {
    rows = await db.$queryRaw(Prisma.sql`
      SELECT ST_IsValid(g) AS valid, ST_IsValidReason(g) AS reason, ST_Area(g::geography) AS area,
             ST_Y(ST_PointOnSurface(g)) AS lat, ST_X(ST_PointOnSurface(g)) AS lng,
             ST_Distance(ST_PointOnSurface(g)::geography, ST_SetSRID(ST_MakePoint(po.longitude, po.latitude), 4326)::geography) AS dist
      FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON(${geo}), 4326) AS g) t
      CROSS JOIN (SELECT latitude, longitude FROM "PostOffice" WHERE id = ${ctx.postOfficeId}) po
    `);
  } catch {
    return { valid: false, problems: ["The territory is not a readable shape."], areaSqm: null, centerLatitude: null, centerLongitude: null, distanceFromOfficeM: null, overlaps: [] };
  }
  const r = rows[0];
  if (!r) return { valid: false, problems: ["The post office of this territory was not found."], areaSqm: null, centerLatitude: null, centerLongitude: null, distanceFromOfficeM: null, overlaps: [] };

  if (!r.valid) problems.push(`The outline is not a valid shape (${r.reason}). Check that it does not cross itself.`);
  else {
    if (r.area < TERRITORY_LIMITS.minAreaM2) problems.push(`The territory is too small (${Math.round(r.area)} m²; at least ${TERRITORY_LIMITS.minAreaM2} m²).`);
    if (r.area > TERRITORY_LIMITS.maxAreaM2) problems.push(`The territory is too large (${(r.area / 1e6).toFixed(1)} km²; at most ${TERRITORY_LIMITS.maxAreaM2 / 1e6} km²) for one postman's beat.`);
    if (r.dist != null && r.dist > TERRITORY_LIMITS.maxDistanceFromOfficeM) {
      problems.push(`The territory is ${(r.dist / 1000).toFixed(0)} km from its post office. Check the position (and that latitude and longitude are not swapped).`);
    }
  }

  let overlaps: TerritoryOverlap[] = [];
  if (r.valid) {
    const found = await db.$queryRaw<{ id: string; beatNumber: string; name: string; area: number }[]>(Prisma.sql`
      SELECT o.id, o.beat_number AS "beatNumber", o.name,
             ST_Area(ST_Intersection(t.g, o.boundary)::geography) AS area
      FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON(${geo}), 4326) AS g) t
      JOIN "Beat" o ON o."postOfficeId" = ${ctx.postOfficeId} AND o.status = 'ACTIVE' AND o.boundary IS NOT NULL
      WHERE (${ctx.excludeBeatId ?? null}::text IS NULL OR o.id <> ${ctx.excludeBeatId ?? null})
        AND ST_Intersects(t.g, o.boundary)
        AND ST_Area(ST_Intersection(t.g, o.boundary)::geography) > ${TERRITORY_LIMITS.overlapToleranceM2}
      ORDER BY o.beat_number
    `);
    overlaps = found.map((o) => ({
      id: o.id,
      beatNumber: o.beatNumber,
      name: o.name,
      areaSqm: Math.round(o.area),
      message: `${own} overlaps Beat ${o.beatNumber} (${Math.round(o.area).toLocaleString("en-IN")} m²).`
    }));
  }

  return {
    valid: problems.length === 0,
    problems,
    areaSqm: r.valid ? Math.round(r.area) : null,
    centerLatitude: r.valid ? r.lat : null,
    centerLongitude: r.valid ? r.lng : null,
    distanceFromOfficeM: r.dist == null ? null : Math.round(r.dist),
    overlaps
  };
}

export interface OverlapPair {
  a: { id: string; beatNumber: string };
  b: { id: string; beatNumber: string };
  areaSqm: number;
  message: string;
}

/** Every pair of overlapping ACTIVE territories of an office (or of all offices when null), once per pair. */
export async function overlapPairs(db: Db, postOfficeId: string | null): Promise<OverlapPair[]> {
  const rows = await db.$queryRaw<{ aId: string; aNo: string; bId: string; bNo: string; area: number }[]>(Prisma.sql`
    SELECT a.id AS "aId", a.beat_number AS "aNo", b.id AS "bId", b.beat_number AS "bNo",
           ST_Area(ST_Intersection(a.boundary, b.boundary)::geography) AS area
    FROM "Beat" a
    JOIN "Beat" b ON b."postOfficeId" = a."postOfficeId" AND b.id > a.id AND b.status = 'ACTIVE' AND b.boundary IS NOT NULL
    WHERE a.status = 'ACTIVE' AND a.boundary IS NOT NULL
      AND (${postOfficeId}::text IS NULL OR a."postOfficeId" = ${postOfficeId})
      AND ST_Intersects(a.boundary, b.boundary)
      AND ST_Area(ST_Intersection(a.boundary, b.boundary)::geography) > ${TERRITORY_LIMITS.overlapToleranceM2}
    ORDER BY a.beat_number, b.beat_number
  `);
  return rows.map((r) => ({
    a: { id: r.aId, beatNumber: r.aNo },
    b: { id: r.bId, beatNumber: r.bNo },
    areaSqm: Math.round(r.area),
    message: `Beat ${r.aNo} overlaps Beat ${r.bNo} (${Math.round(r.area).toLocaleString("en-IN")} m²).`
  }));
}

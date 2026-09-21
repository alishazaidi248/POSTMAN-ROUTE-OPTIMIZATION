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

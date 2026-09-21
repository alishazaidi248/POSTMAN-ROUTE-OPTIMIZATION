import type { Polygon } from "../../src/services/beats/territory";
import { Prisma } from "@prisma/client";
import { prisma } from "../../src/config/prisma";
import { GeocodeResult } from "../../src/services/geocoding/GeocodingService";
import { createDeliveryRecords } from "../../src/services/delivery.service";
import { assignPostmanToBeatTx } from "../../src/services/assignment.service";
import { invalidateDirectory } from "../../src/services/addressing/beatDirectory.service";

/** Integration tests run against a real PostGIS database and wipe it: only a database named *_test is accepted. */
export function assertTestDatabase() {
  const url = process.env.DATABASE_URL ?? "";
  const name = url.split("?")[0].split("/").pop() ?? "";
  if (!name.endsWith("_test")) throw new Error(`Refusing to run integration tests on "${name}": DATABASE_URL must name a database ending in _test.`);
}

export async function resetDatabase() {
  assertTestDatabase();
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' AND tablename <> 'spatial_ref_sys'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  invalidateDirectory();
}

export async function makeOffice() {
  return prisma.postOffice.create({
    data: { code: "BW01", name: "Bhandup West Post Office", addressLine: "LBS Marg", city: "Mumbai", state: "Maharashtra", pincode: "400078", latitude: 19.1487, longitude: 72.9366 }
  });
}

/** A square of `sideM` metres centred on the point, as GeoJSON. */
export function square(lat: number, lng: number, sideM = 400): Polygon {
  const dLat = sideM / 2 / 111_320;
  const dLng = sideM / 2 / (111_320 * Math.cos((lat * Math.PI) / 180));
  return { type: "Polygon", coordinates: [[[lng - dLng, lat - dLat], [lng + dLng, lat - dLat], [lng + dLng, lat + dLat], [lng - dLng, lat + dLat], [lng - dLng, lat - dLat]]] };
}

export interface BeatSpec {
  number: string;
  name?: string;
  localities?: { locality: string; mainArea?: string }[];
  territory?: Polygon;
  verified?: boolean;
}

export async function makeBeat(officeId: string, spec: BeatSpec) {
  const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    INSERT INTO "Beat" (id, "postOfficeId", beat_number, name, boundary, status, "verificationStatus", "createdAt", "updatedAt")
    VALUES (gen_random_uuid(), ${officeId}, ${spec.number}, ${spec.name ?? `Beat ${spec.number}`},
            ${spec.territory ? Prisma.sql`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(spec.territory)}), 4326)` : Prisma.sql`NULL`},
            'ACTIVE', ${spec.territory ? (spec.verified ? "VERIFIED" : "PENDING_VERIFICATION") : "NEEDS_REVIEW"}::"BeatVerificationStatus", now(), now())
    RETURNING id`);
  const id = rows[0].id;
  for (const l of spec.localities ?? []) {
    await prisma.beatLocality.create({
      data: {
        beatId: id, postOfficeId: officeId, locality: l.locality, mainArea: l.mainArea ?? null,
        normalizedLocality: l.locality.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim(),
        normalizedMainArea: (l.mainArea ?? "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim()
      }
    });
  }
  invalidateDirectory(officeId);
  return id;
}

export async function makePostman(officeId: string, n: string, beatId?: string) {
  const postman = await prisma.postman.create({ data: { employeeId: `EMP-${n}`, postOfficeId: officeId, name: `Postman ${n}`, phone: `98000000${n.padStart(2, "0")}` } });
  if (beatId) await prisma.$transaction((tx) => assignPostmanToBeatTx(tx, postman.id, beatId));
  return postman;
}

export async function makeAdmin(officeId: string) {
  return prisma.user.create({ data: { email: "admin@test.local", passwordHash: "x", name: "Admin", role: "ADMIN", postOfficeId: officeId } });
}

export const geocode = (precision: GeocodeResult["precision"], lat?: number, lng?: number): GeocodeResult =>
  precision === "NONE" || lat === undefined || lng === undefined
    ? { latitude: 0, longitude: 0, confidence: 0, source: "test", status: "FAILED", precision: "NONE" }
    : { latitude: lat, longitude: lng, confidence: 0.9, source: "test", status: "SUCCESS", precision, provider: "test" };

let counter = 0;
export async function makeDelivery(
  officeId: string,
  address: { addressLine1: string; area?: string; addressLine2?: string },
  located: GeocodeResult
) {
  const { deliveryId, addressId } = await prisma.$transaction((tx) =>
    createDeliveryRecords(
      tx,
      {
        postOfficeId: officeId,
        trackingId: `TRK-${++counter}`,
        recipient: { name: `Recipient ${counter}`, phone: "9820000000" },
        address: { addressLine1: address.addressLine1, addressLine2: address.addressLine2 ?? null, area: address.area ?? null, city: "Mumbai", state: "Maharashtra", pincode: "400078" }
      },
      located
    )
  );
  return { deliveryId, addressId };
}

export const openExceptions = (deliveryId: string) => prisma.assignmentException.findMany({ where: { deliveryId, resolvedAt: null } });

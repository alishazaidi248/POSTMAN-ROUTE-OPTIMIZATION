import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";

const prisma = new PrismaClient();

// Demo/seed data only (spec §1) — Bhandup West is the pilot post office, not
// a hardcoded assumption baked into the schema or routing logic.
async function main() {
  await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS postgis`);

  const postOffice = await prisma.postOffice.upsert({
    where: { code: "MUM-BHW-400078" },
    update: {},
    create: {
      code: "MUM-BHW-400078",
      name: "Bhandup West Post Office",
      addressLine: "Bhandup West, near LBS Marg",
      city: "Mumbai",
      state: "Maharashtra",
      pincode: "400078",
      latitude: 19.1436,
      longitude: 72.9345
    }
  });

  const passwordHash = await argon2.hash("ChangeMe123!", { type: argon2.argon2id });

  await prisma.user.upsert({
    where: { email: "superadmin@postal.local" },
    update: {},
    create: { email: "superadmin@postal.local", passwordHash, name: "Super Admin", role: "SUPER_ADMIN" }
  });

  await prisma.user.upsert({
    where: { email: "admin.bhandup@postal.local" },
    update: {},
    create: {
      email: "admin.bhandup@postal.local",
      passwordHash,
      name: "Bhandup West Admin",
      role: "ADMIN",
      postOfficeId: postOffice.id
    }
  });

  // Two illustrative beats around Bhandup West. Polygons are simplified
  // rectangles for demo purposes, not surveyed boundaries.
  const beatDefs = [
    {
      beatNumber: "B01",
      name: "Bhandup West - Sector A",
      center: [19.148, 72.930] as const,
      polygon: [
        [72.925, 19.140], [72.935, 19.140], [72.935, 19.150], [72.925, 19.150], [72.925, 19.140]
      ]
    },
    {
      beatNumber: "B02",
      name: "Bhandup West - Sector B",
      center: [19.138, 72.938] as const,
      polygon: [
        [72.933, 19.133], [72.943, 19.133], [72.943, 19.143], [72.933, 19.143], [72.933, 19.133]
      ]
    }
  ];

  const beatIds: string[] = [];
  for (const def of beatDefs) {
    const existing = await prisma.beat.findUnique({
      where: { postOfficeId_beatNumber: { postOfficeId: postOffice.id, beatNumber: def.beatNumber } }
    });
    if (existing) {
      beatIds.push(existing.id);
      continue;
    }

    const geoJson = JSON.stringify({ type: "Polygon", coordinates: [def.polygon] });
    const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `INSERT INTO "Beat" (id, "postOfficeId", beat_number, name, boundary, "centerLatitude", "centerLongitude", status, "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, $3, ST_SetSRID(ST_GeomFromGeoJSON($4), 4326), $5, $6, 'ACTIVE', now(), now())
       RETURNING id`,
      postOffice.id, def.beatNumber, def.name, geoJson, def.center[0], def.center[1]
    );
    beatIds.push(rows[0].id);
  }

  const postmanDefs = [
    { employeeId: "PM-BHW-001", name: "Ramesh Kadam", phone: "9820011122", beatIndex: 0, loginEmail: "ramesh.kadam@postal.local" },
    { employeeId: "PM-BHW-002", name: "Sunita Pawar", phone: "9820033344", beatIndex: 1, loginEmail: "sunita.pawar@postal.local" }
  ];

  for (const def of postmanDefs) {
    const postman = await prisma.postman.upsert({
      where: { employeeId: def.employeeId },
      update: {},
      create: {
        employeeId: def.employeeId,
        postOfficeId: postOffice.id,
        name: def.name,
        phone: def.phone,
        status: "ACTIVE",
        assignedBeatId: beatIds[def.beatIndex]
      }
    });

    const existingAssignment = await prisma.postmanBeatAssignment.findFirst({
      where: { postmanId: postman.id, beatId: beatIds[def.beatIndex] }
    });
    if (!existingAssignment) {
      await prisma.postmanBeatAssignment.create({ data: { postmanId: postman.id, beatId: beatIds[def.beatIndex] } });
    }

    // POSTMAN-role login for the mobile app, linked to this Postman record.
    await prisma.user.upsert({
      where: { email: def.loginEmail },
      update: { postmanId: postman.id },
      create: {
        email: def.loginEmail,
        passwordHash,
        name: def.name,
        role: "POSTMAN",
        postOfficeId: postOffice.id,
        postmanId: postman.id
      }
    });
  }

  await prisma.vehicle.upsert({
    where: { assetId: "EBIKE-BHW-01" },
    update: {},
    create: {
      assetId: "EBIKE-BHW-01",
      postOfficeId: postOffice.id,
      model: "Postal E-Bike Standard",
      batteryCapacityWh: 720,
      currentBatteryPercentage: 88,
      status: "ASSIGNED"
    }
  });

  console.log("Seed complete:", { postOfficeId: postOffice.id, beatIds });
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

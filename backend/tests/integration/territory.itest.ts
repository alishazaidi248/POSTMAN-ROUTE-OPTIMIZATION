import type { Polygon } from "../../src/services/beats/territory";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/config/prisma";
import { analyseTerritory, overlapPairs } from "../../src/services/beats/territory";
import { makeBeat, makeOffice, resetDatabase, square } from "./db";

/** Territory validation and overlap detection on real PostGIS. */
let officeId: string;
const HERE = { lat: 19.1487, lng: 72.9366 };

beforeAll(async () => {
  await resetDatabase();
  officeId = (await makeOffice()).id;
  await makeBeat(officeId, { number: "20", territory: square(HERE.lat, HERE.lng, 400), verified: true });
  await makeBeat(officeId, { number: "21", territory: square(HERE.lat, HERE.lng + 0.01, 400) }); // ~1 km east: no overlap
  await makeBeat(officeId, { number: "22" }); // no territory
});
afterAll(() => prisma.$disconnect());

describe("analyseTerritory", () => {
  it("accepts a sensible territory and returns a point inside it", async () => {
    const a = await analyseTerritory(prisma, square(HERE.lat + 0.02, HERE.lng, 300), { postOfficeId: officeId });
    expect(a.valid).toBe(true);
    expect(a.overlaps).toHaveLength(0);
    expect(a.areaSqm).toBeGreaterThan(80_000);
    expect(a.centerLatitude).toBeCloseTo(HERE.lat + 0.02, 3);
  });

  it("names the beat a territory overlaps: 'Beat 30 overlaps Beat 20'", async () => {
    const a = await analyseTerritory(prisma, square(HERE.lat, HERE.lng + 0.0015, 400), { postOfficeId: officeId, beatNumber: "30" });
    expect(a.valid).toBe(true);
    expect(a.overlaps.map((o) => o.beatNumber)).toEqual(["20"]);
    expect(a.overlaps[0].message).toMatch(/^Beat 30 overlaps Beat 20/);
    expect(a.overlaps[0].areaSqm).toBeGreaterThan(1000);
  });

  it("a beat does not overlap itself when it is being edited", async () => {
    const own = await prisma.beat.findFirstOrThrow({ where: { beatNumber: "20" } });
    const a = await analyseTerritory(prisma, square(HERE.lat, HERE.lng, 400), { postOfficeId: officeId, excludeBeatId: own.id });
    expect(a.overlaps).toHaveLength(0);
  });

  it("ignores a sliver along a shared edge (drawing noise), but not a real overlap", async () => {
    const tiny = await analyseTerritory(prisma, square(HERE.lat, HERE.lng + 400 / (111_320 * Math.cos((HERE.lat * Math.PI) / 180)) - 0.0000005, 400), { postOfficeId: officeId });
    expect(tiny.overlaps).toHaveLength(0);
  });

  it("rejects a self-intersecting outline (a bow-tie)", async () => {
    const bow: Polygon = { type: "Polygon", coordinates: [[[72.9, 19.1], [72.904, 19.104], [72.904, 19.1], [72.9, 19.104], [72.9, 19.1]]] };
    const a = await analyseTerritory(prisma, bow, { postOfficeId: officeId });
    expect(a.valid).toBe(false);
    expect(a.problems.join(" ")).toMatch(/not a valid shape/);
  });

  it("rejects a territory that is too small, too large, or in the wrong city", async () => {
    expect((await analyseTerritory(prisma, square(HERE.lat, HERE.lng, 10), { postOfficeId: officeId })).problems.join(" ")).toMatch(/too small/);
    expect((await analyseTerritory(prisma, square(HERE.lat, HERE.lng, 8000), { postOfficeId: officeId })).problems.join(" ")).toMatch(/too large/);
    // the same shape a swapped latitude/longitude would give: near (72.9, 19.1) read as (lat 72.9, lng 19.1)
    const swapped = await analyseTerritory(prisma, square(28.6, 77.2, 400), { postOfficeId: officeId }); // Delhi
    expect(swapped.valid).toBe(false);
    expect(swapped.problems.join(" ")).toMatch(/km from its post office/);
  });

  it("only compares against ACTIVE beats", async () => {
    const other = await makeBeat(officeId, { number: "40", territory: square(HERE.lat - 0.02, HERE.lng, 400) });
    await prisma.beat.update({ where: { id: other }, data: { status: "INACTIVE" } });
    const a = await analyseTerritory(prisma, square(HERE.lat - 0.02, HERE.lng, 400), { postOfficeId: officeId });
    expect(a.overlaps).toHaveLength(0);
  });
});

describe("overlapPairs", () => {
  it("lists every overlapping pair once, and none for beats that only sit next to each other", async () => {
    await makeBeat(officeId, { number: "50", territory: square(HERE.lat + 0.05, HERE.lng, 400) });
    await makeBeat(officeId, { number: "51", territory: square(HERE.lat + 0.05, HERE.lng + 0.001, 400) });
    const pairs = await overlapPairs(prisma, officeId);
    const named = pairs.map((p) => [p.a.beatNumber, p.b.beatNumber].sort().join("-"));
    expect(named).toEqual(["50-51"]);
    expect(pairs[0].message).toMatch(/Beat \d+ overlaps Beat \d+/);
  });
});

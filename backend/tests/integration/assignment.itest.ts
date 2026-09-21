import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/config/prisma";
import { assignDeliveryToBeat, overrideAssignment } from "../../src/services/assignment.service";
import { geocode, makeAdmin, makeBeat, makeDelivery, makeOffice, makePostman, openExceptions, resetDatabase, square } from "./db";

/**
 * The whole assignment pipeline on a real PostGIS database: address -> beat directory -> confidence -> (precise location +
 * VERIFIED territory) -> beat + postman, or an assignment exception with a suggestion and the evidence.
 */
let officeId: string;
let beat: Record<string, string>;
const FARID = { lat: 19.1467, lng: 72.9347 };
const KOKAN = { lat: 19.1502, lng: 72.9395 };

beforeAll(resetDatabase);
afterAll(() => prisma.$disconnect());

beforeEach(async () => {
  await resetDatabase();
  officeId = (await makeOffice()).id;
  beat = {};
  // Beat 20 - Farid Nagar, Beat 17 - Kokan Nagar; Village Road is in BOTH beat 2 and beat 5 (the ambiguous case)
  beat["20"] = await makeBeat(officeId, { number: "20", name: "Beat 20 - Farid Nagar", localities: [{ locality: "FARID NAGAR", mainArea: "AFJAL CHAWL" }], territory: square(FARID.lat, FARID.lng), verified: true });
  beat["17"] = await makeBeat(officeId, { number: "17", name: "Beat 17 - Kokan Nagar", localities: [{ locality: "KOKAN NAGAR" }], territory: square(KOKAN.lat, KOKAN.lng), verified: true });
  beat["2"] = await makeBeat(officeId, { number: "2", localities: [{ locality: "VILLAGE ROAD" }] });
  beat["5"] = await makeBeat(officeId, { number: "5", localities: [{ locality: "VILLAGE ROAD" }] });
  beat["30"] = await makeBeat(officeId, { number: "30", name: "Beat 30 - Sector Nine", localities: [], territory: square(19.16, 72.95), verified: true });
  for (const n of ["20", "17", "2", "5", "30"]) await makePostman(officeId, n, beat[n]);
});

const state = (id: string) => prisma.delivery.findUniqueOrThrow({ where: { id }, include: { assignedPostman: true } });

describe("name first: the beat list identifies the beat without any geocode", () => {
  it("a strong name match is assigned even though the geocoder FAILED", async () => {
    const { deliveryId } = await makeDelivery(officeId, { addressLine1: "21 Farid Nagar", area: "Farid Nagar" }, geocode("NONE"));
    const r = await assignDeliveryToBeat(deliveryId);
    expect(r).toMatchObject({ status: "ASSIGNED", method: "NAME" });
    const d = await state(deliveryId);
    expect(d).toMatchObject({ beatId: beat["20"], status: "ASSIGNED", assignmentMethod: "NAME" });
    expect(d.assignedPostman?.employeeId).toBe("EMP-20");
    expect(d.assignmentConfidence).toBeGreaterThanOrEqual(65);
    expect(JSON.stringify(d.assignmentEvidence)).toMatch(/FARID NAGAR/); // the stored explanation
    expect(await openExceptions(deliveryId)).toHaveLength(0);
  });

  it("'Farid Nagar Bhandup W Mumbai' (one line, abbreviated) is the same place as 'Farid Nagar, Bhandup West, Mumbai'", async () => {
    const a = await makeDelivery(officeId, { addressLine1: "Farid Nagar Bhandup W Mumbai" }, geocode("NONE"));
    const b = await makeDelivery(officeId, { addressLine1: "Farid Nagar, Bhandup West, Mumbai" }, geocode("NONE"));
    await assignDeliveryToBeat(a.deliveryId);
    await assignDeliveryToBeat(b.deliveryId);
    expect((await state(a.deliveryId)).beatId).toBe(beat["20"]);
    expect((await state(b.deliveryId)).beatId).toBe(beat["20"]);
  });

  it("a weak (area / pincode) geocode inside ANOTHER beat's verified territory does not override a strong name match", async () => {
    for (const precision of ["AREA", "PINCODE"] as const) {
      const { deliveryId } = await makeDelivery(officeId, { addressLine1: "5 Farid Nagar", area: "Farid Nagar" }, geocode(precision, KOKAN.lat, KOKAN.lng));
      await assignDeliveryToBeat(deliveryId);
      expect((await state(deliveryId)).beatId, precision).toBe(beat["20"]);
    }
  });

  it("a HOUSE-level geocode that lands in a different beat is a conflict for a person - never a silent override", async () => {
    const { deliveryId } = await makeDelivery(officeId, { addressLine1: "5 Farid Nagar", area: "Farid Nagar" }, geocode("HOUSE", KOKAN.lat, KOKAN.lng));
    await assignDeliveryToBeat(deliveryId);
    expect(await state(deliveryId)).toMatchObject({ beatId: null, assignedPostmanId: null });
    const [ex] = await openExceptions(deliveryId);
    expect(ex).toMatchObject({ reason: "AMBIGUOUS_MATCH", suggestedBeatId: beat["20"], locationQuality: "HOUSE" });
    expect(ex.details).toMatch(/beat 20.*beat 17/i);
  });

  it("a HOUSE-level geocode inside the SAME beat confirms it (NAME_AND_TERRITORY)", async () => {
    const { deliveryId } = await makeDelivery(officeId, { addressLine1: "5 Farid Nagar", area: "Farid Nagar" }, geocode("HOUSE", FARID.lat, FARID.lng));
    expect(await assignDeliveryToBeat(deliveryId)).toMatchObject({ status: "ASSIGNED", method: "NAME_AND_TERRITORY" });
  });
});

describe("ambiguity and weak locations go to the administrator", () => {
  it("a locality shared by two beats is an exception that suggests a beat and lists the contenders - not a random choice", async () => {
    const { deliveryId } = await makeDelivery(officeId, { addressLine1: "9 Village Road", area: "Village Road" }, geocode("AREA", 19.15, 72.94));
    const r = await assignDeliveryToBeat(deliveryId);
    expect(r).toMatchObject({ status: "EXCEPTION", reason: "AMBIGUOUS_MATCH" });
    expect(await state(deliveryId)).toMatchObject({ beatId: null, assignedPostmanId: null, status: "SORTED" });
    const [ex] = await openExceptions(deliveryId);
    expect(ex.suggestedBeatId).toBeTruthy();
    expect(ex.confidence).toBeGreaterThan(0);
    expect(ex.locationQuality).toBe("AREA");
    expect((ex.evidence as { contenders?: string[] }).contenders?.sort()).toEqual(["2", "5"]);
  });

  it("nothing in the beat list and only an area-level geocode: WEAK_LOCATION with the message the administrator reads", async () => {
    const { deliveryId } = await makeDelivery(officeId, { addressLine1: "Some Other Lane" }, geocode("AREA", FARID.lat, FARID.lng));
    await assignDeliveryToBeat(deliveryId);
    const [ex] = await openExceptions(deliveryId);
    expect(ex.reason).toBe("WEAK_LOCATION");
    expect(ex.details).toBe("Location could not be determined precisely enough to assign this delivery automatically.");
    expect((await state(deliveryId)).beatId).toBeNull();
  });

  it("nothing in the beat list and no location at all: GEOCODING_FAILED", async () => {
    const { deliveryId } = await makeDelivery(officeId, { addressLine1: "Some Other Lane" }, geocode("NONE"));
    await assignDeliveryToBeat(deliveryId);
    expect((await openExceptions(deliveryId))[0].reason).toBe("GEOCODING_FAILED");
  });
});

describe("territory is the spatial fallback, and only a VERIFIED territory counts", () => {
  it("a house-level location inside exactly one verified territory assigns by TERRITORY", async () => {
    const { deliveryId } = await makeDelivery(officeId, { addressLine1: "Other Lane 4" }, geocode("HOUSE", 19.16, 72.95));
    expect(await assignDeliveryToBeat(deliveryId)).toMatchObject({ status: "ASSIGNED", method: "TERRITORY", beatId: beat["30"] });
    expect((await state(deliveryId)).assignmentMethod).toBe("TERRITORY");
  });

  it("an unverified (pending) territory is a draft, not evidence", async () => {
    await prisma.beat.update({ where: { id: beat["30"] }, data: { verificationStatus: "PENDING_VERIFICATION" } });
    const { deliveryId } = await makeDelivery(officeId, { addressLine1: "Other Lane 4" }, geocode("HOUSE", 19.16, 72.95));
    await assignDeliveryToBeat(deliveryId);
    expect((await openExceptions(deliveryId))[0].reason).toBe("NO_BEAT_MATCH");
  });

  it("a point inside two verified territories is a MULTIPLE_BEAT_MATCH exception, never a random pick", async () => {
    await makeBeat(officeId, { number: "31", name: "Beat 31 - Overlapping", territory: square(19.16, 72.9505, 400), verified: true });
    const { deliveryId } = await makeDelivery(officeId, { addressLine1: "Other Lane 4" }, geocode("HOUSE", 19.16, 72.9502));
    const r = await assignDeliveryToBeat(deliveryId);
    expect(r.status).toBe("MULTIPLE_BEAT_MATCH");
    expect((await openExceptions(deliveryId))[0].reason).toBe("MULTIPLE_BEAT_MATCH");
    expect((await state(deliveryId)).beatId).toBeNull();
  });
});

describe("manual decisions and lifecycle", () => {
  it("a manual override is recorded as MANUAL and is never overwritten by a re-run of the automatic match", async () => {
    const admin = await makeAdmin(officeId);
    const { deliveryId } = await makeDelivery(officeId, { addressLine1: "9 Village Road", area: "Village Road" }, geocode("AREA", 19.15, 72.94));
    await assignDeliveryToBeat(deliveryId); // -> exception
    await overrideAssignment({ deliveryId, beatId: beat["5"], reason: "Checked with the postman", userId: admin.id });
    let d = await state(deliveryId);
    expect(d).toMatchObject({ beatId: beat["5"], assignmentMethod: "MANUAL", assignmentConfidence: 100, status: "ASSIGNED" });
    expect(d.assignedPostman?.employeeId).toBe("EMP-5"); // "Choose Beat" gives the parcel to that beat's postman
    expect(await openExceptions(deliveryId)).toHaveLength(0);

    expect(await assignDeliveryToBeat(deliveryId)).toMatchObject({ status: "SKIPPED", reason: "MANUAL_OVERRIDE" });
    d = await state(deliveryId);
    expect(d.beatId).toBe(beat["5"]);
  });

  it("a delivery that is already out for delivery is never pulled back by a re-match", async () => {
    const { deliveryId } = await makeDelivery(officeId, { addressLine1: "21 Farid Nagar", area: "Farid Nagar" }, geocode("NONE"));
    await assignDeliveryToBeat(deliveryId);
    await prisma.delivery.update({ where: { id: deliveryId }, data: { status: "OUT_FOR_DELIVERY" } });
    expect(await assignDeliveryToBeat(deliveryId)).toMatchObject({ status: "SKIPPED" });
  });

  it("a matched beat with no active postman assigns the beat but raises NO_POSTMAN_ASSIGNED", async () => {
    await prisma.postmanBeatAssignment.updateMany({ where: { beatId: beat["17"] }, data: { isActive: false } });
    const { deliveryId } = await makeDelivery(officeId, { addressLine1: "3 Kokan Nagar", area: "Kokan Nagar" }, geocode("NONE"));
    expect(await assignDeliveryToBeat(deliveryId)).toMatchObject({ status: "NO_POSTMAN_ASSIGNED", beatId: beat["17"] });
    expect((await state(deliveryId)).status).toBe("SORTED");
    expect((await openExceptions(deliveryId)).map((e) => e.reason)).toEqual(["NO_POSTMAN_ASSIGNED"]);
  });

  it("re-running the match replaces a stale exception with the newest verdict (no pile-up)", async () => {
    const { deliveryId } = await makeDelivery(officeId, { addressLine1: "Some Other Lane" }, geocode("NONE"));
    await assignDeliveryToBeat(deliveryId);
    await assignDeliveryToBeat(deliveryId);
    expect(await openExceptions(deliveryId)).toHaveLength(1);
    // the address is corrected: the exception closes and the delivery is assigned
    await prisma.address.updateMany({ where: { deliveries: { some: { id: deliveryId } } }, data: { addressLine1: "4 Kokan Nagar" } });
    expect(await assignDeliveryToBeat(deliveryId)).toMatchObject({ status: "ASSIGNED" });
    expect(await openExceptions(deliveryId)).toHaveLength(0);
  });
});

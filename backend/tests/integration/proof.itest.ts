import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import fs from "node:fs";
import { prisma } from "../../src/config/prisma";
import { env } from "../../src/config/env";
import { createApp } from "../../src/app";
import { geocode, makeBeat, makeDelivery, makeOffice, makePostman, resetDatabase } from "./db";
import { assignDeliveryToBeat } from "../../src/services/assignment.service";
import { proofPhotoPath } from "../../src/services/storage/proofStorage";

/** Proof of delivery through the real HTTP API and the real database. */
const app = createApp();
const sign = (u: { id: string; role: string; officeId: string | null }) =>
  ({ Authorization: `Bearer ${jwt.sign({ sub: u.id, role: u.role, postOfficeId: u.officeId, email: `${u.id}@t.local` }, env.jwtAccessSecret, { expiresIn: "15m" })}` });

// the smallest valid JPEG header + padding: enough for the type check, which reads the bytes, not the name
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]), Buffer.from([0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]), Buffer.alloc(200, 1)]);

let officeId: string, otherOfficeId: string;
let admin: { id: string; role: string; officeId: string | null };
let outsideAdmin: typeof admin, pm: typeof admin, otherPm: typeof admin;
let deliveryId: string;

beforeEach(async () => {
  await resetDatabase();
  officeId = (await makeOffice()).id;
  otherOfficeId = (await prisma.postOffice.create({ data: { code: "ML01", name: "Mulund", addressLine: "x", city: "Mumbai", state: "MH", pincode: "400080", latitude: 19.17, longitude: 72.95 } })).id;
  const beat = await makeBeat(officeId, { number: "20", name: "Beat 20 - Farid Nagar", localities: [{ locality: "FARID NAGAR" }] });
  const p1 = await makePostman(officeId, "20", beat);
  const p2 = await makePostman(officeId, "21");
  const mkUser = async (email: string, role: "ADMIN" | "POSTMAN", office: string, postmanId?: string) =>
    ({ id: (await prisma.user.create({ data: { email, passwordHash: "x", name: email, role, postOfficeId: office, postmanId } })).id, role, officeId: office });
  admin = await mkUser("admin@t.local", "ADMIN", officeId);
  outsideAdmin = await mkUser("other-admin@t.local", "ADMIN", otherOfficeId);
  pm = await mkUser("pm@t.local", "POSTMAN", officeId, p1.id);
  otherPm = await mkUser("pm2@t.local", "POSTMAN", officeId, p2.id);
  ({ deliveryId } = await makeDelivery(officeId, { addressLine1: "21 Farid Nagar", area: "Farid Nagar" }, geocode("NONE")));
  await assignDeliveryToBeat(deliveryId);
  await prisma.delivery.update({ where: { id: deliveryId }, data: { status: "OUT_FOR_DELIVERY" } });
});
afterAll(() => prisma.$disconnect());

const setMode = (mode: "NONE" | "PHOTO") => prisma.postOffice.update({ where: { id: officeId }, data: { proofMode: mode } });
const deliver = (who = pm) => request(app).post(`/api/v1/deliveries/${deliveryId}/status`).set(sign(who)).send({ status: "DELIVERED" });
const upload = (who = pm, buf: Buffer = JPEG, name = "door.jpg") =>
  request(app).post(`/api/v1/deliveries/${deliveryId}/proof`).set(sign(who)).field("latitude", "19.1467").field("longitude", "72.9347").attach("photo", buf, name);

describe("a post office that does not require proof", () => {
  it("completes a delivery with a status change alone", async () => {
    expect((await deliver()).status).toBe(200);
  });
});

describe("a post office that requires a photo", () => {
  beforeEach(() => setMode("PHOTO"));

  it("refuses DELIVERED without the photo - the delivery stays out for delivery, and the reason says why", async () => {
    const res = await deliver();
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/photo of the delivery is required/i);
    expect(res.body.error.details).toEqual({ proofRequired: true });
    expect((await prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId } })).status).toBe("OUT_FOR_DELIVERY");
  });

  it("accepts DELIVERED once the photo is stored, and keeps the photo private", async () => {
    const up = await upload();
    expect(up.status).toBe(201);
    expect(up.body).toMatchObject({ contentType: "image/jpeg" });
    expect(up.body.storageKey).toBeUndefined(); // the key never leaves the server
    expect((await deliver()).status).toBe(200);

    const stored = await prisma.deliveryProof.findUniqueOrThrow({ where: { deliveryId } });
    expect(stored).toMatchObject({ type: "PHOTO", latitude: 19.1467, capturedById: pm.id });
    expect(fs.existsSync(proofPhotoPath(stored.storageKey))).toBe(true);
    // the upload folder is not served as static files: the photo has no public URL
    expect((await request(app).get(`/uploads/private/proof/${stored.storageKey}`)).status).toBe(404);
  });

  it("the photo can be read only by the delivery's own postman and the office's administrators", async () => {
    await upload();
    const url = `/api/v1/deliveries/${deliveryId}/proof`;
    const own = await request(app).get(url).set(sign(pm));
    expect(own.status).toBe(200);
    expect(own.headers["content-type"]).toBe("image/jpeg");
    expect(own.headers["cache-control"]).toBe("private, no-store");
    expect((await request(app).get(url).set(sign(admin))).status).toBe(200);
    expect((await request(app).get(url).set(sign(outsideAdmin))).status).toBe(404); // another post office
    expect((await request(app).get(url).set(sign(otherPm))).status).toBe(404); // another postman
    expect((await request(app).get(url)).status).toBe(401); // nobody
  });

  it("another postman, another office and an anonymous caller cannot add a photo", async () => {
    expect((await upload(otherPm)).status).toBe(404);
    expect((await upload(outsideAdmin)).status).toBe(404);
    const anon = await request(app).post(`/api/v1/deliveries/${deliveryId}/proof`).attach("photo", JPEG, "a.jpg");
    expect(anon.status).toBe(401);
    expect(await prisma.deliveryProof.count()).toBe(0);
  });

  it("refuses something that is not a photo, whatever it is called or declared to be", async () => {
    const res = await upload(pm, Buffer.from("MZ this is an executable"), "door.jpg");
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/not a supported photo/i);
    expect(await prisma.deliveryProof.count()).toBe(0);
  });

  it("a delivery that is not out for delivery cannot get a photo", async () => {
    await prisma.delivery.update({ where: { id: deliveryId }, data: { status: "ASSIGNED" } });
    expect((await upload()).status).toBe(409);
  });

  it("a second photo replaces the first and leaves no orphan file", async () => {
    await upload();
    const first = (await prisma.deliveryProof.findUniqueOrThrow({ where: { deliveryId } })).storageKey;
    await upload(pm, Buffer.concat([JPEG, Buffer.alloc(50, 2)]));
    const second = (await prisma.deliveryProof.findUniqueOrThrow({ where: { deliveryId } })).storageKey;
    expect(second).not.toBe(first);
    expect(fs.existsSync(proofPhotoPath(first))).toBe(false);
    expect(fs.existsSync(proofPhotoPath(second))).toBe(true);
  });
});

describe("the proof setting", () => {
  it("is changed by the office's administrator, audited, and refused for anyone else", async () => {
    const put = (who: typeof admin, mode: string) => request(app).put(`/api/v1/post-offices/${officeId}/proof-mode`).set(sign(who)).send({ proofMode: mode });
    expect((await put(admin, "PHOTO")).status).toBe(200);
    expect((await prisma.postOffice.findUniqueOrThrow({ where: { id: officeId } })).proofMode).toBe("PHOTO");
    expect((await prisma.auditLog.findMany({ where: { action: "PROOF_MODE_CHANGED" } })).length).toBe(1);
    expect((await put(outsideAdmin, "NONE")).status).toBe(404);
    expect((await put(pm, "NONE")).status).toBe(403);
    expect((await put(admin, "OTP")).status).toBe(422); // not implemented: not accepted
  });
});

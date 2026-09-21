import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

const prismaMock = vi.hoisted(() => ({
  user: { findUniqueOrThrow: vi.fn() },
  beat: { update: vi.fn(), findUnique: vi.fn() },
  beatImport: { findUnique: vi.fn() },
  auditLog: { create: vi.fn() },
  $queryRaw: vi.fn()
}));

vi.mock("../src/config/prisma", () => ({ prisma: prismaMock }));
vi.mock("../src/config/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }
}));
vi.mock("pino-http", () => ({ default: () => (_req: unknown, _res: unknown, next: () => void) => next() }));
const assignment = vi.hoisted(() => ({
  rematchOfficeDeliveries: vi.fn(),
  assignPostmanToBeatTx: vi.fn(),
  setBeatPostman: vi.fn()
}));
vi.mock("../src/services/assignment.service", () => assignment);

import { createApp } from "../src/app";
import { env } from "../src/config/env";

const app = createApp();
const token = (over: Record<string, unknown> = {}) =>
  jwt.sign({ sub: "admin-1", role: "ADMIN", postOfficeId: "po1", email: "a@postal.local", ...over }, env.jwtAccessSecret, { expiresIn: "15m" });
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

const beatRow = (over: Record<string, unknown> = {}) => ({
  id: "beat-1",
  postOfficeId: "po1",
  postOfficeName: "Bhandup West",
  beatNumber: "B201",
  name: "Sector 3",
  status: "ACTIVE",
  verificationStatus: "PENDING_VERIFICATION",
  verifiedAt: null,
  verifiedByName: null,
  hasTerritory: true,
  boundary: { type: "Polygon", coordinates: [] },
  ...over
});

beforeEach(() => {
  vi.clearAllMocks();
  assignment.rematchOfficeDeliveries.mockResolvedValue({ checked: 0, changed: 0 });
  prismaMock.beat.update.mockResolvedValue({});
  prismaMock.auditLog.create.mockResolvedValue({});
});

describe("POST /api/v1/beats/:id/verify", () => {
  it("verifies a beat: stores who and when, re-matches deliveries, and writes an audit entry", async () => {
    // first read: pending; after the update: verified; then the overlap query
    prismaMock.$queryRaw
      .mockResolvedValueOnce([beatRow()])
      .mockResolvedValueOnce([beatRow({ verificationStatus: "VERIFIED", verifiedAt: "2026-09-21T10:00:00Z", verifiedByName: "Admin" })])
      .mockResolvedValueOnce([]);

    const res = await request(app).post("/api/v1/beats/beat-1/verify").set(bearer(token()));

    expect(res.status).toBe(200);
    expect(res.body.verificationStatus).toBe("VERIFIED");
    expect(prismaMock.beat.update).toHaveBeenCalledWith({
      where: { id: "beat-1" },
      data: expect.objectContaining({ verificationStatus: "VERIFIED", verifiedById: "admin-1", verifiedAt: expect.any(Date) })
    });
    expect(assignment.rematchOfficeDeliveries).toHaveBeenCalledWith("po1");
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "BEAT_VERIFIED", entityType: "Beat", entityId: "beat-1", userId: "admin-1" })
    });
  });

  it("verifying an already verified beat changes nothing and adds no second audit entry", async () => {
    const verified = beatRow({ verificationStatus: "VERIFIED" });
    prismaMock.$queryRaw.mockResolvedValueOnce([verified]).mockResolvedValueOnce([verified]).mockResolvedValueOnce([]);
    const res = await request(app).post("/api/v1/beats/beat-1/verify").set(bearer(token()));
    expect(res.status).toBe(200);
    expect(prismaMock.beat.update).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it("refuses a beat that has no territory, in plain words", async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([beatRow({ hasTerritory: false, boundary: null, verificationStatus: "NEEDS_REVIEW" })]);
    const res = await request(app).post("/api/v1/beats/beat-1/verify").set(bearer(token()));
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/no territory yet/i);
    expect(prismaMock.beat.update).not.toHaveBeenCalled();
  });

  it("an administrator of another post office cannot verify it (not found)", async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([beatRow()]);
    const res = await request(app).post("/api/v1/beats/beat-1/verify").set(bearer(token({ postOfficeId: "po2" })));
    expect(res.status).toBe(404);
    expect(prismaMock.beat.update).not.toHaveBeenCalled();
  });

  it("a super administrator can verify any office's beat", async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([beatRow()]).mockResolvedValueOnce([beatRow({ verificationStatus: "VERIFIED" })]).mockResolvedValueOnce([]);
    const res = await request(app).post("/api/v1/beats/beat-1/verify").set(bearer(token({ role: "SUPER_ADMIN", postOfficeId: null })));
    expect(res.status).toBe(200);
  });

  it("a postman (403) and a caller with no token (401) cannot verify", async () => {
    expect((await request(app).post("/api/v1/beats/beat-1/verify").set(bearer(token({ role: "POSTMAN" })))).status).toBe(403);
    expect((await request(app).post("/api/v1/beats/beat-1/verify")).status).toBe(401);
    expect(prismaMock.beat.update).not.toHaveBeenCalled();
  });
});

describe("the beat-list import endpoints", () => {
  it("are back-office only", async () => {
    const postman = bearer(token({ role: "POSTMAN" }));
    expect((await request(app).post("/api/v1/beats/import").set(postman)).status).toBe(403);
    expect((await request(app).get("/api/v1/beats/import/imp-1").set(postman)).status).toBe(403);
    expect((await request(app).post("/api/v1/beats/import/imp-1/confirm").set(postman)).status).toBe(403);
    expect((await request(app).post("/api/v1/beats/import")).status).toBe(401);
  });

  it("another office's upload cannot be read, changed or confirmed (not found)", async () => {
    prismaMock.beatImport.findUnique.mockResolvedValue({ id: "imp-1", postOfficeId: "po1", status: "PREVIEW_READY" });
    const other = bearer(token({ postOfficeId: "po2" }));
    expect((await request(app).get("/api/v1/beats/import/imp-1").set(other)).status).toBe(404);
    expect((await request(app).post("/api/v1/beats/import/imp-1/confirm").set(other)).status).toBe(404);
    expect((await request(app).post("/api/v1/beats/import/imp-1/cancel").set(other)).status).toBe(404);
  });

  it("uploading a file that is not Excel or CSV is refused in plain words", async () => {
    const res = await request(app).post("/api/v1/beats/import").set(bearer(token())).attach("file", Buffer.from("hello"), "notes.txt");
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Only Excel \(\.xlsx\) and CSV \(\.csv\)/);
  });

  it("uploading nothing is refused", async () => {
    const res = await request(app).post("/api/v1/beats/import").set(bearer(token()));
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/choose a beat list/i);
  });
});

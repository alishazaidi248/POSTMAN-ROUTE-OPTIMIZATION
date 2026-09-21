import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

const prismaMock = vi.hoisted(() => ({
  user: { findUniqueOrThrow: vi.fn(), findUnique: vi.fn() },
  postman: { findUniqueOrThrow: vi.fn(), findUnique: vi.fn() },
  beat: { findUniqueOrThrow: vi.fn() },
  delivery: { findUniqueOrThrow: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  address: { findUniqueOrThrow: vi.fn() },
  notification: { updateMany: vi.fn(), findUniqueOrThrow: vi.fn(), findMany: vi.fn() },
  auditLog: { findMany: vi.fn(), count: vi.fn(), create: vi.fn() },
  postOffice: { findUniqueOrThrow: vi.fn(), findMany: vi.fn() },
  deliveryImport: { findUniqueOrThrow: vi.fn(), findMany: vi.fn() },
  refreshToken: { create: vi.fn() },
  $queryRaw: vi.fn()
}));

vi.mock("../src/config/prisma", () => ({ prisma: prismaMock }));
vi.mock("../src/config/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }
}));
vi.mock("pino-http", () => ({ default: () => (_req: unknown, _res: unknown, next: () => void) => next() }));
vi.mock("../src/services/auth.service", async (orig) => ({
  ...(await orig<typeof import("../src/services/auth.service")>()),
  verifyPassword: vi.fn().mockResolvedValue(true),
  issueRefreshToken: vi.fn().mockResolvedValue("refresh")
}));

import { createApp } from "../src/app";
import { env } from "../src/config/env";

const app = createApp();

const token = (role: "POSTMAN" | "ADMIN" | "SUPER_ADMIN", postOfficeId: string | null = "poA", sub = "user-1") =>
  jwt.sign({ sub, role, postOfficeId, email: `${role}@x` }, env.jwtAccessSecret, { expiresIn: "15m" });
const as = (t: string) => ({ Authorization: `Bearer ${t}` });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("a POSTMAN token can only reach the postman's own endpoints", () => {
  // Every one of these used to answer a postman with the whole office's data.
  const backOffice = [
    "/api/v1/deliveries",
    "/api/v1/beats",
    "/api/v1/beats/00000000-0000-0000-0000-000000000000",
    "/api/v1/postmen",
    "/api/v1/vehicles",
    "/api/v1/imports",
    "/api/v1/assignments/exceptions",
    "/api/v1/dashboard/summary",
    "/api/v1/maps/beats",
    "/api/v1/maps/deliveries",
    "/api/v1/maps/postmen",
    "/api/v1/reports/postmen",
    "/api/v1/reports/daily",
    "/api/v1/data-quality/summary",
    "/api/v1/research/density",
    "/api/v1/post-offices",
    "/api/v1/audit-logs"
  ];

  it.each(backOffice)("GET %s -> 403 for a POSTMAN (and never reaches the database)", async (path) => {
    const res = await request(app).get(path).set(as(token("POSTMAN")));
    expect(res.status).toBe(403);
    expect(prismaMock.delivery.findMany).not.toHaveBeenCalled();
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
  });

  it.each(backOffice)("GET %s -> 401 without a token", async (path) => {
    expect((await request(app).get(path)).status).toBe(401);
  });

  it("cannot create, assign or import either", async () => {
    const t = as(token("POSTMAN"));
    expect((await request(app).post("/api/v1/beats").set(t).send({})).status).toBe(403);
    expect((await request(app).post("/api/v1/postmen").set(t).send({})).status).toBe(403);
    expect((await request(app).post("/api/v1/deliveries").set(t).send({})).status).toBe(403);
    expect((await request(app).post("/api/v1/deliveries/bulk").set(t).send({})).status).toBe(403);
    expect((await request(app).post("/api/v1/imports/x/confirm").set(t)).status).toBe(403);
    expect((await request(app).post("/api/v1/beats/x/assign-postman").set(t).send({})).status).toBe(403);
  });

  it("an ADMIN is still allowed through the same routes (the lock is by role, not a blanket)", async () => {
    prismaMock.$queryRaw.mockResolvedValue([]);
    const res = await request(app).get("/api/v1/beats").set(as(token("ADMIN")));
    expect(res.status).toBe(200);
  });
});

describe("post-office isolation for an ADMIN", () => {
  it("cannot read another office's beat (404, not the data)", async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ id: "b1", postOfficeId: "poB", beatNumber: "B1", boundary: null }]);
    const res = await request(app).get("/api/v1/beats/b1").set(as(token("ADMIN", "poA")));
    expect(res.status).toBe(404);
  });

  it("can read their own office's beat, boundary included", async () => {
    const boundary = { type: "Polygon", coordinates: [[[72, 19], [73, 19], [73, 20], [72, 19]]] };
    prismaMock.$queryRaw.mockResolvedValue([{ id: "b1", postOfficeId: "poA", beatNumber: "B1", boundary }]);
    const res = await request(app).get("/api/v1/beats/b1").set(as(token("ADMIN", "poA")));
    expect(res.status).toBe(200);
    expect(res.body.boundary).toEqual(boundary);
  });

  it("cannot create a beat in another office", async () => {
    const poly = { type: "Polygon", coordinates: [[[72, 19], [73, 19], [73, 20], [72, 19]]] };
    const res = await request(app)
      .post("/api/v1/beats")
      .set(as(token("ADMIN", "poA")))
      .send({ postOfficeId: "11111111-1111-4111-8111-111111111111", beatNumber: "B9", name: "x", boundary: poly });
    expect(res.status).toBe(403);
  });

  it("cannot read another office's post-office record", async () => {
    prismaMock.postOffice.findUniqueOrThrow.mockResolvedValue({ id: "poB", name: "Other" });
    const res = await request(app).get("/api/v1/post-offices/poB").set(as(token("ADMIN", "poA")));
    expect(res.status).toBe(404);
  });

  it("the audit log is scoped to the caller's post office", async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([]);
    prismaMock.auditLog.count.mockResolvedValue(0);
    await request(app).get("/api/v1/audit-logs").set(as(token("ADMIN", "poA")));
    expect(prismaMock.auditLog.findMany.mock.calls[0][0].where).toMatchObject({ user: { postOfficeId: "poA" } });

    prismaMock.auditLog.findMany.mockClear();
    await request(app).get("/api/v1/audit-logs").set(as(token("SUPER_ADMIN", null)));
    expect(prismaMock.auditLog.findMany.mock.calls[0][0].where).not.toHaveProperty("user");
  });

  it("cannot touch a geocoding address that belongs to another office, or to no delivery at all", async () => {
    prismaMock.address.findUniqueOrThrow.mockResolvedValue({ id: "a1" });
    prismaMock.delivery.findFirst.mockResolvedValue({ postOfficeId: "poB" });
    expect((await request(app).post("/api/v1/geocoding/retry/a1").set(as(token("ADMIN", "poA")))).status).toBe(404);

    prismaMock.delivery.findFirst.mockResolvedValue(null); // orphan address
    expect((await request(app).post("/api/v1/geocoding/retry/a1").set(as(token("ADMIN", "poA")))).status).toBe(404);
    expect(
      (await request(app).post("/api/v1/geocoding/manual/a1").set(as(token("ADMIN", "poA"))).send({ latitude: 19, longitude: 72 })).status
    ).toBe(404);
  });

  it("cannot mark someone else's notification read", async () => {
    prismaMock.notification.updateMany.mockResolvedValue({ count: 0 });
    const res = await request(app).post("/api/v1/notifications/n1/read").set(as(token("ADMIN", "poA", "me")));
    expect(res.status).toBe(404);
    expect(prismaMock.notification.updateMany.mock.calls[0][0].where).toMatchObject({
      id: "n1",
      OR: [{ userId: "me" }, { userId: null }]
    });
  });
});

describe("beat polygons are validated before anything is saved", () => {
  const admin = as(token("ADMIN", "poA"));
  const base = { postOfficeId: "11111111-1111-4111-8111-111111111111", beatNumber: "B9", name: "Test" };

  it("rejects a ring that is not closed", async () => {
    const res = await request(app)
      .post("/api/v1/beats")
      .set(as(token("ADMIN", "11111111-1111-4111-8111-111111111111")))
      .send({ ...base, boundary: { type: "Polygon", coordinates: [[[72, 19], [73, 19], [73, 20], [72.5, 19.5]]] } });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toMatch(/closed/i);
  });

  it("rejects out-of-range coordinates and rings with too few points", async () => {
    const t = as(token("ADMIN", "11111111-1111-4111-8111-111111111111"));
    const bad1 = await request(app).post("/api/v1/beats").set(t).send({ ...base, boundary: { type: "Polygon", coordinates: [[[200, 19], [73, 19], [73, 20], [200, 19]]] } });
    const bad2 = await request(app).post("/api/v1/beats").set(t).send({ ...base, boundary: { type: "Polygon", coordinates: [[[72, 19], [73, 19], [72, 19]]] } });
    const bad3 = await request(app).post("/api/v1/beats").set(t).send({ ...base, boundary: { type: "Point", coordinates: [72, 19] } });
    expect([bad1.status, bad2.status, bad3.status]).toEqual([422, 422, 422]);
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
  });

  it("PUT now validates its body (an empty update, or a malformed boundary, is refused)", async () => {
    const empty = await request(app).put("/api/v1/beats/b1").set(admin).send({});
    const bad = await request(app).put("/api/v1/beats/b1").set(admin).send({ boundary: { type: "Polygon", coordinates: [] } });
    expect([empty.status, bad.status]).toEqual([422, 422]);
  });
});

describe("postman accounts", () => {
  it("login refuses a POSTMAN account that is not linked to a postman profile", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "u1", email: "p@x.com", role: "POSTMAN", status: "ACTIVE", postmanId: null, postOfficeId: "poA", name: "P", passwordHash: "h"
    });
    const res = await request(app).post("/api/v1/auth/login").send({ email: "p@x.com", password: "password123" });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/not linked to a Postman/);
  });

  it("/me/* rejects a disabled account immediately, even with an unexpired token", async () => {
    prismaMock.user.findUniqueOrThrow.mockResolvedValue({ postmanId: "pm1", status: "INACTIVE" });
    const res = await request(app).get("/api/v1/me/profile").set(as(token("POSTMAN", "poA", "u1")));
    expect(res.status).toBe(401);
  });

  it("GET /me/deliveries filters by the postman resolved on the server, whatever the request says", async () => {
    prismaMock.user.findUniqueOrThrow.mockResolvedValue({ postmanId: "pm-A", status: "ACTIVE" });
    prismaMock.postman.findUniqueOrThrow.mockResolvedValue({ id: "pm-A", postOfficeId: "poA" });
    prismaMock.delivery.count.mockResolvedValue(0);
    prismaMock.delivery.findMany.mockResolvedValue([]);

    // The caller tries every way of naming somebody else.
    const res = await request(app)
      .get("/api/v1/me/deliveries?postmanId=pm-B&assignedPostmanId=pm-B&userId=other")
      .set(as(token("POSTMAN", "poA", "u-A")))
      .set("X-Postman-Id", "pm-B");

    expect(res.status).toBe(200);
    expect(prismaMock.delivery.findMany.mock.calls[0][0].where).toEqual({ assignedPostmanId: "pm-A" });
    // The id is derived from the token's user -> User.postmanId, never from the request.
    expect(prismaMock.user.findUniqueOrThrow).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "u-A" } }));
  });
});

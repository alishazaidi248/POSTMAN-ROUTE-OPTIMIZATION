import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

const prismaMock = vi.hoisted(() => ({
  user: { findUniqueOrThrow: vi.fn() },
  postman: { findUniqueOrThrow: vi.fn() },
  delivery: { findUniqueOrThrow: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
  deliveryStatusHistory: { create: vi.fn() },
  deliveryAttempt: { create: vi.fn() },
  auditLog: { create: vi.fn() },
  routeEvent: { create: vi.fn() }
}));

const history = vi.hoisted(() => ({ listFinishedDeliveries: vi.fn() }));
const planner = vi.hoisted(() => ({ getOrPlanRoute: vi.fn(), recalculateRoute: vi.fn(), recalculateRouteForPostmanId: vi.fn() }));

vi.mock("../src/config/prisma", () => ({ prisma: prismaMock }));
vi.mock("../src/services/deliveryHistory.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/services/deliveryHistory.service")>()),
  ...history
}));
vi.mock("../src/config/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }
}));
vi.mock("pino-http", () => ({ default: () => (_req: unknown, _res: unknown, next: () => void) => next() }));
// Only the planning is faked; toPostmanRoute (what the postman is allowed to receive) is the real one.
vi.mock("../src/services/routePlanner.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/services/routePlanner.service")>()),
  ...planner
}));

import { createApp } from "../src/app";
import { env } from "../src/config/env";

const app = createApp();

const token = (over: Record<string, unknown> = {}, opts: jwt.SignOptions = { expiresIn: "15m" }) =>
  jwt.sign(
    { sub: "user-1", role: "POSTMAN", postOfficeId: "po1", email: "ramesh@postal.local", ...over },
    env.jwtAccessSecret,
    opts
  );
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

const postmanToken = () => token();
const adminToken = () => token({ sub: "admin-1", role: "ADMIN" });

function asPostman(postmanId = "pm1") {
  prismaMock.user.findUniqueOrThrow.mockResolvedValue({ postmanId, status: "ACTIVE" });
  prismaMock.postman.findUniqueOrThrow.mockResolvedValue({ id: postmanId, postOfficeId: "po1", assignedBeatId: "beat1" });
}

function delivery(status: string, over: Record<string, unknown> = {}) {
  const row = { id: "d1", status, postOfficeId: "po1", assignedPostmanId: "pm1", postOffice: { proofMode: "NONE" }, proof: null, ...over };
  prismaMock.delivery.findUniqueOrThrow.mockResolvedValue(row);
  prismaMock.delivery.update.mockImplementation(async ({ data }: { data: { status: string } }) => ({ ...row, status: data.status }));
}

beforeEach(() => {
  vi.clearAllMocks();
  asPostman();
});

describe("POST /api/v1/deliveries/:id/status  (Mark Delivered)", () => {
  it("runs auth → role → ownership → transition → history → attempt → audit → response", async () => {
    delivery("OUT_FOR_DELIVERY");

    const res = await request(app)
      .post("/api/v1/deliveries/d1/status")
      .set(bearer(postmanToken()))
      .send({ status: "DELIVERED" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: "d1", status: "DELIVERED" });
    expect(prismaMock.delivery.update).toHaveBeenCalledWith({ where: { id: "d1" }, data: { status: "DELIVERED" } });
    expect(prismaMock.deliveryStatusHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ fromStatus: "OUT_FOR_DELIVERY", toStatus: "DELIVERED", changedBy: "user-1" })
    });
    expect(prismaMock.deliveryAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ deliveryId: "d1", postmanId: "pm1", outcome: "DELIVERED" })
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "DELIVERY_STATUS_CHANGED", entityType: "Delivery", entityId: "d1" })
    });
  });

  it("rejects DELIVERED from ASSIGNED with 400 and writes nothing — the backend stays authoritative", async () => {
    delivery("ASSIGNED");

    const res = await request(app)
      .post("/api/v1/deliveries/d1/status")
      .set(bearer(postmanToken()))
      .send({ status: "DELIVERED" });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe("Invalid delivery status transition: ASSIGNED -> DELIVERED");
    expect(prismaMock.delivery.update).not.toHaveBeenCalled();
    expect(prismaMock.deliveryStatusHistory.create).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it("allows ASSIGNED -> OUT_FOR_DELIVERY (the step before Mark Delivered)", async () => {
    delivery("ASSIGNED");
    const res = await request(app)
      .post("/api/v1/deliveries/d1/status")
      .set(bearer(postmanToken()))
      .send({ status: "OUT_FOR_DELIVERY" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("OUT_FOR_DELIVERY");
  });

  it("rejects a change to an already-DELIVERED parcel (this is the conflict a queued offline update hits)", async () => {
    delivery("DELIVERED");
    const res = await request(app)
      .post("/api/v1/deliveries/d1/status")
      .set(bearer(postmanToken()))
      .send({ status: "DELIVERED" });
    expect(res.status).toBe(400);
  });

  it("hides another postman's delivery behind a 404", async () => {
    delivery("OUT_FOR_DELIVERY", { assignedPostmanId: "someone-else" });
    const res = await request(app)
      .post("/api/v1/deliveries/d1/status")
      .set(bearer(postmanToken()))
      .send({ status: "DELIVERED" });
    expect(res.status).toBe(404);
    expect(prismaMock.delivery.update).not.toHaveBeenCalled();
  });

  it("returns 401 without a token", async () => {
    const res = await request(app).post("/api/v1/deliveries/d1/status").send({ status: "DELIVERED" });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe("Missing bearer token");
  });

  it("returns 401 for an expired token", async () => {
    const expired = token({}, { expiresIn: -10 });
    const res = await request(app)
      .post("/api/v1/deliveries/d1/status")
      .set(bearer(expired))
      .send({ status: "DELIVERED" });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe("Invalid or expired access token");
  });

  it("returns 422 for a status that is not in the enum", async () => {
    const res = await request(app)
      .post("/api/v1/deliveries/d1/status")
      .set(bearer(postmanToken()))
      .send({ status: "TELEPORTED" });
    expect(res.status).toBe(422);
    expect(prismaMock.delivery.findUniqueOrThrow).not.toHaveBeenCalled();
  });
});

describe("GET /api/v1/me/route", () => {
  const routeBody = {
    routeId: "r1",
    version: 3,
    trigger: "STOPS_REMOVED",
    status: "COMPLETED",
    generatedAt: "2026-09-20T09:00:00.000Z",
    solution: {
      stops: [{ deliveryId: "d1", sequence: 1 }],
      totalDistanceMeters: 1200,
      algorithm: "DBSCAN_NN_2OPT_ALNS",
      metrics: { algorithm: "DBSCAN_NN_2OPT_ALNS", totalCost: 10, alns: { iterations: 500 } }
    }
  };

  it("returns the postman's optimized route", async () => {
    planner.getOrPlanRoute.mockResolvedValue(routeBody);

    const res = await request(app).get("/api/v1/me/route").set(bearer(postmanToken()));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      routeId: "r1",
      version: 3,
      solution: { stops: [{ deliveryId: "d1", sequence: 1 }], totalDistanceMeters: 1200 }
    });
    expect(planner.getOrPlanRoute).toHaveBeenCalledWith(
      expect.objectContaining({ id: "pm1" }),
      expect.objectContaining({ refresh: false, start: undefined })
    );
  });

  it("does not send the postman the optimizer's diagnostics or the name of the algorithm", async () => {
    planner.getOrPlanRoute.mockResolvedValue(routeBody);
    const res = await request(app).get("/api/v1/me/route").set(bearer(postmanToken()));
    expect(res.body.solution).not.toHaveProperty("metrics");
    expect(res.body.solution).not.toHaveProperty("algorithm");
    expect(JSON.stringify(res.body)).not.toMatch(/DBSCAN|ALNS|2OPT|2-opt|metrics/i);
  });

  it("returns { route: null } when there is nothing left to deliver", async () => {
    planner.getOrPlanRoute.mockResolvedValue(null);
    const res = await request(app).get("/api/v1/me/route").set(bearer(postmanToken()));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ route: null });
  });

  it("passes a start location and refresh flag to the planner", async () => {
    planner.getOrPlanRoute.mockResolvedValue(routeBody);
    await request(app)
      .get("/api/v1/me/route?startLat=19.15&startLng=72.94&refresh=true")
      .set(bearer(postmanToken()));
    expect(planner.getOrPlanRoute).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ refresh: true, start: { latitude: 19.15, longitude: 72.94 } })
    );
  });

  it("rejects half a start location and out-of-range coordinates with 422", async () => {
    const a = await request(app).get("/api/v1/me/route?startLat=19.15").set(bearer(postmanToken()));
    expect(a.status).toBe(422);
    const b = await request(app).get("/api/v1/me/route?startLat=95&startLng=72").set(bearer(postmanToken()));
    expect(b.status).toBe(422);
    expect(planner.getOrPlanRoute).not.toHaveBeenCalled();
  });

  it("is postman-only: an admin token gets 403, no token gets 401", async () => {
    expect((await request(app).get("/api/v1/me/route").set(bearer(adminToken()))).status).toBe(403);
    expect((await request(app).get("/api/v1/me/route")).status).toBe(401);
  });
});

describe("the route algorithm cannot be chosen by the client", () => {
  const optionsOf = (mock: typeof planner.getOrPlanRoute) => mock.mock.calls[0][1] as Record<string, unknown>;

  it.each(["NN_2OPT", "DBSCAN_NN_2OPT_ALNS", "GENETIC"])(
    "GET /me/route?algorithm=%s is ignored: the planner is never told about it",
    async (algorithm) => {
      planner.getOrPlanRoute.mockResolvedValue({ routeId: "r1", version: 1, solution: { stops: [], algorithm: "DBSCAN_NN_2OPT_ALNS" } });
      const res = await request(app).get(`/api/v1/me/route?algorithm=${algorithm}`).set(bearer(postmanToken()));
      expect(res.status).toBe(200);
      expect(optionsOf(planner.getOrPlanRoute)).not.toHaveProperty("algorithm");
    }
  );

  it.each(["NN_2OPT", "DBSCAN_NN_2OPT_ALNS", "X"])(
    "POST /me/route/reoptimize with algorithm=%s in the body is ignored",
    async (algorithm) => {
      planner.recalculateRoute.mockResolvedValue({ routeId: "r9", version: 2, solution: { stops: [], algorithm: "DBSCAN_NN_2OPT_ALNS", metrics: {} } });
      const res = await request(app)
        .post("/api/v1/me/route/reoptimize")
        .set(bearer(postmanToken()))
        .send({ trigger: "MANUAL", algorithm });
      expect(res.status).toBe(201);
      expect(res.body.solution).not.toHaveProperty("algorithm");
      expect(res.body.solution).not.toHaveProperty("metrics");
      expect(optionsOf(planner.recalculateRoute)).not.toHaveProperty("algorithm");
    }
  );
});

describe("POST /api/v1/me/route/reoptimize", () => {
  it("forces a recalculation from the supplied start and audits it", async () => {
    planner.recalculateRoute.mockResolvedValue({ routeId: "r2", version: 4, solution: { stops: [] } });

    const res = await request(app)
      .post("/api/v1/me/route/reoptimize")
      .set(bearer(postmanToken()))
      .send({ trigger: "MANUAL", start: { latitude: 19.15, longitude: 72.94 } });

    expect(res.status).toBe(201);
    expect(res.body.routeId).toBe("r2");
    expect(planner.recalculateRoute).toHaveBeenCalledWith(expect.objectContaining({ id: "pm1" }), {
      trigger: "MANUAL",
      start: { latitude: 19.15, longitude: 72.94 }
    });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "ROUTE_REOPTIMIZED", entityId: "r2", reason: "MANUAL" })
    });
  });

  it("no longer needs an assigned beat", async () => {
    prismaMock.postman.findUniqueOrThrow.mockResolvedValue({ id: "pm1", postOfficeId: "po1", assignedBeatId: null });
    planner.recalculateRoute.mockResolvedValue({ routeId: "r3", version: 1, solution: { stops: [] } });
    const res = await request(app)
      .post("/api/v1/me/route/reoptimize")
      .set(bearer(postmanToken()))
      .send({ trigger: "MANUAL" });
    expect(res.status).toBe(201);
  });

  it("says so when there is nothing to route", async () => {
    planner.recalculateRoute.mockResolvedValue(null);
    const res = await request(app)
      .post("/api/v1/me/route/reoptimize")
      .set(bearer(postmanToken()))
      .send({ trigger: "DELIVERY_COMPLETED" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ route: null, message: "No remaining deliveries to route" });
  });

  it("rejects an unknown trigger with 422", async () => {
    const res = await request(app)
      .post("/api/v1/me/route/reoptimize")
      .set(bearer(postmanToken()))
      .send({ trigger: "BECAUSE" });
    expect(res.status).toBe(422);
  });
});


describe("GET /api/v1/me/deliveries/history (a postman's past work)", () => {
  beforeEach(() => history.listFinishedDeliveries.mockReset());

  it("asks for the CALLER's finished deliveries, from the token, before today by default", async () => {
    history.listFinishedDeliveries.mockResolvedValue({ total: 0, summary: { delivered: 0, returned: 0 }, rows: [] });
    const res = await request(app).get("/api/v1/me/deliveries/history").set(bearer(postmanToken()));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 0, page: 1, pageSize: 30, rows: [] });
    const [postmanId, q] = history.listFinishedDeliveries.mock.calls[0];
    expect(postmanId).toBe("pm1");
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    expect(q.before.getTime()).toBe(startOfToday.getTime());
    expect(q.since).toBeUndefined();
  });

  it("passes the window, outcome and page through, and ignores a postman id sent by the client", async () => {
    history.listFinishedDeliveries.mockResolvedValue({ total: 1, summary: { delivered: 1, returned: 0 }, rows: [] });
    const before = "2026-09-21T00:00:00.000Z";
    const since = "2026-09-14T00:00:00.000Z";
    await request(app)
      .get(`/api/v1/me/deliveries/history?before=${before}&since=${since}&outcome=DELIVERED&page=2&pageSize=10&postmanId=someone-else`)
      .set(bearer(postmanToken()));
    const [postmanId, q] = history.listFinishedDeliveries.mock.calls[0];
    expect(postmanId).toBe("pm1");
    expect(q).toMatchObject({ outcome: "DELIVERED", page: 2, pageSize: 10 });
    expect(q.before.toISOString()).toBe(before);
    expect(q.since.toISOString()).toBe(since);
  });

  it.each(["outcome=FAILED", "before=yesterday", "page=0", "pageSize=101"])("rejects a bad query (%s) with 422", async (query) => {
    const res = await request(app).get(`/api/v1/me/deliveries/history?${query}`).set(bearer(postmanToken()));
    expect(res.status).toBe(422);
    expect(history.listFinishedDeliveries).not.toHaveBeenCalled();
  });

  it("is postman-only", async () => {
    expect((await request(app).get("/api/v1/me/deliveries/history").set(bearer(adminToken()))).status).toBe(403);
    expect((await request(app).get("/api/v1/me/deliveries/history")).status).toBe(401);
  });
});

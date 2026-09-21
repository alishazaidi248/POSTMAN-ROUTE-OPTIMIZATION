import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  delivery: { findMany: vi.fn() },
  postmanLocationHistory: { findFirst: vi.fn() },
  postOffice: { findUniqueOrThrow: vi.fn() }
}));

vi.mock("../src/config/prisma", () => ({ prisma: prismaMock }));
vi.mock("../src/config/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

import {
  RoadRouteOptimizationService,
  ROUTABLE_STATUSES,
  isUsableCoordinate,
  planRouteFromInputs
} from "../src/services/optimization/RoadRouteOptimizationService";
import { RoutingService, haversineMeters, setRoutingServiceForTests } from "../src/services/optimization/routing";

const START = { latitude: 19.1436, longitude: 72.9345, source: "POST_OFFICE" as const };

/** Fake OSRM: 10 m/s over the great-circle distance; route geometry = the waypoints. */
function fakeOsrm(overrides: { failRoute?: boolean; failTable?: boolean } = {}) {
  const httpGet = vi.fn(async (url: string) => {
    const pts = url
      .split("/")
      .pop()!
      .split("?")[0]
      .split(";")
      .map((c) => c.split(",").map(Number) as [number, number]);
    if (url.includes("/table/")) {
      if (overrides.failTable) throw new Error("table down");
      const d = pts.map(([lo1, la1]) =>
        pts.map(([lo2, la2]) => haversineMeters({ latitude: la1, longitude: lo1 }, { latitude: la2, longitude: lo2 }))
      );
      return { code: "Ok", distances: d, durations: d.map((r) => r.map((m) => m / 10)) };
    }
    if (overrides.failRoute) throw new Error("route down");
    return { code: "Ok", routes: [{ distance: 1, duration: 1, geometry: { type: "LineString", coordinates: pts } }] };
  });
  return new RoutingService({ baseUrl: "http://osrm.test", httpGet });
}

const delivery = (id: string, lat: number, lng: number, over: Record<string, unknown> = {}) => ({
  id,
  latitude: lat,
  longitude: lng,
  parcelCount: 1,
  weightKg: 1,
  priority: "NORMAL",
  serviceTimeMinutes: 3 as number | null,
  ...over
});

// Three stops along a line east of the start, deliberately given in far/near/mid order.
const far = delivery("far", 19.1436, 72.9645);
const near = delivery("near", 19.1436, 72.9365);
const mid = delivery("mid", 19.1436, 72.9505);

describe("planRouteFromInputs", () => {
  it("orders stops by road cost, not by input order, and numbers them 1..n", async () => {
    const sol = await planRouteFromInputs(
      { postmanId: "p", beatId: "b", start: START, deliveries: [far, near, mid] },
      fakeOsrm()
    );

    expect(sol.algorithm).toBe("DBSCAN_NN_2OPT_ALNS");
    expect(sol.stops.map((s) => s.deliveryId)).toEqual(["near", "mid", "far"]);
    expect(sol.stops.map((s) => s.sequence)).toEqual([1, 2, 3]);
  });

  it("fills per-leg distance/time, increasing ETAs, and consistent totals", async () => {
    const now = new Date("2026-09-20T08:00:00.000Z");
    const sol = await planRouteFromInputs(
      { postmanId: "p", beatId: "b", start: START, deliveries: [far, near, mid], now },
      fakeOsrm()
    );

    const legs = sol.stops.map((s) => s.distanceFromPreviousMeters ?? 0);
    expect(legs.every((m) => m > 0)).toBe(true);
    expect(sol.totalDistanceMeters).toBeGreaterThanOrEqual(legs.reduce((a, b) => a + b, 0) - sol.stops.length);
    expect(sol.totalDistanceMeters).toBeLessThanOrEqual(legs.reduce((a, b) => a + b, 0) + sol.stops.length);

    const etas = sol.stops.map((s) => new Date(s.estimatedArrival).getTime());
    expect(etas[0]).toBeGreaterThan(now.getTime());
    expect(etas[1]).toBeGreaterThan(etas[0]);
    expect(etas[2]).toBeGreaterThan(etas[1]);
    // 3 min service per stop is folded into the duration estimate.
    expect(sol.estimatedDurationMinutes).toBeGreaterThan(9);
    expect(sol.start).toEqual(START);
  });

  it("returns road geometry starting at the start point and marks the route ROAD", async () => {
    const sol = await planRouteFromInputs(
      { postmanId: "p", beatId: "b", start: START, deliveries: [far, near, mid] },
      fakeOsrm()
    );
    expect(sol.routing).toMatchObject({ mode: "ROAD", provider: "osrm", geometrySource: "ROAD", warnings: [] });
    expect(sol.geometry?.coordinates[0]).toEqual([START.longitude, START.latitude]);
    expect(sol.geometry?.coordinates).toHaveLength(4);
  });

  it("reports the cost model and that 2-opt did not make it worse", async () => {
    const sol = await planRouteFromInputs(
      { postmanId: "p", beatId: "b", start: START, deliveries: [far, near, mid] },
      fakeOsrm()
    );
    expect(sol.metrics.totalCost).toBeLessThanOrEqual(sol.metrics.dbscanNnCost);
    expect(sol.metrics.totalCost).toBeLessThanOrEqual(sol.metrics.inputOrderCost);
    expect(sol.metrics.loadWeight).toBe(0.35);
    expect(sol.metrics.priorityWeight).toBe(0.25);
  });

  it("falls back to a flagged straight-line estimate when road routing is not configured", async () => {
    const sol = await planRouteFromInputs(
      { postmanId: "p", beatId: "b", start: START, deliveries: [far, near] },
      new RoutingService({ baseUrl: "" })
    );
    expect(sol.routing?.mode).toBe("ESTIMATED");
    expect(sol.routing?.geometrySource).toBe("STRAIGHT_LINE");
    expect(sol.routing?.warnings.join(" ")).toMatch(/not configured/i);
    expect(sol.stops).toHaveLength(2);
    expect(sol.geometry?.coordinates).toHaveLength(3);
  });

  it("falls back to estimates when the matrix request fails", async () => {
    const sol = await planRouteFromInputs(
      { postmanId: "p", beatId: "b", start: START, deliveries: [far, near] },
      fakeOsrm({ failTable: true })
    );
    expect(sol.routing?.mode).toBe("ESTIMATED");
    expect(sol.routing?.warnings.join(" ")).toMatch(/unavailable/i);
    expect(sol.stops).toHaveLength(2); // still a usable route
  });

  it("keeps the matrix ROAD but flags a straight guide line when only the geometry request fails", async () => {
    const sol = await planRouteFromInputs(
      { postmanId: "p", beatId: "b", start: START, deliveries: [far, near] },
      fakeOsrm({ failRoute: true })
    );
    expect(sol.routing?.mode).toBe("ROAD");
    expect(sol.routing?.geometrySource).toBe("STRAIGHT_LINE");
    expect(sol.routing?.warnings.join(" ")).toMatch(/straight-line guide/i);
  });

  it("handles zero deliveries", async () => {
    const sol = await planRouteFromInputs(
      { postmanId: "p", beatId: "b", start: START, deliveries: [] },
      fakeOsrm()
    );
    expect(sol.stops).toEqual([]);
    expect(sol.geometry).toBeNull();
    expect(sol.totalDistanceMeters).toBe(0);
    expect(sol.routing?.geometrySource).toBe("NONE");
  });

  it("handles a single delivery", async () => {
    const sol = await planRouteFromInputs(
      { postmanId: "p", beatId: "b", start: START, deliveries: [near] },
      fakeOsrm()
    );
    expect(sol.stops).toHaveLength(1);
    expect(sol.stops[0].sequence).toBe(1);
    expect(sol.metrics.twoOptStoppedBy).toBe("NOT_RUN");
    expect(sol.geometry?.coordinates).toHaveLength(2);
  });

  it("handles duplicate coordinates", async () => {
    const sol = await planRouteFromInputs(
      {
        postmanId: "p",
        beatId: "b",
        start: START,
        deliveries: [delivery("a", 19.15, 72.94), delivery("b", 19.15, 72.94), delivery("c", 19.15, 72.94)]
      },
      fakeOsrm()
    );
    expect(sol.stops.map((s) => s.deliveryId).sort()).toEqual(["a", "b", "c"]);
    expect(sol.stops[1].distanceFromPreviousMeters).toBe(0);
  });

  it("uses the real weight (weightKg) as carried load and lets it change the order", async () => {
    // Stops N and S are the same distance from the start; only load can break the tie.
    const north = delivery("north", 19.1536, 72.9345, { weightKg: 1 });
    const south = delivery("south", 19.1336, 72.9345, { weightKg: 12 });

    const weighted = await planRouteFromInputs(
      { postmanId: "p", beatId: "b", start: START, deliveries: [north, south] },
      fakeOsrm()
    );
    expect(weighted.stops[0].deliveryId).toBe("south"); // heavy parcels leave the bag first
    expect(weighted.totalLoad).toBe(13);
    expect(weighted.stops.find((s) => s.deliveryId === "south")?.load).toBe(12);

    const unweighted = await planRouteFromInputs(
      {
        postmanId: "p",
        beatId: "b",
        start: START,
        deliveries: [south, north],
        costParams: { loadWeight: 0, priorityWeight: 0 }
      },
      fakeOsrm()
    );
    expect(unweighted.metrics.loadPenalty).toBe(0);
  });

  it("pulls an URGENT delivery ahead of an equally-distant NORMAL one", async () => {
    const normalNorth = delivery("normal", 19.1536, 72.9345);
    const urgentSouth = delivery("urgent", 19.1336, 72.9345, { priority: "URGENT" });

    const withPriority = await planRouteFromInputs(
      { postmanId: "p", beatId: "b", start: START, deliveries: [normalNorth, urgentSouth] },
      fakeOsrm()
    );
    expect(withPriority.stops[0].deliveryId).toBe("urgent");
    expect(withPriority.metrics.priorityPenalty).toBeGreaterThan(0);

    // Same stops with the priority term switched off: no reason to prefer either.
    const withoutPriority = await planRouteFromInputs(
      {
        postmanId: "p",
        beatId: "b",
        start: START,
        deliveries: [normalNorth, urgentSouth],
        costParams: { loadWeight: 0, priorityWeight: 0 }
      },
      fakeOsrm()
    );
    expect(withoutPriority.metrics.priorityPenalty).toBe(0);
  });

  it("keeps a fixed order (pruning) instead of re-optimizing", async () => {
    const sol = await planRouteFromInputs(
      { postmanId: "p", beatId: "b", start: START, deliveries: [far, near, mid], fixedOrder: ["far", "mid", "near"] },
      fakeOsrm()
    );
    expect(sol.reusedOrder).toBe(true);
    expect(sol.stops.map((s) => s.deliveryId)).toEqual(["far", "mid", "near"]);
    expect(sol.metrics.twoOptStoppedBy).toBe("NOT_RUN");
    expect(sol.metrics.reusedOrder).toBe(true);
  });

  it("re-plans from a new start without extra matrix requests for known pairs", async () => {
    const svc = fakeOsrm();
    await planRouteFromInputs({ postmanId: "p", beatId: "b", start: START, deliveries: [far, near, mid] }, svc);
    const tableCalls = () =>
      (svc as unknown as { httpGet: { mock: { calls: string[][] } } }).httpGet.mock.calls.filter((c) =>
        c[0].includes("/table/")
      ).length;
    expect(tableCalls()).toBe(1);

    // Same start, "near" delivered: all remaining pairs were cached.
    await planRouteFromInputs({ postmanId: "p", beatId: "b", start: START, deliveries: [far, mid] }, svc);
    expect(tableCalls()).toBe(1);
  });
});

describe("RoadRouteOptimizationService (loads deliveries from the database)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setRoutingServiceForTests(fakeOsrm());
    prismaMock.postmanLocationHistory.findFirst.mockResolvedValue(null);
    prismaMock.postOffice.findUniqueOrThrow.mockResolvedValue({ latitude: 19.1436, longitude: 72.9345 });
  });

  const row = (id: string, status: string, lat: number | null, lng: number | null) => ({
    id,
    status,
    parcelCount: 1,
    weightKg: 1,
    priority: "NORMAL",
    serviceTimeMinutes: null,
    address: { latitude: lat, longitude: lng }
  });

  const problem = (ids: string[], extra: Record<string, unknown> = {}) => ({
    postOfficeId: "po",
    beatId: "beat",
    postmanId: "pm",
    deliveryIds: ids,
    requestType: "ROUTE_PLAN" as const,
    ...extra
  });

  it("excludes DELIVERED, RETURNED, CANCELLED and failed-attempt deliveries from the route", async () => {
    prismaMock.delivery.findMany.mockResolvedValue([
      row("ok1", "ASSIGNED", 19.15, 72.94),
      row("ok2", "OUT_FOR_DELIVERY", 19.16, 72.95),
      row("ok3", "RESCHEDULED", 19.17, 72.96),
      row("done", "DELIVERED", 19.18, 72.97),
      row("ret", "RETURNED", 19.18, 72.97),
      row("can", "CANCELLED", 19.18, 72.97),
      row("una", "RECIPIENT_UNAVAILABLE", 19.18, 72.97)
    ]);

    const sol = await new RoadRouteOptimizationService().planRoute(
      problem(["ok1", "ok2", "ok3", "done", "ret", "can", "una"])
    );

    expect(sol.stops.map((s) => s.deliveryId).sort()).toEqual(["ok1", "ok2", "ok3"]);
    expect(sol.unroutable).toEqual(
      expect.arrayContaining([
        { deliveryId: "done", reason: "NOT_ROUTABLE_STATUS" },
        { deliveryId: "ret", reason: "NOT_ROUTABLE_STATUS" },
        { deliveryId: "can", reason: "NOT_ROUTABLE_STATUS" },
        { deliveryId: "una", reason: "NOT_ROUTABLE_STATUS" }
      ])
    );
    expect(ROUTABLE_STATUSES).toEqual(["ASSIGNED", "OUT_FOR_DELIVERY", "RESCHEDULED"]);
  });

  it("reports missing/invalid coordinates and unknown ids instead of failing", async () => {
    prismaMock.delivery.findMany.mockResolvedValue([
      row("good", "ASSIGNED", 19.15, 72.94),
      row("nocoords", "ASSIGNED", null, null),
      row("zero", "ASSIGNED", 0, 0),
      row("range", "ASSIGNED", 95, 10)
    ]);

    const sol = await new RoadRouteOptimizationService().planRoute(
      problem(["good", "nocoords", "zero", "range", "ghost"])
    );

    expect(sol.stops.map((s) => s.deliveryId)).toEqual(["good"]);
    expect(sol.unroutable).toEqual(
      expect.arrayContaining([
        { deliveryId: "nocoords", reason: "MISSING_COORDINATES" },
        { deliveryId: "zero", reason: "INVALID_COORDINATES" },
        { deliveryId: "range", reason: "INVALID_COORDINATES" },
        { deliveryId: "ghost", reason: "NOT_FOUND" }
      ])
    );
  });

  it("returns an empty route (not an error) when nothing is routable", async () => {
    prismaMock.delivery.findMany.mockResolvedValue([row("done", "DELIVERED", 19.15, 72.94)]);
    const sol = await new RoadRouteOptimizationService().planRoute(problem(["done"]));
    expect(sol.stops).toEqual([]);
    expect(sol.geometry).toBeNull();
  });

  it("starts from the supplied location first", async () => {
    prismaMock.delivery.findMany.mockResolvedValue([row("a", "ASSIGNED", 19.15, 72.94)]);
    const sol = await new RoadRouteOptimizationService().planRoute(
      problem(["a"], { start: { latitude: 19.2, longitude: 72.9 } })
    );
    expect(sol.start).toEqual({ latitude: 19.2, longitude: 72.9, source: "REQUEST" });
    expect(sol.startIgnored).toBeUndefined();
  });

  it("does not plan from a GPS fix hundreds of km from the post office: it is skipped and reported", async () => {
    prismaMock.delivery.findMany.mockResolvedValue([row("a", "ASSIGNED", 19.15, 72.94)]);
    const sol = await new RoadRouteOptimizationService().planRoute(
      problem(["a"], { start: { latitude: 28.61, longitude: 77.2 } }) // Delhi vs a Mumbai post office
    );
    expect(sol.start?.source).toBe("POST_OFFICE");
    expect(sol.startIgnored).toHaveLength(1);
    expect(sol.startIgnored?.[0]).toMatchObject({ source: "REQUEST" });
    expect(sol.startIgnored?.[0].reason).toMatch(/km from the post office/);
  });

  it("an implausible GPS fix falls through to a plausible last known location", async () => {
    prismaMock.delivery.findMany.mockResolvedValue([row("a", "ASSIGNED", 19.15, 72.94)]);
    prismaMock.postmanLocationHistory.findFirst.mockResolvedValue({ latitude: 19.21, longitude: 72.91 });
    const sol = await new RoadRouteOptimizationService().planRoute(
      problem(["a"], { start: { latitude: 28.61, longitude: 77.2 } })
    );
    expect(sol.start?.source).toBe("POSTMAN_LOCATION");
    expect(sol.startIgnored?.map((i) => i.source)).toEqual(["REQUEST"]);
  });

  it("then from the postman's latest location ping", async () => {
    prismaMock.delivery.findMany.mockResolvedValue([row("a", "ASSIGNED", 19.15, 72.94)]);
    prismaMock.postmanLocationHistory.findFirst.mockResolvedValue({ latitude: 19.21, longitude: 72.91 });
    const sol = await new RoadRouteOptimizationService().planRoute(problem(["a"]));
    expect(sol.start).toEqual({ latitude: 19.21, longitude: 72.91, source: "POSTMAN_LOCATION" });
  });

  it("and finally from the post office — never a hard-coded coordinate", async () => {
    prismaMock.delivery.findMany.mockResolvedValue([row("a", "ASSIGNED", 19.15, 72.94)]);
    prismaMock.postOffice.findUniqueOrThrow.mockResolvedValue({ latitude: 12.34, longitude: 56.78 });
    const sol = await new RoadRouteOptimizationService().planRoute(problem(["a"]));
    expect(sol.start).toEqual({ latitude: 12.34, longitude: 56.78, source: "POST_OFFICE" });
  });

  it("ignores an unusable supplied start and falls through", async () => {
    prismaMock.delivery.findMany.mockResolvedValue([row("a", "ASSIGNED", 19.15, 72.94)]);
    const sol = await new RoadRouteOptimizationService().planRoute(
      problem(["a"], { start: { latitude: 0, longitude: 0 } })
    );
    expect(sol.start?.source).toBe("POST_OFFICE");
  });
});

describe("isUsableCoordinate", () => {
  it("rejects null island, NaN and out-of-range values", () => {
    expect(isUsableCoordinate(19.1, 72.9)).toBe(true);
    expect(isUsableCoordinate(0, 0)).toBe(false);
    expect(isUsableCoordinate(Number.NaN, 72.9)).toBe(false);
    expect(isUsableCoordinate(91, 0)).toBe(false);
    expect(isUsableCoordinate(10, 181)).toBe(false);
    expect(isUsableCoordinate(null, 10)).toBe(false);
  });
});

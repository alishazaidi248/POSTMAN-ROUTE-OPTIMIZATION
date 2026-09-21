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
  planRouteFromInputs
} from "../src/services/optimization/RoadRouteOptimizationService";
import { RoutingService, haversineMeters, setRoutingServiceForTests } from "../src/services/optimization/routing";

const START = { latitude: 19.1436, longitude: 72.9345, source: "POST_OFFICE" as const };

/** Fake OSRM: 10 m/s over the great-circle distance. */
function fakeOsrm() {
  const httpGet = vi.fn(async (url: string) => {
    const pts = url
      .split("/")
      .pop()!
      .split("?")[0]
      .split(";")
      .map((c) => c.split(",").map(Number) as [number, number]);
    if (url.includes("/table/")) {
      const d = pts.map(([lo1, la1]) =>
        pts.map(([lo2, la2]) => haversineMeters({ latitude: la1, longitude: lo1 }, { latitude: la2, longitude: lo2 }))
      );
      return { code: "Ok", distances: d, durations: d.map((r) => r.map((m) => m / 10)) };
    }
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

// Two neighbourhoods ~6 km apart: NEAR is within a few hundred metres of the
// start; FAR is a tight group to the east. (10 m/s -> within-group ~30s, between ~600s.)
const N1 = delivery("n1", 19.1436, 72.9365);
const N2 = delivery("n2", 19.1446, 72.9365);
const N3 = delivery("n3", 19.1426, 72.9375);
const F1 = delivery("f1", 19.1436, 72.9945);
const F2 = delivery("f2", 19.1446, 72.9955);
const F3 = delivery("f3", 19.1426, 72.9965);
// Given deliberately interleaved.
const ALL = [F1, N1, F2, N2, F3, N3];

describe("planRouteFromInputs — DBSCAN + Nearest Neighbor + 2-opt", () => {
  it("clusters the round, visits the near neighbourhood first, and labels every stop with its cluster", async () => {
    const sol = await planRouteFromInputs(
      { postmanId: "p", beatId: "b", start: START, deliveries: ALL, dbscanEpsSeconds: 300, dbscanMinPoints: 2 },
      fakeOsrm()
    );

    expect(sol.algorithm).toBe("DBSCAN_NN_2OPT_ALNS");
    const ids = sol.stops.map((s) => s.deliveryId);
    expect(new Set(ids.slice(0, 3))).toEqual(new Set(["n1", "n2", "n3"]));
    expect(new Set(ids.slice(3))).toEqual(new Set(["f1", "f2", "f3"]));
    expect(sol.stops.map((s) => s.clusterId)).toEqual([1, 1, 1, 2, 2, 2]);
    expect(sol.stops.map((s) => s.sequence)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(sol.metrics).toMatchObject({ clusters: 2, noisePoints: 0, dbscanEpsSeconds: 300, dbscanMinPoints: 2, dbscanEpsAuto: false });
    expect(sol.metrics.totalCost).toBeLessThanOrEqual(sol.metrics.dbscanNnCost);
    expect(sol.routing?.geometrySource).toBe("ROAD");
  });

  it("puts a stop that belongs to no cluster into its own single-stop cluster instead of dropping it", async () => {
    const lone = delivery("lone", 19.2436, 73.1345); // ~20 km away
    const sol = await planRouteFromInputs(
      { postmanId: "p", beatId: "b", start: START, deliveries: [N1, N2, lone], dbscanEpsSeconds: 300, dbscanMinPoints: 2 },
      fakeOsrm()
    );
    expect(sol.stops).toHaveLength(3);
    expect(sol.metrics).toMatchObject({ clusters: 2, noisePoints: 1 }); // one dense cluster + the lone stop
    expect(sol.stops.find((s) => s.deliveryId === "lone")?.clusterId).toBe(2);
  });

  it("pruning a DBSCAN route keeps the order and renumbers the clusters that remain", async () => {
    const sol = await planRouteFromInputs(
      {
        postmanId: "p",
        beatId: "b",
        start: START,
        deliveries: [N3, F1, F2], // the near cluster's n1, n2 were delivered
        fixedOrder: ["n3", "f1", "f2"],
        fixedClusterIds: { n3: 1, f1: 2, f2: 2 }
      },
      fakeOsrm()
    );
    expect(sol.reusedOrder).toBe(true);
    expect(sol.algorithm).toBe("DBSCAN_NN_2OPT_ALNS");
    expect(sol.stops.map((s) => s.clusterId)).toEqual([1, 2, 2]);

    const nearGone = await planRouteFromInputs(
      {
        postmanId: "p",
        beatId: "b",
        start: START,
        deliveries: [F1, F2],
        fixedOrder: ["f1", "f2"],
        fixedClusterIds: { f1: 2, f2: 2 }
      },
      fakeOsrm()
    );
    expect(nearGone.stops.map((s) => s.clusterId)).toEqual([1, 1]); // the far cluster is now cluster 1
    expect(nearGone.metrics.clusters).toBe(1);
  });

  it("handles zero and one delivery", async () => {
    const zero = await planRouteFromInputs(
      { postmanId: "p", beatId: "b", start: START, deliveries: [] },
      fakeOsrm()
    );
    expect(zero.stops).toEqual([]);
    expect(zero.algorithm).toBe("DBSCAN_NN_2OPT_ALNS");

    const one = await planRouteFromInputs(
      { postmanId: "p", beatId: "b", start: START, deliveries: [N1] },
      fakeOsrm()
    );
    expect(one.stops).toHaveLength(1);
    expect(one.stops[0].clusterId).toBe(1);
  });

  it("uses the weighted cost function: a heavy parcel still leaves the bag first within its cluster", async () => {
    const north = delivery("north", 19.1536, 72.9345, { weightKg: 1 });
    const south = delivery("south", 19.1336, 72.9345, { weightKg: 12 });
    const sol = await planRouteFromInputs(
      { postmanId: "p", beatId: "b", start: START, deliveries: [north, south], dbscanEpsSeconds: 3000, dbscanMinPoints: 2 },
      fakeOsrm()
    );
    expect(sol.metrics.clusters).toBe(1); // one neighbourhood
    expect(sol.stops[0].deliveryId).toBe("south");
    expect(sol.totalLoad).toBe(13);
  });
});

describe("RoadRouteOptimizationService — one strategy, no client control", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setRoutingServiceForTests(fakeOsrm());
    prismaMock.postmanLocationHistory.findFirst.mockResolvedValue(null);
    prismaMock.postOffice.findUniqueOrThrow.mockResolvedValue({ latitude: START.latitude, longitude: START.longitude });
    prismaMock.delivery.findMany.mockResolvedValue(
      ALL.map((d) => ({
        id: d.id,
        status: "ASSIGNED",
        parcelCount: 1,
        weightKg: 1,
        priority: "NORMAL",
        serviceTimeMinutes: null,
        address: { latitude: d.latitude, longitude: d.longitude }
      }))
    );
  });

  const problem = (extra: Record<string, unknown> = {}) => ({
    postOfficeId: "po",
    beatId: "beat",
    postmanId: "pm",
    deliveryIds: ALL.map((d) => d.id),
    requestType: "ROUTE_PLAN" as const,
    ...extra
  });

  it("always runs DBSCAN_NN_2OPT_ALNS", async () => {
    const sol = await new RoadRouteOptimizationService().planRoute(problem());
    expect(sol.algorithm).toBe("DBSCAN_NN_2OPT_ALNS");
    expect(sol.metrics.algorithm).toBe("DBSCAN_NN_2OPT_ALNS");
    expect(sol.metrics.clusters).toBe(2);
  });

  it.each(["NN_2OPT", "MOCK_SEQUENTIAL", "anything"])(
    "ignores an `algorithm` smuggled into the problem (%s)",
    async (algorithm) => {
      const sol = await new RoadRouteOptimizationService().planRoute(problem({ algorithm, parameters: { algorithm } }));
      expect(sol.algorithm).toBe("DBSCAN_NN_2OPT_ALNS");
      expect(sol.stops.every((s) => s.clusterId !== undefined)).toBe(true);
    }
  );

  it("derives eps from the road travel times when none is configured, and reports that it did", async () => {
    const sol = await new RoadRouteOptimizationService().planRoute(problem());
    expect(sol.metrics.dbscanEpsAuto).toBe(true);
    expect(sol.metrics.dbscanEpsSeconds).toBeGreaterThan(0);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  delivery: { findMany: vi.fn() },
  postmanLocationHistory: { findFirst: vi.fn() },
  postOffice: { findUniqueOrThrow: vi.fn() }
}));
vi.mock("../src/config/prisma", () => ({ prisma: prismaMock }));
vi.mock("../src/config/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { RoadRouteOptimizationService, planRouteFromInputs, stopWeights } from "../src/services/optimization/RoadRouteOptimizationService";
import { RoutingService, haversineMeters, setRoutingServiceForTests } from "../src/services/optimization/routing";

const START = { latitude: 19.1436, longitude: 72.9345, source: "POST_OFFICE" as const };

function fakeOsrm() {
  const httpGet = vi.fn(async (url: string) => {
    const pts = url.split("/").pop()!.split("?")[0].split(";").map((c) => c.split(",").map(Number) as [number, number]);
    if (url.includes("/table/")) {
      const d = pts.map(([lo1, la1]) => pts.map(([lo2, la2]) => haversineMeters({ latitude: la1, longitude: lo1 }, { latitude: la2, longitude: lo2 })));
      return { code: "Ok", distances: d, durations: d.map((r) => r.map((m) => m / 10)) };
    }
    return { code: "Ok", routes: [{ distance: 1, duration: 1, geometry: { type: "LineString", coordinates: pts } }] };
  });
  return new RoutingService({ baseUrl: "http://osrm.test", httpGet });
}

const d = (id: string, lat: number, lng: number, over: Record<string, unknown> = {}) => ({
  id, latitude: lat, longitude: lng, parcelCount: 1, priority: "NORMAL", serviceTimeMinutes: 3 as number | null, ...over
});

describe("load is made of real weights, never of a parcel count", () => {
  it("stopWeights: no weights -> the load term is off; all weights -> used as given; some -> the median fills the rest", () => {
    expect(stopWeights([{ weightKg: null }, {}, { weightKg: 0 }])).toEqual({ loads: [0, 0, 0], basis: "NONE" });
    expect(stopWeights([{ weightKg: 2 }, { weightKg: 5 }])).toEqual({ loads: [2, 5], basis: "WEIGHT_KG" });
    expect(stopWeights([{ weightKg: 2 }, { weightKg: null }, { weightKg: 6 }, { weightKg: 4 }])).toEqual({ loads: [2, 4, 6, 4], basis: "PARTIAL_WEIGHT_KG" });
  });

  it("a route whose deliveries have many parcels but no weights carries NO load penalty", async () => {
    const sol = await planRouteFromInputs(
      { postmanId: "p", beatId: "b", start: START, deliveries: [d("a", 19.15, 72.94, { parcelCount: 40 }), d("b", 19.14, 72.95, { parcelCount: 1 })] },
      fakeOsrm()
    );
    expect(sol.metrics.loadBasis).toBe("NONE");
    expect(sol.metrics.loadWeight).toBe(0);
    expect(sol.metrics.loadPenalty).toBe(0);
  });

  it("with real weights the load term is live and a heavy parcel leaves the bag first (same geometry, weights differ)", async () => {
    const north = (w: number) => d("north", 19.1536, 72.9345, { weightKg: w });
    const south = (w: number) => d("south", 19.1336, 72.9345, { weightKg: w });
    const heavySouth = await planRouteFromInputs({ postmanId: "p", beatId: "b", start: START, deliveries: [north(1), south(30)] }, fakeOsrm());
    const heavyNorth = await planRouteFromInputs({ postmanId: "p", beatId: "b", start: START, deliveries: [north(30), south(1)] }, fakeOsrm());
    expect(heavySouth.metrics.loadBasis).toBe("WEIGHT_KG");
    expect(heavySouth.metrics.loadPenalty).toBeGreaterThan(0);
    expect(heavySouth.stops[0].deliveryId).toBe("south");
    expect(heavyNorth.stops[0].deliveryId).toBe("north");
  });
});

describe("priority is part of the cost that is optimised", () => {
  it("an URGENT stop is visited earlier than distance alone would, and priorityPenalty is non-zero and counted in totalCost", async () => {
    // a normal stop 110 s west, an URGENT one 315 s east, no weights
    const west = d("west", 19.1436, 72.9235);
    const eastNormal = d("east", 19.1436, 72.9645);
    const eastUrgent = { ...eastNormal, priority: "URGENT" };
    const plain = await planRouteFromInputs({ postmanId: "p", beatId: "b", start: START, deliveries: [west, eastNormal] }, fakeOsrm());
    const urgent = await planRouteFromInputs({ postmanId: "p", beatId: "b", start: START, deliveries: [west, eastUrgent] }, fakeOsrm());
    expect(plain.stops[0].deliveryId).toBe("west");
    expect(urgent.stops[0].deliveryId).toBe("east");
    expect(urgent.metrics.priorityPenalty).toBeGreaterThan(0);
    expect(urgent.metrics.totalCost).toBeCloseTo(urgent.metrics.travelCost + urgent.metrics.loadPenalty + urgent.metrics.priorityPenalty, 1);
    expect(plain.metrics.priorityPenalty).toBe(0);
  });
});

describe("a pincode-level location is not a place to drive to", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setRoutingServiceForTests(fakeOsrm());
    prismaMock.postOffice.findUniqueOrThrow.mockResolvedValue({ latitude: 19.1436, longitude: 72.9345 });
    prismaMock.postmanLocationHistory.findFirst.mockResolvedValue(null);
  });

  it("is left out of the route and reported as IMPRECISE_LOCATION; area / street / house-level stops are routed", async () => {
    const row = (id: string, precision: string | null, lat: number) => ({
      id, status: "ASSIGNED", parcelCount: 1, weightKg: null, priority: "NORMAL", serviceTimeMinutes: 3,
      address: { latitude: lat, longitude: 72.94, geocodingPrecision: precision }
    });
    prismaMock.delivery.findMany.mockResolvedValue([row("house", "HOUSE", 19.15), row("area", "AREA", 19.151), row("pin", "PINCODE", 19.152)]);
    const sol = await new RoadRouteOptimizationService().planRoute({ postmanId: "p", beatId: "b", postOfficeId: "po", deliveryIds: ["house", "area", "pin"] } as never);
    expect(sol.stops.map((s) => s.deliveryId).sort()).toEqual(["area", "house"]);
    expect(sol.unroutable).toEqual([{ deliveryId: "pin", reason: "IMPRECISE_LOCATION" }]);
  });
});

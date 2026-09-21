/**
 * Proof that a route is really produced by DBSCAN -> Nearest Neighbor -> 2-opt over the ROAD
 * travel-time matrix and the documented cost function - not by lat/lng geometry, not by the
 * order the deliveries arrived in, and never by an algorithm the caller picked.
 *
 * Each test drives planRouteFromInputs() with a fake routing engine whose travel times we
 * control, then checks the result against the cost function re-implemented independently here.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/config/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));
vi.mock("../src/config/prisma", () => ({ prisma: {} }));

import { clusterStops } from "../src/services/optimization/clustering";
import { RouteMetrics } from "../src/services/optimization/OptimizationService";
import {
  PlanInput,
  RoutableDelivery,
  planRouteFromInputs
} from "../src/services/optimization/RoadRouteOptimizationService";
import { RoutingService, haversineMeters } from "../src/services/optimization/routing";

type Pt = { latitude: number; longitude: number };
type Travel = (a: Pt, b: Pt) => number;

const PLAIN = { loadWeight: 0, priorityWeight: 0 };
const DEFAULTS = { loadWeight: 0.35, priorityWeight: 0.25 };
const PRIORITY_FACTOR: Record<string, number> = { LOW: 0, NORMAL: 0, HIGH: 1, URGENT: 3 };

/** Straight-line seconds at 10 m/s. */
const crowFlies: Travel = (a, b) => haversineMeters(a, b) / 10;

/**
 * A fake OSRM /table + /route driven by `travel` (seconds). Like the real one it honours the
 * `sources` / `destinations` parameters, and it counts what it was asked.
 */
function fakeEngine(travel: Travel, maxTablePoints?: number) {
  const tableUrls: string[] = [];
  const httpGet = vi.fn(async (url: string) => {
    const [path, query = ""] = url.split("/").pop()!.split("?");
    const pts: Pt[] = path.split(";").map((c) => {
      const [lng, lat] = c.split(",").map(Number);
      return { latitude: lat, longitude: lng };
    });
    if (url.includes("/table/")) {
      tableUrls.push(url);
      const params = new URLSearchParams(query);
      const idx = (name: string) =>
        params.get(name) ? params.get(name)!.split(";").map(Number) : pts.map((_, i) => i);
      const src = idx("sources");
      const dst = idx("destinations");
      const durations = src.map((i) => dst.map((j) => (i === j ? 0 : travel(pts[i], pts[j]))));
      return { code: "Ok", durations, distances: durations.map((r) => r.map((t) => t * 10)) };
    }
    return {
      code: "Ok",
      routes: [
        {
          distance: 1,
          duration: 1,
          geometry: { type: "LineString", coordinates: pts.map((p) => [p.longitude, p.latitude]) }
        }
      ]
    };
  });
  return { routing: new RoutingService({ baseUrl: "http://osrm.test", httpGet, maxTablePoints }), tableUrls };
}

const START = { latitude: 19.1436, longitude: 72.9345, source: "POST_OFFICE" as const };

const delivery = (id: string, latitude: number, longitude: number, over: Partial<RoutableDelivery> = {}): RoutableDelivery => ({
  id,
  latitude,
  longitude,
  parcelCount: 1,
  priority: "NORMAL",
  serviceTimeMinutes: 0,
  ...over
});

/** Independent re-implementation of the documented cost: travel + load + priority. */
function referenceCost(
  order: RoutableDelivery[],
  start: Pt,
  travel: Travel,
  params: { loadWeight: number; priorityWeight: number }
) {
  const totalLoad = order.reduce((s, d) => s + d.parcelCount, 0);
  let remaining = totalLoad;
  let prev: Pt = start;
  let clock = 0;
  let travelSum = 0;
  let load = 0;
  let priority = 0;
  for (const d of order) {
    const t = travel(prev, d);
    travelSum += t;
    load += params.loadWeight * t * (remaining / totalLoad);
    clock += t;
    priority += params.priorityWeight * (PRIORITY_FACTOR[d.priority] ?? 0) * clock;
    clock += (d.serviceTimeMinutes ?? 0) * 60;
    remaining -= d.parcelCount;
    prev = d;
  }
  return { travel: travelSum, load, priority, total: travelSum + load + priority };
}

const plan = (deliveries: RoutableDelivery[], travel: Travel, extra: Partial<PlanInput> = {}) => {
  const engine = fakeEngine(travel);
  return planRouteFromInputs(
    { postmanId: "p", beatId: "b", start: START, deliveries, ...extra },
    engine.routing
  ).then((solution) => ({ solution, ...engine }));
};

const byId = (all: RoutableDelivery[]) => new Map(all.map((d) => [d.id, d]));
const orderOf = (solution: { stops: { deliveryId: string }[] }, all: RoutableDelivery[]) => {
  const map = byId(all);
  return solution.stops.map((s) => map.get(s.deliveryId)!);
};

describe("the route is DBSCAN -> NN -> 2-opt on the road time matrix", () => {
  // A river runs at longitude 72.98. There is one bridge, so crossing costs +900 s (both ways).
  const RIVER = 72.98;
  const acrossRiver = (a: Pt, b: Pt) => (a.longitude < RIVER) !== (b.longitude < RIVER);
  const withBridge: Travel = (a, b) => crowFlies(a, b) + (acrossRiver(a, b) ? 900 : 0);

  // Four stops all within ~400 m of each other as the crow flies - two on each bank.
  const W1 = delivery("w1", 19.1436, 72.9790);
  const W2 = delivery("w2", 19.1440, 72.9791);
  const E1 = delivery("e1", 19.1436, 72.9810);
  const E2 = delivery("e2", 19.1440, 72.9811);
  const four = [E1, W1, E2, W2];

  it("clusters by road travel time, not by coordinates: stops 200 m apart across the river are different clusters", async () => {
    const { solution } = await plan(four, withBridge, { dbscanEpsSeconds: 300, dbscanMinPoints: 2, costParams: PLAIN });

    // A lat/lng-based DBSCAN would see one tight blob...
    const crow = [START, ...four].map((a) => [START, ...four].map((b) => crowFlies(a, b)));
    expect(clusterStops(crow, 4, 300, 2).densityClusters).toBe(1);

    // ...the road-time one sees two banks.
    expect(solution.metrics.clusters).toBe(2);
    const ids = solution.stops.map((s) => s.deliveryId);
    const firstBank = new Set(ids.slice(0, 2));
    expect([new Set(["w1", "w2"]), new Set(["e1", "e2"])].some((bank) => [...bank].every((id) => firstBank.has(id)))).toBe(
      true
    );
    expect(solution.stops.map((s) => s.clusterId)).toEqual([1, 1, 2, 2]);
  });

  it("crosses the river exactly once (the road cost, not the straight line, drives the order)", async () => {
    const { solution } = await plan(four, withBridge, { dbscanEpsSeconds: 300, costParams: PLAIN });
    const banks = solution.stops.map((s) => (s.longitude < RIVER ? "W" : "E"));
    const crossings = banks.slice(1).filter((b, i) => b !== banks[i]).length;
    expect(crossings).toBe(1);
  });

  it("the reported cost equals the documented cost function evaluated independently", async () => {
    for (const params of [PLAIN, DEFAULTS]) {
      const stops = [
        delivery("a", 19.15, 72.93, { parcelCount: 4 }),
        delivery("b", 19.16, 72.95, { priority: "URGENT" }),
        delivery("c", 19.14, 72.96, { parcelCount: 2, serviceTimeMinutes: 5 }),
        delivery("d", 19.17, 72.92, { priority: "HIGH", parcelCount: 3 }),
        delivery("e", 19.13, 72.94)
      ];
      const { solution } = await plan(stops, crowFlies, { costParams: params });
      const ref = referenceCost(orderOf(solution, stops), START, crowFlies, params);
      const m = solution.metrics;

      expect(m.travelCost).toBeCloseTo(ref.travel, 0);
      expect(m.loadPenalty).toBeCloseTo(ref.load, 0);
      expect(m.priorityPenalty).toBeCloseTo(ref.priority, 0);
      expect(m.totalCost).toBeCloseTo(ref.total, 0);
      expect(m.totalCost).toBeCloseTo(m.travelCost + m.loadPenalty + m.priorityPenalty, 1);
      // Metrics agree with the legs the postman is shown.
      expect(m.totalTravelSeconds).toBeCloseTo(
        solution.stops.reduce((s, x) => s + (x.travelTimeFromPreviousSeconds ?? 0), 0),
        -1
      );
      expect(m.algorithm).toBe("DBSCAN_NN_2OPT_ALNS");
    }
  });

  it("is not the input order: a scrambled input is cheaper after optimization, and the metric says by how much", async () => {
    const line = [
      delivery("far", 19.1436, 72.9645),
      delivery("near", 19.1436, 72.9365),
      delivery("farther", 19.1436, 72.9745),
      delivery("mid", 19.1436, 72.9505)
    ];
    const { solution } = await plan(line, crowFlies, { costParams: PLAIN });
    const m = solution.metrics;

    expect(solution.stops.map((s) => s.deliveryId)).toEqual(["near", "mid", "far", "farther"]);
    expect(m.inputOrderCost).toBeGreaterThan(m.totalCost);
    expect(m.improvementOverInputPercent).toBeGreaterThan(0);
    expect(m.inputOrderCost).toBeCloseTo(referenceCost(line, START, crowFlies, PLAIN).total, 0);
  });

  it("2-opt strictly improves a Nearest Neighbor route and the metrics record both costs", async () => {
    // Planar layout (1 unit = 1 s) where NN is known to leave a detour that 2-opt removes:
    //   start (0,0); A(3,0) B(10,2) C(8,0) D(4,0) E(3,1)  ->  NN 13.34, after 2-opt 11.99
    const at = (x: number, y: number): Pt => ({ latitude: 19 + y * 1e-4, longitude: 72 + x * 1e-4 });
    // Rounded so the two equal legs (A->D and A->E are both 1) tie exactly, as they do on paper.
    const planar: Travel = (a, b) => Math.round(Math.hypot(a.latitude - b.latitude, a.longitude - b.longitude) * 1e10) / 1e6;
    const start = { ...at(0, 0), source: "POST_OFFICE" as const };
    const stops = [
      delivery("A", at(3, 0).latitude, at(3, 0).longitude),
      delivery("B", at(10, 2).latitude, at(10, 2).longitude),
      delivery("C", at(8, 0).latitude, at(8, 0).longitude),
      delivery("D", at(4, 0).latitude, at(4, 0).longitude),
      delivery("E", at(3, 1).latitude, at(3, 1).longitude)
    ];
    const { solution } = await plan(stops, planar, { start, dbscanEpsSeconds: 1000, costParams: PLAIN });
    const m = solution.metrics;

    expect(m.clusters).toBe(1);
    expect(m.dbscanNnCost).toBeCloseTo(13.34, 1);
    expect(m.totalCost).toBeCloseTo(11.99, 1);
    expect(m.totalCost).toBeLessThan(m.dbscanNnCost);
    expect(m.twoOptImprovements).toBeGreaterThan(0);
    expect(m.improvementFrom2OptPercent).toBeGreaterThan(5);
    expect(m.twoOptStoppedBy).toBe("CONVERGED");
    expect(m.twoOptReverted).toBe(false);
  });

  it("priority and parcel load change the route; distance alone does not decide it", async () => {
    // A normal stop lies west (about 110 s away), an URGENT one east (about 315 s away): visiting
    // the normal one first is shorter, but keeps the urgent parcel waiting.
    const stops = [
      delivery("near-normal", 19.1436, 72.9245),
      delivery("far-urgent", 19.1436, 72.9645, { priority: "URGENT" })
    ];
    const distanceOnly = await plan(stops, crowFlies, { costParams: PLAIN });
    const weighted = await plan(stops, crowFlies, { costParams: { loadWeight: 0, priorityWeight: 5 } });

    expect(distanceOnly.solution.stops.map((s) => s.deliveryId)).toEqual(["near-normal", "far-urgent"]);
    expect(weighted.solution.stops.map((s) => s.deliveryId)).toEqual(["far-urgent", "near-normal"]);
    expect(weighted.solution.metrics.priorityPenalty).toBeGreaterThan(0);

    const heavy = [delivery("north", 19.1536, 72.9345, { parcelCount: 1 }), delivery("south", 19.1336, 72.9345, { parcelCount: 12 })];
    const flat = await plan(heavy, crowFlies, { costParams: PLAIN });
    const loaded = await plan(heavy, crowFlies, { costParams: DEFAULTS });
    expect(loaded.solution.stops[0].deliveryId).toBe("south"); // heavy parcels leave the bag first
    expect(flat.solution.metrics.loadPenalty).toBe(0);
    expect(loaded.solution.metrics.loadPenalty).toBeGreaterThan(0);
  });

  it("service (dwell) time is part of the arrival times: ETAs advance by travel + service", async () => {
    const stops = [delivery("a", 19.15, 72.94, { serviceTimeMinutes: 10 }), delivery("b", 19.16, 72.95, { serviceTimeMinutes: 2 })];
    const now = new Date("2026-09-20T08:00:00.000Z");
    const { solution } = await plan(stops, crowFlies, { now, costParams: PLAIN });
    const [first, second] = solution.stops;
    const gap = (new Date(second.estimatedArrival).getTime() - new Date(first.estimatedArrival).getTime()) / 1000;
    expect(gap).toBeCloseTo((first.serviceTimeMinutes ?? 0) * 60 + (second.travelTimeFromPreviousSeconds ?? 0), 0);
    expect(solution.metrics.serviceSeconds).toBe(12 * 60);
  });

  it("holds on random rounds: valid permutation, contiguous clusters, 2-opt never worse, cost matches the reference", async () => {
    let seed = 42;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;

    for (let trial = 0; trial < 40; trial++) {
      const n = 1 + Math.floor(rnd() * 25);
      const stops = Array.from({ length: n }, (_, i) =>
        delivery(`s${i}`, 19.1 + rnd() * 0.08, 72.9 + rnd() * 0.08, {
          parcelCount: 1 + Math.floor(rnd() * 6),
          priority: ["LOW", "NORMAL", "NORMAL", "HIGH", "URGENT"][Math.floor(rnd() * 5)],
          serviceTimeMinutes: Math.floor(rnd() * 6)
        })
      );
      const params = trial % 2 ? DEFAULTS : PLAIN;
      const { solution } = await plan(stops, crowFlies, { costParams: params });
      const m: RouteMetrics = solution.metrics;

      expect([...solution.stops.map((s) => s.deliveryId)].sort()).toEqual(stops.map((s) => s.id).sort());
      expect(solution.stops.map((s) => s.sequence)).toEqual(stops.map((_, i) => i + 1));
      expect(m.totalCost).toBeLessThanOrEqual(m.dbscanNnCost + 1e-6);
      expect(m.twoOptReverted).toBe(false);

      // every cluster is one unbroken run
      const seen = new Set<number>();
      let prev = -1;
      for (const s of solution.stops) {
        if (s.clusterId !== prev) {
          expect(seen.has(s.clusterId as number)).toBe(false);
          seen.add(s.clusterId as number);
          prev = s.clusterId as number;
        }
      }
      const ref = referenceCost(orderOf(solution, stops), START, crowFlies, params);
      expect(Math.abs(m.totalCost - ref.total)).toBeLessThan(Math.max(2, ref.total * 1e-3));
    }
  });
});

describe("OSRM matrix and caching", () => {
  const stops = [
    delivery("a", 19.15, 72.94),
    delivery("b", 19.16, 72.95),
    delivery("c", 19.14, 72.96),
    delivery("d", 19.17, 72.92),
    delivery("e", 19.13, 72.94),
    delivery("f", 19.12, 72.97)
  ];

  it("asks the routing engine for one /table covering the START and every stop", async () => {
    const { solution, tableUrls } = await plan(stops, crowFlies);
    expect(solution.routing?.mode).toBe("ROAD");
    expect(tableUrls).toHaveLength(1);
    // 1 start + 6 stops = 7 coordinates in the request, and the start is the first one
    const coords = tableUrls[0].split("/").pop()!.split("?")[0].split(";");
    expect(coords).toHaveLength(7);
    expect(coords[0]).toBe(`${START.longitude},${START.latitude}`);
    expect(solution.metrics.osrmMatrixRequests).toBe(1);
  });

  it("does not call the routing engine again for pairs it already knows", async () => {
    const engine = fakeEngine(crowFlies);
    const input = { postmanId: "p", beatId: "b", start: START, deliveries: stops };
    const first = await planRouteFromInputs(input, engine.routing);
    const second = await planRouteFromInputs(input, engine.routing);

    expect(first.metrics.osrmMatrixRequests).toBe(1);
    expect(second.metrics.osrmMatrixRequests).toBe(0);
    expect(engine.tableUrls).toHaveLength(1);
    expect(second.stops.map((s) => s.deliveryId)).toEqual(first.stops.map((s) => s.deliveryId));
  });

  it("a moved start point only costs its own row and column, and gives the same answer as a full matrix", async () => {
    const engine = fakeEngine(crowFlies);
    await planRouteFromInputs({ postmanId: "p", beatId: "b", start: START, deliveries: stops }, engine.routing);
    engine.tableUrls.length = 0;

    const gps = { latitude: 19.152, longitude: 72.941, source: "REQUEST" as const };
    const moved = await planRouteFromInputs({ postmanId: "p", beatId: "b", start: gps, deliveries: stops }, engine.routing);

    expect(engine.tableUrls).toHaveLength(2); // one row (sources=0) and one column (destinations=0)
    expect(engine.tableUrls.some((u) => u.includes("sources=0"))).toBe(true);
    expect(engine.tableUrls.some((u) => u.includes("destinations=0"))).toBe(true);
    expect(moved.metrics.osrmMatrixRequests).toBe(2);

    const fresh = await planRouteFromInputs(
      { postmanId: "p", beatId: "b", start: gps, deliveries: stops },
      fakeEngine(crowFlies).routing
    );
    expect(moved.stops.map((s) => s.deliveryId)).toEqual(fresh.stops.map((s) => s.deliveryId));
    expect(moved.metrics.totalCost).toBeCloseTo(fresh.metrics.totalCost, 6);
  });

  it("when the engine is down the route is still produced, flagged ESTIMATED, and measured the same way", async () => {
    const down = new RoutingService({
      baseUrl: "http://osrm.test",
      httpGet: vi.fn(async () => {
        throw new Error("connect ECONNREFUSED");
      })
    });
    const solution = await planRouteFromInputs({ postmanId: "p", beatId: "b", start: START, deliveries: stops }, down);
    expect(solution.routing?.mode).toBe("ESTIMATED");
    expect(solution.routing?.geometrySource).toBe("STRAIGHT_LINE");
    expect(solution.metrics.matrixMode).toBe("ESTIMATED");
    expect(solution.metrics.osrmMatrixRequests).toBe(0);
    expect(solution.stops).toHaveLength(6);
    expect(solution.algorithm).toBe("DBSCAN_NN_2OPT_ALNS");
  });

  it("2-opt is bounded: it reports how long it ran and why it stopped", async () => {
    const many = Array.from({ length: 30 }, (_, i) => delivery(`m${i}`, 19.1 + ((i * 37) % 30) * 0.002, 72.9 + ((i * 53) % 30) * 0.002));
    const { solution } = await plan(many, crowFlies, { maxMillis: 1500, maxPasses: 500 });
    const m = solution.metrics;
    expect(m.optimizationMs).toBeLessThan(1500 + 250);
    expect(["CONVERGED", "MAX_PASSES", "TIME_LIMIT"]).toContain(m.twoOptStoppedBy);
    expect(m.twoOptPasses).toBeGreaterThanOrEqual(1);
  });
});

describe("rounds bigger than the routing engine's request limit", () => {
  it("are cut into blocks that each fit the limit, and still give real road times for every pair", async () => {
    const points = Array.from({ length: 13 }, (_, i) => ({ latitude: 19.1 + i * 0.003, longitude: 72.9 + ((i * 7) % 5) * 0.004 }));
    const { routing, tableUrls } = fakeEngine(crowFlies, 6);
    const matrix = await routing.getMatrix(points);

    expect(matrix.mode).toBe("ROAD");
    expect(matrix.warnings).toEqual([]);
    expect(tableUrls.length).toBeGreaterThan(1);
    expect(matrix.requests).toBe(tableUrls.length);
    // no single request carries more coordinates than the limit
    for (const url of tableUrls) expect(url.split("/").pop()!.split("?")[0].split(";").length).toBeLessThanOrEqual(6);
    for (let i = 0; i < points.length; i++) {
      for (let j = 0; j < points.length; j++) {
        expect(matrix.durations[i][j]).toBeCloseTo(i === j ? 0 : crowFlies(points[i], points[j]), 6);
      }
    }
  });
});

describe("unroutable, empty and single-stop rounds", () => {
  it("a single stop is a one-stop cluster with 2-opt not needed", async () => {
    const { solution } = await plan([delivery("only", 19.15, 72.94)], crowFlies);
    expect(solution.stops).toHaveLength(1);
    expect(solution.stops[0].clusterId).toBe(1);
    expect(solution.metrics.clusters).toBe(1);
    expect(solution.metrics.twoOptStoppedBy).toBe("NOT_RUN");
  });

  it("no stops: an empty route with zeroed metrics, not an error", async () => {
    const { solution } = await plan([], crowFlies);
    expect(solution.stops).toEqual([]);
    expect(solution.metrics).toMatchObject({ stops: 0, totalCost: 0, algorithm: "DBSCAN_NN_2OPT_ALNS" });
  });

  it("unroutable deliveries handed in are returned with their reason, alongside the route", async () => {
    const { solution } = await plan([delivery("ok", 19.15, 72.94)], crowFlies, {
      unroutable: [{ deliveryId: "nowhere", reason: "MISSING_COORDINATES" }]
    });
    expect(solution.unroutable).toEqual([{ deliveryId: "nowhere", reason: "MISSING_COORDINATES" }]);
    expect(solution.stops.map((s) => s.deliveryId)).toEqual(["ok"]);
  });
});

describe("large round", () => {
  it("plans 120 stops within the time budget and never worse than its Nearest Neighbor start", async () => {
    let seed = 5;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const many = Array.from({ length: 120 }, (_, i) => delivery(`L${i}`, 19.05 + rnd() * 0.15, 72.85 + rnd() * 0.15, { serviceTimeMinutes: 2 }));
    const t0 = Date.now();
    const { solution } = await plan(many, crowFlies, { maxMillis: 1500 });
    expect(Date.now() - t0).toBeLessThan(6000);
    expect(solution.stops).toHaveLength(120);
    expect(solution.metrics.totalCost).toBeLessThanOrEqual(solution.metrics.dbscanNnCost + 1e-6);
    expect(solution.metrics.totalCost).toBeLessThan(solution.metrics.inputOrderCost);
  });
});

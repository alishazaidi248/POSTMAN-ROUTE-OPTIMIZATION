import { describe, expect, it } from "vitest";
import {
  CostParams,
  StopLoad,
  evaluateRoute,
  nearestNeighborRoute,
  twoOpt
} from "../src/services/optimization/routeAlgorithms";
import { optimizeClusteredOrder as optimizeOrder } from "../src/services/optimization/clustering";

type Pt = [number, number];

/** Euclidean "travel time" matrix: node 0 is the start, node i+1 is stop i. */
function euclid(points: Pt[]): number[][] {
  return points.map((a) => points.map((b) => Math.hypot(a[0] - b[0], a[1] - b[1])));
}

const PLAIN: CostParams = { loadWeight: 0, priorityWeight: 0 };
const stop = (over: Partial<StopLoad> = {}): StopLoad => ({ load: 1, priorityFactor: 0, serviceSeconds: 0, ...over });
const stopsOf = (n: number, over: Partial<StopLoad> = {}) => Array.from({ length: n }, () => stop(over));

const isPermutation = (order: number[], n: number) =>
  order.length === n && [...order].sort((a, b) => a - b).every((v, i) => v === i);

describe("nearestNeighborRoute", () => {
  it("returns an empty route for zero deliveries", () => {
    expect(nearestNeighborRoute(euclid([[0, 0]]), [], PLAIN)).toEqual([]);
  });

  it("returns the single stop for one delivery", () => {
    expect(nearestNeighborRoute(euclid([[0, 0], [5, 5]]), stopsOf(1), PLAIN)).toEqual([0]);
  });

  it("always goes to the closest unvisited stop (uses the matrix, not input order)", () => {
    // Input order is deliberately far -> near -> mid; NN must reorder it.
    const pts: Pt[] = [[0, 0], [30, 0], [1, 0], [10, 0]];
    expect(nearestNeighborRoute(euclid(pts), stopsOf(3), PLAIN)).toEqual([1, 2, 0]);
  });

  it("is deterministic when stops share identical coordinates", () => {
    const pts: Pt[] = [[0, 0], [4, 4], [4, 4], [4, 4]];
    const order = nearestNeighborRoute(euclid(pts), stopsOf(3), PLAIN);
    expect(order).toEqual([0, 1, 2]);
    expect(nearestNeighborRoute(euclid(pts), stopsOf(3), PLAIN)).toEqual(order);
  });

  it("visits every stop exactly once for a larger route", () => {
    const pts: Pt[] = [[0, 0], ...Array.from({ length: 40 }, (_, i): Pt => [(i * 37) % 23, (i * 91) % 29])];
    expect(isPermutation(nearestNeighborRoute(euclid(pts), stopsOf(40), PLAIN), 40)).toBe(true);
  });
});

describe("twoOpt", () => {
  // Found by search: NN gives a longer route than 2-opt on these points.
  //   start (0,0); A(3,0) B(10,2) C(8,0) D(4,0) E(3,1)
  const pts: Pt[] = [[0, 0], [3, 0], [10, 2], [8, 0], [4, 0], [3, 1]];
  const d = euclid(pts);
  const stops = stopsOf(5);
  const cost = (o: readonly number[]) => evaluateRoute(o, d, stops, PLAIN).total;

  it("strictly reduces the cost of an intentionally suboptimal Nearest Neighbor route", () => {
    const nn = nearestNeighborRoute(d, stops, PLAIN);
    expect(nn).toEqual([0, 3, 4, 2, 1]); // A, D, E, C, B — visits (3,0)->(4,0) then doubles back to (3,1)

    const improved = twoOpt(nn, cost, { maxPasses: 100, maxMillis: 1000 });

    expect(cost(nn)).toBeCloseTo(13.34, 2);
    expect(improved.cost).toBeCloseTo(11.99, 2);
    expect(improved.cost).toBeLessThan(cost(nn));
    expect(improved.improvements).toBeGreaterThan(0);
    expect(improved.stoppedBy).toBe("CONVERGED");
    expect(isPermutation(improved.order, 5)).toBe(true);
  });

  it("reports the true cost of the order it returns", () => {
    const nn = nearestNeighborRoute(d, stops, PLAIN);
    const improved = twoOpt(nn, cost, { maxPasses: 100, maxMillis: 1000 });
    expect(cost(improved.order)).toBeCloseTo(improved.cost, 9);
  });

  it("never makes a route worse and leaves an already-optimal route unchanged", () => {
    const line: Pt[] = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]];
    const ld = euclid(line);
    const s = stopsOf(4);
    const already = [0, 1, 2, 3];
    const result = twoOpt(already, (o) => evaluateRoute(o, ld, s, PLAIN).total, { maxPasses: 50, maxMillis: 500 });
    expect(result.order).toEqual(already);
    expect(result.improvements).toBe(0);
    expect(result.stoppedBy).toBe("CONVERGED");
  });

  it("handles zero and one stop without doing any work", () => {
    expect(twoOpt([], () => 0, { maxPasses: 10, maxMillis: 100 }).order).toEqual([]);
    const one = twoOpt([0], () => 5, { maxPasses: 10, maxMillis: 100 });
    expect(one.order).toEqual([0]);
    expect(one.passes).toBe(0);
  });

  it("can swap two stops", () => {
    const p: Pt[] = [[0, 0], [10, 0], [1, 0]];
    const dd = euclid(p);
    const s = stopsOf(2);
    const result = twoOpt([0, 1], (o) => evaluateRoute(o, dd, s, PLAIN).total, { maxPasses: 10, maxMillis: 100 });
    expect(result.order).toEqual([1, 0]);
  });

  it("stops at the pass limit", () => {
    const nn = nearestNeighborRoute(d, stops, PLAIN);
    const limited = twoOpt(nn, cost, { maxPasses: 1, maxMillis: 1000 });
    expect(limited.passes).toBe(1);
    expect(limited.stoppedBy).toBe("MAX_PASSES");
  });

  it("stops at the time budget so a large route cannot block the server", () => {
    let t = 0;
    const clock = () => (t += 10); // every read advances 10ms
    const nn = nearestNeighborRoute(d, stops, PLAIN);
    const limited = twoOpt(nn, cost, { maxPasses: 1000, maxMillis: 25, now: clock });
    expect(limited.stoppedBy).toBe("TIME_LIMIT");
    expect(isPermutation(limited.order, 5)).toBe(true);
  });
});

describe("optimizeClusteredOrder (DBSCAN + Nearest Neighbor + 2-opt)", () => {
  it("improves on Nearest Neighbor for a multi-delivery route and returns a valid permutation", () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const pts: Pt[] = [[0, 0], ...Array.from({ length: 25 }, (): Pt => [rnd() * 100, rnd() * 100])];

    const result = optimizeOrder({ durations: euclid(pts), stops: stopsOf(25), params: PLAIN });

    expect(isPermutation(result.order, 25)).toBe(true);
    expect(result.finalCost.total).toBeLessThan(result.initialCost.total);
    expect(result.twoOptImprovements).toBeGreaterThan(0);
  });

  it("does not run 2-opt for zero or one delivery", () => {
    const zero = optimizeOrder({ durations: euclid([[0, 0]]), stops: [], params: PLAIN });
    expect(zero.order).toEqual([]);
    expect(zero.twoOptStoppedBy).toBe("NOT_RUN");

    const one = optimizeOrder({ durations: euclid([[0, 0], [3, 4]]), stops: stopsOf(1), params: PLAIN });
    expect(one.order).toEqual([0]);
    expect(one.finalCost.travel).toBe(5);
    expect(one.twoOptStoppedBy).toBe("NOT_RUN");
  });

  it("copes with every delivery at the same coordinates (zero-length legs)", () => {
    const pts: Pt[] = [[0, 0], [2, 2], [2, 2], [2, 2], [2, 2]];
    const result = optimizeOrder({ durations: euclid(pts), stops: stopsOf(4), params: PLAIN });
    expect(isPermutation(result.order, 4)).toBe(true);
    expect(result.finalCost.travel).toBeCloseTo(Math.hypot(2, 2), 9);
  });

  it("is not simply the input order", () => {
    const pts: Pt[] = [[0, 0], [50, 0], [5, 0], [25, 0], [10, 0]];
    const { order } = optimizeOrder({ durations: euclid(pts), stops: stopsOf(4), params: PLAIN });
    expect(order).not.toEqual([0, 1, 2, 3]);
    expect(order).toEqual([1, 3, 2, 0]);
  });
});

describe("weight (parcel load) handling", () => {
  // Start, then A and B equally far from the start and from each other, so
  // travel time alone cannot distinguish the two orders.
  const durations = [
    [0, 100, 100],
    [100, 0, 100],
    [100, 100, 0]
  ];
  const heavyA = [stop({ load: 9 }), stop({ load: 1 })];

  it("with loadWeight 0 the two orders cost exactly the same", () => {
    expect(evaluateRoute([0, 1], durations, heavyA, PLAIN).total).toBe(
      evaluateRoute([1, 0], durations, heavyA, PLAIN).total
    );
  });

  it("carrying the heavy parcel over fewer legs is cheaper: heavy stop goes first", () => {
    const params: CostParams = { loadWeight: 0.5, priorityWeight: 0 };
    const heavyFirst = evaluateRoute([0, 1], durations, heavyA, params);
    const heavyLast = evaluateRoute([1, 0], durations, heavyA, params);

    // Same distance either way — only the load-dependent term differs.
    expect(heavyFirst.travel).toBe(heavyLast.travel);
    expect(heavyFirst.loadPenalty).toBeLessThan(heavyLast.loadPenalty);
    // Exact: leg1 carries 10/10 parcels, leg2 carries 1/10  -> 100*0.5*(1 + 0.1)
    expect(heavyFirst.loadPenalty).toBeCloseTo(55, 9);
    // vs heavy last: leg1 10/10, leg2 9/10 -> 100*0.5*(1 + 0.9)
    expect(heavyLast.loadPenalty).toBeCloseTo(95, 9);
  });

  it("the optimizer picks the heavy-first order and reports the load penalty", () => {
    const params: CostParams = { loadWeight: 0.5, priorityWeight: 0 };
    const result = optimizeOrder({ durations, stops: heavyA, params });
    expect(result.order).toEqual([0, 1]);

    const flipped = optimizeOrder({ durations, stops: [stop({ load: 1 }), stop({ load: 9 })], params });
    expect(flipped.order).toEqual([1, 0]);
  });

  it("does not turn weight into a plain 'distance x weight' product: travel stays pure time", () => {
    const params: CostParams = { loadWeight: 0.5, priorityWeight: 0 };
    const cost = evaluateRoute([0, 1], durations, heavyA, params);
    expect(cost.travel).toBe(200);
    expect(cost.total).toBe(cost.travel + cost.loadPenalty);
  });
});

describe("priority handling", () => {
  const durations = [
    [0, 100, 100],
    [100, 0, 100],
    [100, 100, 0]
  ];

  it("pulls an URGENT delivery ahead of an equally-distant NORMAL one", () => {
    const params: CostParams = { loadWeight: 0, priorityWeight: 0.25 };
    const stops = [stop(), stop({ priorityFactor: 3 })];
    expect(optimizeOrder({ durations, stops, params }).order).toEqual([1, 0]);
  });

  it("does nothing when priorityWeight is 0", () => {
    const stops = [stop(), stop({ priorityFactor: 3 })];
    expect(optimizeOrder({ durations, stops, params: PLAIN }).order).toEqual([0, 1]);
  });

  it("counts service (dwell) time towards later arrivals", () => {
    const params: CostParams = { loadWeight: 0, priorityWeight: 1 };
    const stops = [stop({ serviceSeconds: 600 }), stop({ priorityFactor: 1 })];
    // urgent stop second: arrives at 100 + 600 + 100 = 800
    expect(evaluateRoute([0, 1], durations, stops, params).priorityPenalty).toBe(800);
    // urgent stop first: arrives at 100
    expect(evaluateRoute([1, 0], durations, stops, params).priorityPenalty).toBe(100);
  });
});

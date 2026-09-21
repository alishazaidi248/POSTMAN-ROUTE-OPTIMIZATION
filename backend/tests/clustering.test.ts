import { describe, expect, it } from "vitest";
import {
  MAX_AUTO_EPS_SECONDS,
  MIN_AUTO_EPS_SECONDS,
  autoEpsSeconds,
  clusterStops,
  dbscan,
  optimizeClusteredOrder
} from "../src/services/optimization/clustering";
import {
  CostParams,
  StopLoad,
  evaluateRoute,
  nearestNeighborRoute,
  twoOpt
} from "../src/services/optimization/routeAlgorithms";

type Pt = [number, number];

/** Node 0 is the start, node i+1 is stop i; symmetric Euclidean "travel time". */
function euclid(points: Pt[]): number[][] {
  return points.map((a) => points.map((b) => Math.hypot(a[0] - b[0], a[1] - b[1])));
}

const PLAIN: CostParams = { loadWeight: 0, priorityWeight: 0 };
const stopsOf = (n: number, over: Partial<StopLoad> = {}): StopLoad[] =>
  Array.from({ length: n }, () => ({ load: 1, priorityFactor: 0, serviceSeconds: 0, ...over }));

const isPermutation = (order: number[], n: number) =>
  order.length === n && [...order].sort((a, b) => a - b).every((v, i) => v === i);

/** Every cluster's members occupy one unbroken run of the order. */
function clustersAreContiguous(order: number[], clusterOfStop: number[]): boolean {
  const seen = new Set<number>();
  let previous = -1;
  for (const idx of order) {
    const c = clusterOfStop[idx];
    if (c !== previous) {
      if (seen.has(c)) return false;
      seen.add(c);
      previous = c;
    }
  }
  return true;
}

/** Against the ORIGINAL DBSCAN clusters (not labels derived from the result): each is one unbroken run. */
function originalClustersStayContiguous(order: number[], clusters: number[][]): boolean {
  return clusters.every((members) => {
    const positions = members.map((idx) => order.indexOf(idx)).sort((a, b) => a - b);
    return positions[positions.length - 1] - positions[0] + 1 === members.length;
  });
}

describe("dbscan", () => {
  const line = (xs: number[]) => (i: number, j: number) => Math.abs(xs[i] - xs[j]);

  it("finds two well-separated groups and labels an isolated point as noise", () => {
    const xs = [0, 1, 2, 50, 51, 52, 200];
    const { labels, clusterCount } = dbscan(xs.length, line(xs), 2, 2);
    expect(clusterCount).toBe(2);
    expect(labels[0]).toBe(labels[1]);
    expect(labels[1]).toBe(labels[2]);
    expect(labels[3]).toBe(labels[4]);
    expect(labels[0]).not.toBe(labels[3]);
    expect(labels[6]).toBe(-1);
  });

  it("chains through density: a long row of points each within eps is ONE cluster", () => {
    const xs = [0, 2, 4, 6, 8, 10];
    const { clusterCount, labels } = dbscan(xs.length, line(xs), 2, 2);
    expect(clusterCount).toBe(1);
    expect(new Set(labels).size).toBe(1);
  });

  it("makes every point noise when eps is too small", () => {
    const xs = [0, 10, 20];
    const { labels, clusterCount } = dbscan(xs.length, line(xs), 1, 2);
    expect(clusterCount).toBe(0);
    expect(labels).toEqual([-1, -1, -1]);
  });

  it("attaches a border point (not core itself) to the cluster that reaches it", () => {
    // 0,1,2 are dense; 3.5 is within eps of 2 only, so it is a border point of that cluster.
    const xs = [0, 1, 2, 3.5];
    const { labels } = dbscan(xs.length, line(xs), 1.6, 3);
    expect(labels[3]).toBe(labels[2]);
    expect(labels[3]).not.toBe(-1);
  });

  it("with minPts = 1 every point is a core point, so only connectivity matters", () => {
    const xs = [0, 1, 100];
    const { clusterCount } = dbscan(xs.length, line(xs), 1.5, 1);
    expect(clusterCount).toBe(2);
  });

  it("handles no points", () => {
    expect(dbscan(0, () => 0, 5, 2)).toEqual({ labels: [], clusterCount: 0 });
  });
});

describe("clusterStops", () => {
  it("clusters by road travel time and keeps noise stops as single-stop clusters (never dropped)", () => {
    const pts: Pt[] = [[0, 0], [1, 0], [2, 0], [50, 0], [51, 0], [200, 0]]; // start + 5 stops
    const { clusters, densityClusters, noisePoints } = clusterStops(euclid(pts), 5, 3, 2);
    expect(densityClusters).toBe(2);
    expect(noisePoints).toBe(1);
    expect(clusters).toHaveLength(3);
    expect(clusters.flat().sort()).toEqual([0, 1, 2, 3, 4]);
    expect(clusters[clusters.length - 1]).toEqual([4]); // the lone stop
  });

  it("uses the average of both directions, so a one-way street does not split a neighbourhood", () => {
    // stop0 -> stop1 is 1s but stop1 -> stop0 is 9s: the average (5s) is within eps 6.
    const d = [
      [0, 100, 100],
      [100, 0, 1],
      [100, 9, 0]
    ];
    expect(clusterStops(d, 2, 6, 2).densityClusters).toBe(1);
    expect(clusterStops(d, 2, 4, 2).densityClusters).toBe(0);
  });
});

describe("optimizeClusteredOrder", () => {
  const start: Pt = [0, 0];
  // Two neighbourhoods: A near the start, B far away.
  const A: Pt[] = [[1, 0], [2, 0], [1, 1], [2, 1]];
  const B: Pt[] = [[50, 0], [51, 0], [50, 1], [51, 1]];

  it("visits the near cluster completely before the far one and keeps each cluster contiguous", () => {
    // Interleave the input order so index order cannot explain the result.
    const pts: Pt[] = [start, B[0], A[0], B[1], A[1], B[2], A[2], B[3], A[3]];
    const result = optimizeClusteredOrder({ durations: euclid(pts), stops: stopsOf(8), params: PLAIN, epsSeconds: 3, minPts: 2 });

    expect(isPermutation(result.order, 8)).toBe(true);
    expect(result.densityClusters).toBe(2);
    expect(result.noisePoints).toBe(0);
    expect(clustersAreContiguous(result.order, result.clusterOfStop)).toBe(true);
    expect(originalClustersStayContiguous(result.order, clusterStops(euclid(pts), 8, 3, 2).clusters)).toBe(true);

    // Stops at odd input positions (B) come after all A stops.
    const isA = (idx: number) => idx % 2 === 1; // input order: B,A,B,A,... -> stop idx 1,3,5,7 are A
    const firstB = result.order.findIndex((idx) => !isA(idx));
    expect(result.order.slice(0, firstB).every(isA)).toBe(true);
    expect(result.order.slice(firstB).every((idx) => !isA(idx))).toBe(true);
    expect(new Set(result.clusterOfStop)).toEqual(new Set([1, 2]));
  });

  it("reports the clusters in visiting order (1 = first visited)", () => {
    const pts: Pt[] = [start, ...B, ...A];
    const result = optimizeClusteredOrder({ durations: euclid(pts), stops: stopsOf(8), params: PLAIN, epsSeconds: 3, minPts: 2 });
    // A stops are input indices 4..7 and are visited first -> cluster 1.
    expect([4, 5, 6, 7].every((i) => result.clusterOfStop[i] === 1)).toBe(true);
    expect([0, 1, 2, 3].every((i) => result.clusterOfStop[i] === 2)).toBe(true);
  });

  it("2-opt improves inside a cluster: one big cluster reproduces NN + 2-opt (13.34 -> 11.99)", () => {
    const pts: Pt[] = [[0, 0], [3, 0], [10, 2], [8, 0], [4, 0], [3, 1]];
    const d = euclid(pts);
    const result = optimizeClusteredOrder({ durations: d, stops: stopsOf(5), params: PLAIN, epsSeconds: 1000, minPts: 2 });

    expect(result.densityClusters).toBe(1);
    expect(result.initialCost.total).toBeCloseTo(13.34, 2);
    expect(result.finalCost.total).toBeCloseTo(11.99, 2);
    expect(result.twoOptImprovements).toBeGreaterThan(0);
    // With a single cluster the pipeline is exactly Nearest Neighbor followed by 2-opt.
    const stops = stopsOf(5);
    const nn = nearestNeighborRoute(d, stops, PLAIN);
    const plain = twoOpt(nn, (o) => evaluateRoute(o, d, stops, PLAIN).total, { maxPasses: 100, maxMillis: 1000 });
    expect(result.finalCost.total).toBeCloseTo(plain.cost, 9);
  });

  it("treats stops that belong to no cluster as single-stop clusters instead of dropping them", () => {
    const pts: Pt[] = [start, ...A, [300, 300]];
    const result = optimizeClusteredOrder({ durations: euclid(pts), stops: stopsOf(5), params: PLAIN, epsSeconds: 3, minPts: 2 });
    expect(result.noisePoints).toBe(1);
    expect(result.densityClusters).toBe(1);
    expect(isPermutation(result.order, 5)).toBe(true);
    expect(result.order[4]).toBe(4); // the far lone stop is last
    expect(result.blocks).toHaveLength(2);
  });

  it("never returns a route worse than its own starting point, and keeps clusters contiguous, on random data", () => {
    let seed = 11;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    let anyImproved = false;

    for (let trial = 0; trial < 25; trial++) {
      const n = 6 + Math.floor(rnd() * 20);
      const pts: Pt[] = [[0, 0], ...Array.from({ length: n }, (): Pt => [rnd() * 100, rnd() * 100])];
      const params: CostParams = trial % 2 ? { loadWeight: 0.35, priorityWeight: 0.25 } : PLAIN;
      const stops: StopLoad[] = Array.from({ length: n }, () => ({
        load: 1 + Math.floor(rnd() * 5),
        priorityFactor: [0, 0, 1, 3][Math.floor(rnd() * 4)],
        serviceSeconds: 0
      }));

      const r = optimizeClusteredOrder({ durations: euclid(pts), stops, params, epsSeconds: 20, minPts: 2 });

      expect(isPermutation(r.order, n)).toBe(true);
      expect(clustersAreContiguous(r.order, r.clusterOfStop)).toBe(true);
      expect(originalClustersStayContiguous(r.order, clusterStops(euclid(pts), n, 20, 2).clusters)).toBe(true);
      expect(r.finalCost.total).toBeLessThanOrEqual(r.initialCost.total + 1e-9);
      expect(evaluateRoute(r.order, euclid(pts), stops, params).total).toBeCloseTo(r.finalCost.total, 9);
      if (r.finalCost.total < r.initialCost.total - 1e-6) anyImproved = true;
    }
    expect(anyImproved).toBe(true);
  });

  it("handles zero and one stop", () => {
    const zero = optimizeClusteredOrder({ durations: euclid([start]), stops: [], params: PLAIN });
    expect(zero.order).toEqual([]);
    expect(zero.twoOptStoppedBy).toBe("NOT_RUN");

    const one = optimizeClusteredOrder({ durations: euclid([start, [3, 4]]), stops: stopsOf(1), params: PLAIN });
    expect(one.order).toEqual([0]);
    expect(one.finalCost.travel).toBe(5);
    expect(one.clusterOfStop).toEqual([1]);
  });

  it("derives eps from the travel-time matrix when none is configured, and still separates two neighbourhoods", () => {
    const pts: Pt[] = [start, ...A, ...B];
    const d = euclid(pts);
    const eps = autoEpsSeconds(d, 8, 2);
    expect(eps).toBeGreaterThanOrEqual(MIN_AUTO_EPS_SECONDS);
    expect(eps).toBeLessThanOrEqual(MAX_AUTO_EPS_SECONDS);

    // Unit "seconds" are tiny here (1-2 s spacing), so the floor applies; scale the world up
    // to minutes so the derived value is what drives the split.
    const scaled = d.map((row) => row.map((v) => v * 20));
    const r = optimizeClusteredOrder({ durations: scaled, stops: stopsOf(8), params: PLAIN });
    expect(r.epsAuto).toBe(true);
    expect(r.densityClusters).toBe(2);
    expect(clustersAreContiguous(r.order, r.clusterOfStop)).toBe(true);
  });

  it("does not let a very large eps swallow everything silently: the reported eps is the one used", () => {
    const pts: Pt[] = [start, ...A, ...B];
    const r = optimizeClusteredOrder({ durations: euclid(pts), stops: stopsOf(8), params: PLAIN, epsSeconds: 1000, minPts: 2 });
    expect(r.epsAuto).toBe(false);
    expect(r.epsSeconds).toBe(1000);
    expect(r.densityClusters).toBe(1);
  });

  it("reports the cost of the input order so an improvement is measurable", () => {
    const pts: Pt[] = [start, B[0], A[0], B[1], A[1], B[2], A[2], B[3], A[3]];
    const r = optimizeClusteredOrder({ durations: euclid(pts), stops: stopsOf(8), params: PLAIN, epsSeconds: 3, minPts: 2 });
    expect(r.inputOrderCost.total).toBeGreaterThan(r.finalCost.total);
    expect(r.finalCost.total).toBeLessThanOrEqual(r.initialCost.total);
    expect(r.twoOptReverted).toBe(false);
  });

  it("stops at the time budget instead of blocking", () => {
    let t = 0;
    const pts: Pt[] = [start, ...A, ...B];
    const r = optimizeClusteredOrder({
      durations: euclid(pts),
      stops: stopsOf(8),
      params: PLAIN,
      epsSeconds: 3,
      minPts: 2,
      maxMillis: 25,
      now: () => (t += 10)
    });
    expect(r.twoOptStoppedBy).toBe("TIME_LIMIT");
    expect(isPermutation(r.order, 8)).toBe(true);
  });

  it("handles identical coordinates", () => {
    const pts: Pt[] = [start, [5, 5], [5, 5], [5, 5]];
    const r = optimizeClusteredOrder({ durations: euclid(pts), stops: stopsOf(3), params: PLAIN, epsSeconds: 1, minPts: 2 });
    expect(r.densityClusters).toBe(1);
    expect(isPermutation(r.order, 3)).toBe(true);
  });
});

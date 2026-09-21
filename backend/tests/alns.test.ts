import { describe, expect, it } from "vitest";
import { alns, DESTROY_OPERATORS, REPAIR_OPERATORS, insertionDelta } from "../src/services/optimization/alns";
import { optimizeWithAlns, optimizeClusteredOrder } from "../src/services/optimization/clustering";
import { CostParams, StopLoad, evaluateRoute } from "../src/services/optimization/routeAlgorithms";

type Pt = [number, number];

/** Euclidean "travel time" matrix; node 0 is the start, node i+1 is stop i. */
const euclid = (points: Pt[]): number[][] => points.map((a) => points.map((b) => Math.hypot(a[0] - b[0], a[1] - b[1])));

const PLAIN: CostParams = { loadWeight: 0, priorityWeight: 0 };
const WEIGHTED: CostParams = { loadWeight: 0.35, priorityWeight: 0.25 };

function lcg(seed: number) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
}

/** A deterministic scattered round of n stops. */
function dataset(n: number, seed: number, weighted = false) {
  const rnd = lcg(seed);
  const points: Pt[] = [[50, 50], ...Array.from({ length: n }, (): Pt => [rnd() * 100, rnd() * 100])];
  const stops: StopLoad[] = Array.from({ length: n }, () => ({
    load: weighted ? 1 + Math.floor(rnd() * 5) : 1,
    priorityFactor: weighted ? [0, 0, 1, 3][Math.floor(rnd() * 4)] : 0,
    serviceSeconds: weighted ? Math.floor(rnd() * 4) * 10 : 0
  }));
  return { durations: euclid(points), stops };
}

const isPermutation = (order: readonly number[], n: number) => order.length === n && [...order].sort((a, b) => a - b).every((v, i) => v === i);

const LIMITS = { maxIterations: 1500, maxMillis: 60_000, noImprovementLimit: 100_000 };

describe("the closed-form insertion cost", () => {
  it("equals the change in the full cost function, for every position, with load, priority and service time", () => {
    const { durations, stops } = dataset(14, 5, true);
    const rnd = lcg(9);
    for (let trial = 0; trial < 40; trial++) {
      const perm = Array.from({ length: 14 }, (_, i) => i).sort(() => rnd() - 0.5);
      const x = perm.pop() as number;
      const route = perm.slice(0, 4 + Math.floor(rnd() * 9)); // a partial route: some stops are not in it
      const base = evaluateRoute(route, durations, stops, WEIGHTED).total;
      for (let p = 0; p <= route.length; p++) {
        const withX = [...route.slice(0, p), x, ...route.slice(p)];
        const expected = evaluateRoute(withX, durations, stops, WEIGHTED).total - base;
        expect(insertionDelta(route, x, p, durations, stops, WEIGHTED)).toBeCloseTo(expected, 6);
      }
    }
  });
});

describe("alns", () => {
  it("never returns a route dearer than the one it started from, and always a valid permutation", () => {
    for (const [n, seed, weighted] of [[6, 1, false], [12, 2, true], [30, 3, true], [30, 4, false]] as const) {
      const { durations, stops } = dataset(n, seed, weighted);
      const params = weighted ? WEIGHTED : PLAIN;
      const start = Array.from({ length: n }, (_, i) => i); // deliberately the worst kind of start: input order
      const r = alns({ durations, stops, params, initialOrder: start, ...LIMITS });
      expect(isPermutation(r.order, n)).toBe(true);
      expect(r.bestCost).toBeLessThanOrEqual(r.initialCost + 1e-9);
      expect(evaluateRoute(r.order, durations, stops, params).total).toBeCloseTo(r.bestCost, 6);
      expect(r.iterations).toBeGreaterThan(0);
    }
  });

  it("really finds a cheaper route than a poor start (it is a search, not a copy)", () => {
    const { durations, stops } = dataset(25, 11);
    const start = Array.from({ length: 25 }, (_, i) => i);
    const r = alns({ durations, stops, params: PLAIN, initialOrder: start, ...LIMITS });
    expect(r.bestCost).toBeLessThan(r.initialCost * 0.7);
    expect(r.improvements).toBeGreaterThan(0);
    expect(r.order).not.toEqual(start);
  });

  it("is deterministic for a given seed, and different seeds explore differently", () => {
    const { durations, stops } = dataset(20, 21, true);
    const start = Array.from({ length: 20 }, (_, i) => i);
    const run = (seed: number) => alns({ durations, stops, params: WEIGHTED, initialOrder: start, seed, ...LIMITS, maxIterations: 400 });
    expect(run(7).order).toEqual(run(7).order);
    expect(run(7).bestCost).toBe(run(7).bestCost);
    expect(run(7).bestCost).toBeCloseTo(run(8).bestCost, -3); // similar quality...
  });

  it("uses every destroy and repair operator and keeps count of them", () => {
    const { durations, stops } = dataset(30, 33, true);
    const r = alns({
      durations, stops, params: WEIGHTED, initialOrder: Array.from({ length: 30 }, (_, i) => i),
      clusterOf: Array.from({ length: 30 }, (_, i) => Math.floor(i / 6)), preserveClusters: false, ...LIMITS, maxIterations: 600
    });
    for (const op of DESTROY_OPERATORS) expect(r.destroyUsage[op].used).toBeGreaterThan(0);
    for (const op of REPAIR_OPERATORS) expect(r.repairUsage[op].used).toBeGreaterThan(0);
    const totalDestroy = DESTROY_OPERATORS.reduce((s, o) => s + r.destroyUsage[o].used, 0);
    expect(totalDestroy).toBe(r.iterations);
    expect(r.acceptedImproving + r.acceptedWorse + r.rejected).toBe(r.iterations);
  });

  it("adapts: the weights move away from 1 and follow which operators are rewarded", () => {
    const { durations, stops } = dataset(40, 44, true);
    const r = alns({ durations, stops, params: WEIGHTED, initialOrder: Array.from({ length: 40 }, (_, i) => i), ...LIMITS, maxIterations: 800, segmentLength: 50 });
    const weights = [...DESTROY_OPERATORS.map((o) => r.destroyUsage[o].weight), ...REPAIR_OPERATORS.map((o) => r.repairUsage[o].weight)];
    expect(weights.some((w) => Math.abs(w - 1) > 0.05)).toBe(true);
    expect(new Set(weights.map((w) => w.toFixed(3))).size).toBeGreaterThan(2);
    // the operators that produced improvements were rewarded, so someone has a new-best or improved count
    const rewarded = [...DESTROY_OPERATORS.map((o) => r.destroyUsage[o]), ...REPAIR_OPERATORS.map((o) => r.repairUsage[o])];
    expect(rewarded.some((s) => s.newBest + s.improved > 0)).toBe(true);
  });

  it("accepts some worse routes while the temperature is high (simulated annealing), yet still returns the best", () => {
    const { durations, stops } = dataset(30, 55);
    const r = alns({ durations, stops, params: PLAIN, initialOrder: Array.from({ length: 30 }, (_, i) => i), ...LIMITS, maxIterations: 1200 });
    expect(r.acceptedWorse).toBeGreaterThan(0);
    expect(r.temperatureStart).toBeGreaterThan(r.temperatureEnd);
    expect(r.bestCost).toBeLessThanOrEqual(r.initialCost);
  });

  it("stops on the iteration limit, the time limit and the no-improvement limit, and says which", () => {
    const { durations, stops } = dataset(20, 66);
    const start = Array.from({ length: 20 }, (_, i) => i);
    expect(alns({ durations, stops, params: PLAIN, initialOrder: start, ...LIMITS, maxIterations: 25 }).stoppedBy).toBe("MAX_ITERATIONS");
    expect(alns({ durations, stops, params: PLAIN, initialOrder: start, ...LIMITS, noImprovementLimit: 5, maxIterations: 100_000 }).stoppedBy).toBe("NO_IMPROVEMENT");
    let t = 0;
    const slow = alns({ durations, stops, params: PLAIN, initialOrder: start, maxIterations: 100_000, maxMillis: 50, noImprovementLimit: 100_000, now: () => (t += 10) });
    expect(slow.stoppedBy).toBe("TIME_LIMIT");
    expect(slow.iterations).toBeLessThan(10);
    expect(isPermutation(slow.order, 20)).toBe(true);
  });

  it("does nothing (and says so) for fewer than 3 stops, or a zero budget", () => {
    const { durations, stops } = dataset(2, 1);
    const r = alns({ durations, stops, initialOrder: [1, 0], ...LIMITS });
    expect(r.stoppedBy).toBe("NOT_RUN");
    expect(r.order).toEqual([1, 0]);
    const d5 = dataset(5, 1);
    expect(alns({ durations: d5.durations, stops: d5.stops, initialOrder: [0, 1, 2, 3, 4], ...LIMITS, maxIterations: 0 }).stoppedBy).toBe("NOT_RUN");
  });

  it("keeps every cluster in one unbroken run when clusters are preserved, and can still reorder inside and between clusters", () => {
    // three neighbourhoods far apart, visited in a bad cluster order, with the stops inside scrambled
    const pts: Pt[] = [[0, 0]];
    const label: number[] = [];
    const centres: Pt[] = [[80, 0], [10, 5], [45, 60]];
    const rnd = lcg(77);
    for (let c = 0; c < 3; c++) for (let k = 0; k < 8; k++) { pts.push([centres[c][0] + rnd() * 6, centres[c][1] + rnd() * 6]); label.push(c); }
    const durations = euclid(pts);
    const stops: StopLoad[] = label.map(() => ({ load: 1, priorityFactor: 0, serviceSeconds: 0 }));
    // start: cluster 0, then 2, then 1 - and scrambled inside each
    const start = [0, 2, 1, 3, 4, 5, 6, 7, 16, 18, 17, 19, 20, 21, 22, 23, 8, 10, 9, 11, 12, 13, 14, 15];
    const r = alns({ durations, stops, params: PLAIN, initialOrder: start, clusterOf: label, preserveClusters: true, ...LIMITS, maxIterations: 800 });
    // contiguous
    const seen = new Set<number>();
    let prev = -1;
    for (const idx of r.order) {
      if (label[idx] !== prev) {
        expect(seen.has(label[idx])).toBe(false);
        seen.add(label[idx]);
        prev = label[idx];
      }
    }
    expect(r.clustersPreserved).toBe(true);
    expect(r.bestCost).toBeLessThan(r.initialCost);
  });

  it("with clusters not preserved, the cost function alone decides (it can only do as well or better)", () => {
    const { durations, stops } = dataset(24, 88);
    const labels = Array.from({ length: 24 }, (_, i) => i % 4);
    const start = Array.from({ length: 24 }, (_, i) => i);
    const kept = alns({ durations, stops, params: PLAIN, initialOrder: start, clusterOf: labels, preserveClusters: true, ...LIMITS, maxIterations: 800 });
    const free = alns({ durations, stops, params: PLAIN, initialOrder: start, clusterOf: labels, preserveClusters: false, ...LIMITS, maxIterations: 800 });
    expect(free.clustersPreserved).toBe(false);
    expect(free.bestCost).toBeLessThanOrEqual(free.initialCost);
    expect(kept.bestCost).toBeLessThanOrEqual(kept.initialCost);
  });
});

describe("the full pipeline: DBSCAN -> Nearest Neighbor -> 2-opt -> ALNS", () => {
  const settings = (over: Partial<{ maxIterations: number; preserveClusters: boolean }> = {}) => ({
    maxIterations: 1500, maxMillis: 60_000, noImprovementLimit: 100_000, preserveClusters: true, seed: 1, ...over
  });

  it.each([10, 25, 50, 100])("%i deliveries: input >= NN >= NN+2-opt >= ALNS, measured with the same cost function", (n) => {
    const { durations, stops } = dataset(n, 1000 + n, true);
    const rows = optimizeWithAlns({ durations, stops, params: WEIGHTED, epsSeconds: 25, minPts: 2, maxMillis: 3000, alns: settings({ maxIterations: n >= 100 ? 600 : 1200 }) });

    const cost = (o: readonly number[]) => evaluateRoute(o, durations, stops, WEIGHTED).total;
    const inputCost = rows.inputOrderCost.total;
    const nnCost = rows.initialCost.total;
    const twoOptCost = rows.twoOptCost.total;
    const alnsCost = rows.finalCost.total;

    expect(isPermutation(rows.order, n)).toBe(true);
    expect(cost(rows.order)).toBeCloseTo(alnsCost, 6);
    expect(cost(rows.twoOptOrder)).toBeCloseTo(twoOptCost, 6);
    expect(inputCost).toBeGreaterThan(nnCost);
    expect(nnCost).toBeGreaterThanOrEqual(twoOptCost - 1e-9);
    expect(alnsCost).toBeLessThanOrEqual(twoOptCost + 1e-9);
    expect(rows.alnsReverted).toBe(false);
    expect(rows.alns.bestCost).toBeCloseTo(alnsCost, 6);
    // DBSCAN's structure survives: every cluster run is contiguous
    const seen = new Set<number>();
    let prev = -1;
    for (const idx of rows.order) {
      if (rows.clusterOfStop[idx] !== prev) {
        expect(seen.has(rows.clusterOfStop[idx])).toBe(false);
        seen.add(rows.clusterOfStop[idx]);
        prev = rows.clusterOfStop[idx];
      }
    }
    console.log(
      `n=${n}: input ${inputCost.toFixed(0)} | NN ${nnCost.toFixed(0)} | +2-opt ${twoOptCost.toFixed(0)} | +ALNS ${alnsCost.toFixed(0)} ` +
        `(${(((twoOptCost - alnsCost) / twoOptCost) * 100).toFixed(2)}% better than 2-opt) | ${rows.alns.iterations} it, ${rows.alns.improvements} improvements, ${rows.alns.runtimeMs} ms, clusters ${rows.blocks.length}`
    );
  });

  it("ALNS improves on NN + 2-opt for a round where 2-opt is stuck (one cluster, 25 stops)", () => {
    const { durations, stops } = dataset(25, 2025);
    const r = optimizeWithAlns({ durations, stops, params: PLAIN, epsSeconds: 1000, minPts: 2, maxMillis: 3000, alns: settings() });
    expect(r.blocks).toHaveLength(1);
    expect(r.alns.bestCost).toBeLessThan(r.twoOptCost.total - 1e-6);
    expect(r.finalCost.total).toBeLessThan(r.twoOptCost.total);
  });

  it("never claims an improvement that did not happen: a round 2-opt already solves stays the same", () => {
    // stops on a straight line: NN + 2-opt is optimal, nothing can be better
    const points: Pt[] = [[0, 0], ...Array.from({ length: 8 }, (_, i): Pt => [(i + 1) * 10, 0])];
    const stops: StopLoad[] = Array.from({ length: 8 }, () => ({ load: 1, priorityFactor: 0, serviceSeconds: 0 }));
    const r = optimizeWithAlns({ durations: euclid(points), stops, params: PLAIN, epsSeconds: 1000, minPts: 2, maxMillis: 3000, alns: settings({ maxIterations: 300 }) });
    expect(r.order).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(r.alns.improvements).toBe(0);
    expect(r.finalCost.total).toBeCloseTo(r.twoOptCost.total, 9);
  });

  it("the same input twice gives the same route", () => {
    const { durations, stops } = dataset(30, 3030, true);
    const run = () => optimizeWithAlns({ durations, stops, params: WEIGHTED, epsSeconds: 25, minPts: 2, maxMillis: 3000, alns: settings({ maxIterations: 500 }) }).order;
    expect(run()).toEqual(run());
  });

  it("matches the plain pipeline exactly when ALNS is given no budget", () => {
    const { durations, stops } = dataset(15, 4040, true);
    const plain = optimizeClusteredOrder({ durations, stops, params: WEIGHTED, epsSeconds: 25, minPts: 2, maxMillis: 3000 });
    const full = optimizeWithAlns({ durations, stops, params: WEIGHTED, epsSeconds: 25, minPts: 2, maxMillis: 3000, alns: settings({ maxIterations: 0 }) });
    expect(full.order).toEqual(plain.order);
    expect(full.alns.stoppedBy).toBe("NOT_RUN");
  });
});

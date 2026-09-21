/**
 * Algorithm study on the Bhandup West data: accuracy AND time of every route algorithm, over round sizes from 5 to 100
 * stops, on real OSRM road times, with one cost function (the production one).
 *
 *   npx tsx scripts/algorithm-study.ts   ->  backend/data/bhandup/algorithm-study.json
 *
 * Needs the data set loaded (scripts/setup-bhandup.ts) and the routing engine.
 *
 * Accuracy = gap of the route's cost to the reference, in per cent (0 = as cheap as the reference).
 *   reference, up to 10 stops : the EXACT optimum (exhaustive search with pruning)
 *   reference, larger rounds  : the cheapest route found by any algorithm below OR by 5 independent long ALNS runs
 *                               (15 000 iterations, other seeds, clusters not forced together) - so the production
 *                               pipeline is never compared only with itself.
 * Time = run time of the algorithm in milliseconds (median of repeated runs for the fast ones). It is the time to
 *        COMPUTE the route, not the driving time; driving minutes and km of the resulting route are reported too.
 *
 * The delivery points are placed within 300 m of the OpenStreetMap anchor of each delivery's beat (the supplied
 * addresses cannot be geocoded to buildings); road times and distances are real.
 */
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../src/config/prisma";
import { optimizeClusteredOrder, optimizeWithAlns } from "../src/services/optimization/clustering";
import { DEFAULT_COST_PARAMS, StopLoad, evaluateRoute, nearestNeighborRoute, twoOpt } from "../src/services/optimization/routeAlgorithms";
import { RoutingService } from "../src/services/optimization/routing";

const DATA = path.join(__dirname, "..", "data", "bhandup");
const OSRM = (process.env.OSRM_BASE_URL ?? "https://router.project-osrm.org").replace(/\/+$/, "");
const START = { latitude: 19.1436, longitude: 72.9345 };
type Pt = { latitude: number; longitude: number };

const lcg = (seed: number) => { let s = seed; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; };
const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

/** Median run time (ms) of fn over repeated calls (until ~40 ms have been spent, 3..200 calls); also returns the last result. */
function bench<T>(fn: () => T): { result: T; ms: number } {
  const times: number[] = [];
  let result!: T;
  const t0 = performance.now();
  while (times.length < 3 || (performance.now() - t0 < 40 && times.length < 200)) {
    const a = performance.now();
    result = fn();
    times.push(performance.now() - a);
    if (times.length >= 3 && performance.now() - t0 > 4000) break; // slow algorithm: 3 runs are enough
  }
  return { result, ms: median(times) };
}

function exactOptimum(durations: number[][], stops: StopLoad[], params = DEFAULT_COST_PARAMS) {
  const n = stops.length;
  const total = stops.reduce((s, x) => s + x.load, 0);
  let best = Infinity;
  const used = new Array(n).fill(false);
  let depth = 0;
  const go = (prev: number, clock: number, remaining: number, cost: number) => {
    if (cost >= best) return;
    if (depth === n) { best = cost; return; }
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      const t = durations[prev][i + 1];
      const c = cost + t + params.loadWeight * t * (total > 0 ? Math.max(0, remaining) / total : 0) + params.priorityWeight * stops[i].priorityFactor * (clock + t);
      used[i] = true; depth++;
      go(i + 1, clock + t + stops[i].serviceSeconds, remaining - stops[i].load, c);
      used[i] = false; depth--;
    }
  };
  go(0, 0, total, 0);
  return best;
}

const NAMES = ["Input order", "Random order (mean of 30)", "Nearest Neighbour", "NN + 2-opt", "DBSCAN + NN", "DBSCAN + NN + 2-opt", "DBSCAN + NN + 2-opt + ALNS (production)", "NN + 2-opt + ALNS (clusters free)"] as const;

async function evaluateRound(routing: RoutingService, points: Pt[], seed: number) {
  const matrix = await routing.getMatrix([START, ...points]);
  const n = points.length;
  const stops: StopLoad[] = points.map(() => ({ load: 1, priorityFactor: 0, serviceSeconds: 180 }));
  const params = DEFAULT_COST_PARAMS;
  const cost = (o: readonly number[]) => evaluateRoute(o, matrix.durations, stops, params).total;
  const sum = (o: readonly number[], m: readonly (readonly number[])[]) => { let p = 0, s = 0; for (const i of o) { s += m[p][i + 1]; p = i + 1; } return s; };
  const ident = points.map((_, i) => i);
  const alnsCfg = (over: object) => ({ maxIterations: 2500, maxMillis: 20_000, noImprovementLimit: 600, preserveClusters: true, ...over });

  const rnd = lcg(seed);
  const randOrders: number[][] = [];
  for (let r = 0; r < 30; r++) { const p = [...ident]; for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; } randOrders.push(p); }

  const nn = bench(() => nearestNeighborRoute(matrix.durations, stops, params));
  const nn2 = bench(() => twoOpt(nn.result, cost, { maxPasses: 500, maxMillis: 20_000 }).order);
  const dbNn = bench(() => optimizeClusteredOrder({ durations: matrix.durations, stops, params, maxPasses: 0, maxMillis: 1000 }));
  const full = bench(() => optimizeWithAlns({ durations: matrix.durations, stops, params, maxPasses: 500, maxMillis: 20_000, alns: alnsCfg({}) }));
  const free = bench(() => optimizeWithAlns({ durations: matrix.durations, stops, params, maxPasses: 500, maxMillis: 20_000, alns: alnsCfg({ preserveClusters: false }) }));
  const freeOrder = free.result.order;

  const orders: (number[] | null)[] = [ident, null, nn.result, nn2.result, dbNn.result.initialOrder, full.result.twoOptOrder, full.result.order, freeOrder];
  const randMs = bench(() => randOrders.forEach((o) => cost(o))).ms / 30;
  const times = [0, randMs, nn.ms, nn.ms + nn2.ms, dbNn.ms, full.result.optimizationMs, full.ms, free.ms];
  const costs = orders.map((o) => (o ? cost(o) : mean(randOrders.map(cost))));

  let ref: number, refKind: "exact" | "long-search";
  let exactMs: number | null = null;
  if (n <= 10) { const t0 = performance.now(); ref = exactOptimum(matrix.durations, stops); exactMs = performance.now() - t0; refKind = "exact"; }
  else {
    let longBest = Infinity;
    for (const s of [11, 22, 33, 44, 55]) {
      const r = optimizeWithAlns({ durations: matrix.durations, stops, params, maxPasses: 500, maxMillis: 20_000, alns: { maxIterations: 15_000, maxMillis: 12_000, noImprovementLimit: 4_000, preserveClusters: false, seed: s } });
      longBest = Math.min(longBest, cost(r.order));
    }
    ref = Math.min(longBest, ...costs.filter((_, i) => i !== 1));
    refKind = "long-search";
  }
  return {
    stops: n, referenceKind: refKind, reference: ref, exactMs,
    algorithms: NAMES.map((name, i) => ({
      name, cost: costs[i], gapPercent: round(((costs[i] - ref) / ref) * 100, 3), optimal: costs[i] <= ref + 1e-6,
      computeMs: round(times[i], 3),
      distanceKm: orders[i] ? round(sum(orders[i]!, matrix.distances) / 1000, 3) : null,
      drivingMin: orders[i] ? round(sum(orders[i]!, matrix.durations) / 60, 2) : null
    })),
    matrix, stops, params, ref
  };
}

async function main() {
  const beatRows = await prisma.beat.findMany({ select: { beatNumber: true, metadata: true } });
  const beatAnchor = new Map<number, { lat: number; lng: number }[]>();
  for (const b of beatRows) {
    const list = ((b.metadata as any)?.territorySource?.anchors ?? []) as { lat: number; lng: number }[];
    if (list.length) beatAnchor.set(Number(b.beatNumber), list);
  }
  // identical placement to scripts/accuracy-test.ts
  const placed = new Map<number, Pt>();
  const rnd = lcg(20260921);
  for (let n = 1; n <= 130; n++) {
    const list = beatAnchor.get(Math.ceil(n / 5));
    if (!list) continue;
    const base = list[(n - 1) % list.length];
    const ang = rnd() * 2 * Math.PI, rad = 60 + rnd() * 240;
    placed.set(n, { latitude: base.lat + (rad * Math.cos(ang)) / 111_000, longitude: base.lng + (rad * Math.sin(ang)) / (111_000 * Math.cos(base.lat * Math.PI / 180)) });
  }
  const beats = [...beatAnchor.keys()].sort((a, b) => a - b);
  const pointsOf = (k: number) => [...placed.entries()].filter(([n]) => beats.slice(0, k).includes(Math.ceil(n / 5))).map(([, p]) => p);
  const routing = new RoutingService({ baseUrl: OSRM, timeoutMs: 30_000 });

  const scaling: any[] = [];
  const sizes = [1, 2, 3, 4, 6, 8, 10, 14, beats.length];
  for (const k of sizes) {
    const t0 = Date.now();
    const r = await evaluateRound(routing, pointsOf(k), 300 + k);
    const { matrix: _m, stops: _s, params: _p, ref: _r, ...clean } = r;
    scaling.push({ beats: k, ...clean });
    console.log(`round of ${r.stops} stops done in ${Math.round((Date.now() - t0) / 1000)} s; production gap ${clean.algorithms[6].gapPercent}% in ${clean.algorithms[6].computeMs} ms`);
  }

  // What does more ALNS search buy? Two rounds, growing iteration budgets (clusters kept, as in production).
  const budget: any[] = [];
  for (const k of [10, beats.length]) {
    const r = await evaluateRound(routing, pointsOf(k), 300 + k);
    const cost = (o: readonly number[]) => evaluateRoute(o, r.matrix.durations, r.stops, r.params).total;
    const series: any[] = [];
    for (const it of [0, 50, 200, 500, 1000, 2500, 5000, 15000]) {
      const run = bench(() => optimizeWithAlns({ durations: r.matrix.durations, stops: r.stops, params: r.params, maxPasses: 500, maxMillis: 30_000, alns: { maxIterations: it, maxMillis: 30_000, noImprovementLimit: Math.max(1, it), preserveClusters: true } }));
      const c = cost(run.result.order);
      series.push({ iterations: it, gapPercent: round(((c - r.ref) / r.ref) * 100, 3), computeMs: round(run.ms, 2), stoppedBy: run.result.alns.stoppedBy });
    }
    budget.push({ stops: r.stops, series });
    console.log(`budget study ${r.stops} stops done`);
  }

  fs.writeFileSync(path.join(DATA, "algorithm-study.json"), JSON.stringify({ generatedAt: new Date().toISOString(), scaling, budget, algorithmNames: NAMES }, null, 1));
  console.log("written algorithm-study.json");
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });

/**
 * THE route optimizer: DBSCAN -> Nearest Neighbor -> 2-opt -> ALNS.
 *
 * The first three stages are optimizeClusteredOrder; optimizeWithAlns (bottom of this file) then hands that
 * route to ALNS (alns.ts), which searches for a cheaper one under the same cost function and returns the best it
 * found. The description below is of the first three stages.
 *
 * There is exactly one strategy in the application and this file is it. A postman's
 * round is planned neighbourhood by neighbourhood, so it never criss-crosses between
 * areas, and every stage works on the ROAD travel-time matrix and the one cost
 * function documented in routeAlgorithms.ts.
 *
 *   1. DBSCAN over the stop-to-stop road travel times (not raw coordinates): two stops
 *      are neighbours when the time between them (averaged over both directions) is
 *      <= eps seconds; a stop with at least minPts neighbours (itself included) is a
 *      core point and grows its cluster. Stops that belong to no cluster (noise) become
 *      single-stop clusters - they are never dropped. When no eps is configured, eps is
 *      derived from the data (k-distance rule, see autoEpsSeconds) so that "a
 *      neighbourhood" means the same thing in a dense city block and a spread-out beat.
 *   2. Cluster ordering: from the start, repeatedly go to the cluster holding the stop
 *      with the lowest Nearest-Neighbor key (load/priority-adjusted travel time).
 *   3. Nearest Neighbor inside each cluster, chained so each cluster begins where the
 *      previous one ended.
 *   4. 2-opt, in two levels, both on the FULL route cost:
 *        a. inside each cluster (reversals never cross a cluster boundary, so every
 *           cluster stays contiguous);
 *        b. over the cluster order (reverse a run of whole clusters, including the
 *           order inside them), repeated with (a) until nothing improves.
 *      A move is kept only if it strictly lowers the cost; and as a last line of defence
 *      the finished route is compared with the pre-2-opt route and REPLACED by it if it
 *      were ever more expensive (it cannot be, by construction - this is a guard, and it
 *      is unit-tested).
 *
 * Contiguity is deliberate: keeping clusters together gives compact, predictable
 * sub-rounds. The price is that a parcel can only move as early as its cluster's turn.
 */

import {
  CostBreakdown,
  CostParams,
  DEFAULT_COST_PARAMS,
  NnState,
  StopLoad,
  TwoOptResult,
  evaluateRoute,
  nearestNeighborFrom,
  nnKey,
  totalLoadOf,
  twoOpt
} from "./routeAlgorithms";
import { AlnsResult, alns } from "./alns";

/** Used only when no eps is configured AND there are too few stops to derive one. */
export const DEFAULT_DBSCAN_EPS_SECONDS = 300;
export const DEFAULT_DBSCAN_MIN_POINTS = 2;
/** Bounds for the data-derived eps: never so small that nothing clusters, never so
 * large that a whole city is one neighbourhood. */
export const MIN_AUTO_EPS_SECONDS = 60;
export const MAX_AUTO_EPS_SECONDS = 600;

const NOISE = -1;
const UNVISITED = -2;

/** Classic DBSCAN. minPts counts the point itself. O(n^2). */
export function dbscan(
  n: number,
  distance: (i: number, j: number) => number,
  eps: number,
  minPts: number
): { labels: number[]; clusterCount: number } {
  const labels = new Array<number>(n).fill(UNVISITED);
  let clusterCount = 0;

  const neighbours = (i: number): number[] => {
    const out: number[] = [];
    for (let j = 0; j < n; j++) if (distance(i, j) <= eps) out.push(j);
    return out;
  };

  for (let i = 0; i < n; i++) {
    if (labels[i] !== UNVISITED) continue;

    const seeds = neighbours(i);
    if (seeds.length < minPts) {
      labels[i] = NOISE;
      continue;
    }

    const id = clusterCount++;
    labels[i] = id;
    const queue = seeds.filter((j) => j !== i);

    while (queue.length > 0) {
      const j = queue.pop() as number;
      if (labels[j] === NOISE) labels[j] = id; // border point reached from a core point
      if (labels[j] !== UNVISITED) continue;
      labels[j] = id;
      const reach = neighbours(j);
      if (reach.length >= minPts) queue.push(...reach); // j is a core point: keep growing
    }
  }

  return { labels, clusterCount };
}

/** Road time between two stops, averaged over both directions (one-way streets). */
const symmetric = (durations: readonly (readonly number[])[]) => (i: number, j: number) =>
  (durations[i + 1][j + 1] + durations[j + 1][i + 1]) / 2;

/**
 * The classic DBSCAN k-distance rule, made deterministic: take every stop's distance to
 * its nearest (minPts - 1) neighbours, and set eps to 1.5 x the 75th percentile of those.
 * Most stops then have enough neighbours to be core points, while a gap clearly larger
 * than the typical spacing between neighbours (the space between two neighbourhoods)
 * still separates clusters. Clamped to [MIN_AUTO_EPS_SECONDS, MAX_AUTO_EPS_SECONDS].
 */
export function autoEpsSeconds(durations: readonly (readonly number[])[], n: number, minPts: number): number {
  if (n < 3) return DEFAULT_DBSCAN_EPS_SECONDS;
  const d = symmetric(durations);
  const k = Math.max(1, Math.min(minPts - 1, n - 1));

  const kDistances: number[] = [];
  for (let i = 0; i < n; i++) {
    const others: number[] = [];
    for (let j = 0; j < n; j++) if (j !== i) others.push(d(i, j));
    others.sort((a, b) => a - b);
    kDistances.push(others[k - 1]);
  }
  kDistances.sort((a, b) => a - b);
  const p75 = kDistances[Math.floor(0.75 * (kDistances.length - 1))];
  return Math.min(MAX_AUTO_EPS_SECONDS, Math.max(MIN_AUTO_EPS_SECONDS, 1.5 * p75));
}

export interface ClusteringResult {
  /** Stop indices per cluster; noise stops are appended as single-stop clusters. */
  clusters: number[][];
  /** Clusters DBSCAN actually found (excludes the single-stop noise ones). */
  densityClusters: number;
  noisePoints: number;
}

/** Clusters stops 0..n-1 using the (symmetrised) road travel time between them. */
export function clusterStops(
  durations: readonly (readonly number[])[],
  n: number,
  epsSeconds: number,
  minPts: number
): ClusteringResult {
  const { labels, clusterCount } = dbscan(n, symmetric(durations), epsSeconds, minPts);

  const clusters: number[][] = Array.from({ length: clusterCount }, () => []);
  const noise: number[] = [];
  labels.forEach((label, idx) => {
    if (label === NOISE) noise.push(idx);
    else clusters[label].push(idx);
  });

  return {
    clusters: [...clusters, ...noise.map((idx) => [idx])],
    densityClusters: clusterCount,
    noisePoints: noise.length
  };
}

const flatten = (blocks: readonly (readonly number[])[]): number[] => blocks.flatMap((b) => [...b]);

/** 2-opt over whole clusters: reverse a run of blocks (and the order inside them). */
function twoOptBlocks(
  initial: number[][],
  evaluate: (order: readonly number[]) => number,
  deadline: number,
  now: () => number,
  epsilon: number
): { blocks: number[][]; cost: number; improvements: number; timedOut: boolean } {
  let best = initial;
  let bestCost = evaluate(flatten(best));
  let improvements = 0;

  for (let pass = 0; pass < 100; pass++) {
    let improved = false;
    for (let a = 0; a < best.length - 1; a++) {
      for (let b = a + 1; b < best.length; b++) {
        if (now() > deadline) return { blocks: best, cost: bestCost, improvements, timedOut: true };
        const candidate = [
          ...best.slice(0, a),
          ...best
            .slice(a, b + 1)
            .reverse()
            .map((block) => [...block].reverse()),
          ...best.slice(b + 1)
        ];
        const cost = evaluate(flatten(candidate));
        if (cost < bestCost - epsilon) {
          best = candidate;
          bestCost = cost;
          improvements++;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  return { blocks: best, cost: bestCost, improvements, timedOut: false };
}

export interface ClusteredOptimizeInput {
  durations: readonly (readonly number[])[];
  stops: readonly StopLoad[];
  params?: CostParams;
  /** DBSCAN radius in seconds of road travel time. Omitted or <= 0: derived from the data. */
  epsSeconds?: number;
  minPts?: number;
  maxPasses?: number;
  maxMillis?: number;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
}

export interface ClusteredOptimizeResult {
  /** The DBSCAN + Nearest Neighbor route, before 2-opt. */
  initialOrder: number[];
  /** The final route. */
  order: number[];
  /** Cost of the stops in input order (what "no optimization" would cost). */
  inputOrderCost: CostBreakdown;
  /** Cost after DBSCAN + Nearest Neighbor, before 2-opt. */
  initialCost: CostBreakdown;
  /** Cost of the final route. Never above initialCost. */
  finalCost: CostBreakdown;
  twoOptPasses: number;
  twoOptImprovements: number;
  twoOptStoppedBy: TwoOptResult["stoppedBy"] | "NOT_RUN";
  /** True only if the guard had to discard 2-opt's result (it never should). */
  twoOptReverted: boolean;
  /** Final visiting order as contiguous clusters (blocks[k] is cluster k+1). */
  blocks: number[][];
  densityClusters: number;
  noisePoints: number;
  /** stop index -> 1-based position of its cluster in the visiting order. */
  clusterOfStop: number[];
  epsSeconds: number;
  epsAuto: boolean;
  minPts: number;
  optimizationMs: number;
}

export function optimizeClusteredOrder(input: ClusteredOptimizeInput): ClusteredOptimizeResult {
  const params = input.params ?? DEFAULT_COST_PARAMS;
  const { durations, stops } = input;
  const n = stops.length;
  const now = input.now ?? Date.now;
  const epsilon = 1e-6;
  const startedAt = now();
  const deadline = startedAt + (input.maxMillis ?? 1500);
  const maxPasses = input.maxPasses ?? 500;
  const minPts = input.minPts ?? DEFAULT_DBSCAN_MIN_POINTS;

  const evaluate = (order: readonly number[]) => evaluateRoute(order, durations, stops, params).total;
  const inputOrderCost = evaluateRoute(
    stops.map((_, i) => i),
    durations,
    stops,
    params
  );

  const epsAuto = !(input.epsSeconds !== undefined && input.epsSeconds > 0);
  const epsSeconds = epsAuto ? autoEpsSeconds(durations, n, minPts) : (input.epsSeconds as number);
  const { clusters, densityClusters, noisePoints } = clusterStops(durations, n, epsSeconds, minPts);

  // 2 + 3: order the clusters, and Nearest-Neighbor inside each one.
  const total = totalLoadOf(stops as StopLoad[]);
  let state: NnState = { prev: 0, clock: 0, remaining: total };
  const pending = new Set(clusters.map((_, i) => i));
  let blocks: number[][] = [];

  while (pending.size > 0) {
    let bestCluster = -1;
    let bestKey = Infinity;
    for (const c of pending) {
      const key = Math.min(...clusters[c].map((idx) => nnKey(durations, stops, params, state, total, idx)));
      if (key < bestKey) {
        bestKey = key;
        bestCluster = c;
      }
    }
    const run = nearestNeighborFrom(durations, stops, params, clusters[bestCluster], state);
    blocks.push(run.order);
    state = run.state;
    pending.delete(bestCluster);
  }

  const initialBlocks = blocks.map((b) => [...b]);
  const initialOrder = flatten(initialBlocks);
  const initialCost: CostBreakdown = evaluateRoute(initialOrder, durations, stops, params);

  const finish = (
    finalBlocks: number[][],
    passes: number,
    improvements: number,
    stoppedBy: ClusteredOptimizeResult["twoOptStoppedBy"],
    reverted: boolean
  ): ClusteredOptimizeResult => {
    const order = flatten(finalBlocks);
    const clusterOfStop = new Array<number>(n).fill(0);
    finalBlocks.forEach((block, k) => block.forEach((idx) => (clusterOfStop[idx] = k + 1)));
    return {
      initialOrder,
      order,
      inputOrderCost,
      initialCost,
      finalCost: evaluateRoute(order, durations, stops, params),
      twoOptPasses: passes,
      twoOptImprovements: improvements,
      twoOptStoppedBy: stoppedBy,
      twoOptReverted: reverted,
      blocks: finalBlocks,
      densityClusters,
      noisePoints,
      clusterOfStop,
      epsSeconds,
      epsAuto,
      minPts,
      optimizationMs: now() - startedAt
    };
  };

  if (n < 2) return finish(blocks, 0, 0, "NOT_RUN", false);

  // 4: 2-opt inside clusters, then over the cluster order, until stable.
  let passes = 0;
  let improvements = 0;
  let stoppedBy: TwoOptResult["stoppedBy"] = "CONVERGED";
  const noteStop = (s: TwoOptResult["stoppedBy"]) => {
    if (s === "TIME_LIMIT" || (s === "MAX_PASSES" && stoppedBy !== "TIME_LIMIT")) stoppedBy = s;
  };

  for (let round = 0; round < 5; round++) {
    // (a) inside each cluster: a reversal must stay within one block.
    const blockOf: number[] = [];
    blocks.forEach((block, k) => block.forEach(() => blockOf.push(k)));
    const intra = twoOpt(flatten(blocks), evaluate, {
      maxPasses,
      maxMillis: Math.max(0, deadline - now()),
      now,
      allowMove: (i, j) => blockOf[i] === blockOf[j]
    });
    passes += intra.passes;
    improvements += intra.improvements;
    noteStop(intra.stoppedBy);

    // Re-cut the (same-sized) blocks from the improved order.
    let offset = 0;
    blocks = blocks.map((block) => {
      const next = intra.order.slice(offset, offset + block.length);
      offset += block.length;
      return next;
    });

    // (b) reverse runs of whole clusters.
    const inter = twoOptBlocks(blocks, evaluate, deadline, now, epsilon);
    improvements += inter.improvements;
    if (inter.timedOut) noteStop("TIME_LIMIT");
    blocks = inter.blocks;

    if (inter.improvements === 0 || inter.timedOut || intra.stoppedBy === "TIME_LIMIT") break;
  }

  // Guard: 2-opt may only ever help. If its result were somehow dearer than what it
  // started from, keep the starting route.
  if (evaluate(flatten(blocks)) > initialCost.total + epsilon) {
    return finish(initialBlocks, passes, 0, stoppedBy, true);
  }
  return finish(blocks, passes, improvements, stoppedBy, false);
}

// ── the full pipeline: DBSCAN -> Nearest Neighbor -> 2-opt -> ALNS ─────────────────────────────

export interface AlnsSettings {
  maxIterations: number;
  maxMillis: number;
  noImprovementLimit: number;
  seed?: number;
  /** true: every DBSCAN cluster stays one unbroken run (see alns.ts). */
  preserveClusters: boolean;
}

export interface FullOptimizeInput extends ClusteredOptimizeInput {
  alns: AlnsSettings;
}

export interface FullOptimizeResult extends ClusteredOptimizeResult {
  /** Cost after DBSCAN + Nearest Neighbor + 2-opt (the ALNS starting point). */
  twoOptCost: CostBreakdown;
  /** The route after DBSCAN + NN + 2-opt, before ALNS. */
  twoOptOrder: number[];
  alns: AlnsResult;
  /** True only if ALNS's route had to be discarded for being dearer (it cannot be; this is a guard). */
  alnsReverted: boolean;
  /** Total time for the whole pipeline. */
  totalOptimizationMs: number;
}

/** Cluster runs of an order: a run is a maximal stretch of stops with the same label. */
function runsOf(order: readonly number[], labelOf: readonly number[]): number[][] {
  const runs: number[][] = [];
  for (const idx of order) {
    const last = runs[runs.length - 1];
    if (last && labelOf[last[0]] === labelOf[idx]) last.push(idx);
    else runs.push([idx]);
  }
  return runs;
}

/**
 * DBSCAN -> Nearest Neighbor -> 2-opt (optimizeClusteredOrder), then ALNS starting from that route.
 * The returned route is the best one found; its cost is never above the 2-opt route's.
 */
export function optimizeWithAlns(input: FullOptimizeInput): FullOptimizeResult {
  const params = input.params ?? DEFAULT_COST_PARAMS;
  const now = input.now ?? Date.now;
  const startedAt = now();
  const base = optimizeClusteredOrder(input);
  const evaluate = (order: readonly number[]) => evaluateRoute(order, input.durations, input.stops, params).total;

  const clusterOf = base.clusterOfStop; // stop -> 1-based cluster (run) number of the 2-opt route
  const preserve = input.alns.preserveClusters;

  // Local search used inside ALNS: 2-opt that (with preserved clusters) never crosses a cluster boundary.
  const polish = (order: readonly number[]): number[] => {
    const blockOf: number[] = [];
    runsOf(order, clusterOf).forEach((run, k) => run.forEach(() => blockOf.push(k)));
    return twoOpt(order, evaluate, {
      maxPasses: 3,
      maxMillis: Math.max(20, Math.min(150, input.alns.maxMillis / 10)),
      now,
      allowMove: preserve ? (i, j) => blockOf[i] === blockOf[j] : undefined
    }).order;
  };

  const result = alns({
    durations: input.durations,
    stops: input.stops,
    params,
    initialOrder: base.order,
    clusterOf,
    preserveClusters: preserve,
    maxIterations: input.alns.maxIterations,
    maxMillis: input.alns.maxMillis,
    noImprovementLimit: input.alns.noImprovementLimit,
    seed: input.alns.seed,
    now,
    polish
  });

  // The guard: ALNS only ever returns its best route, which starts as the 2-opt route.
  const alnsCost = evaluateRoute(result.order, input.durations, input.stops, params);
  const reverted = alnsCost.total > base.finalCost.total + 1e-6;
  const order = reverted ? base.order : result.order;
  const blocks = runsOf(order, clusterOf);
  const clusterOfStop = new Array<number>(input.stops.length).fill(0);
  blocks.forEach((block, k) => block.forEach((idx) => (clusterOfStop[idx] = k + 1)));

  return {
    ...base,
    order,
    blocks,
    clusterOfStop,
    twoOptCost: base.finalCost,
    twoOptOrder: base.order,
    finalCost: reverted ? base.finalCost : alnsCost,
    alns: result,
    alnsReverted: reverted,
    totalOptimizationMs: now() - startedAt
  };
}

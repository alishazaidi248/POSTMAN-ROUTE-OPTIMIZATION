/**
 * Pure route-construction and route-improvement algorithms (no I/O, no
 * database, no network) so they can be unit-tested exhaustively.
 *
 * PROBLEM
 *   One postman starts at node 0 (their location or the post office) and must
 *   visit stops 0..n-1 (matrix node = stop index + 1). The route is an open
 *   path — no forced return to the start.
 *
 * COST FUNCTION (documented because it is a design decision, not a detail)
 *
 *   cost(route) = travel + loadPenalty + priorityPenalty
 *
 *   travel          = Σ t(prev, stop)                       (seconds, from the
 *                       road travel-time matrix — never straight-line unless
 *                       routing was unavailable)
 *   loadPenalty     = loadWeight × Σ t(prev, stop) × R / L
 *                       R = parcels still on board while driving that leg
 *                           (this stop's parcels + every later stop's)
 *                       L = total parcels on the route
 *                     Driving a leg with a fuller bag costs more (effort /
 *                     battery on the electric fleet), so heavier drops are
 *                     pulled earlier and long legs are pushed to when the bag
 *                     is light. This is the load-dependent-cost formulation
 *                     used in energy-minimising vehicle routing; it is NOT
 *                     "distance × weight" — the load term depends on the
 *                     visiting ORDER, which is what makes it an optimisation.
 *   priorityPenalty = priorityWeight × Σ priorityFactor(stop) × arrivalTime(stop)
 *                     A weighted-completion-time term: HIGH/URGENT parcels
 *                     are penalised for waiting, NORMAL/LOW are not. Arrival
 *                     time includes the service (dwell) time of earlier stops.
 *
 *   With loadWeight = priorityWeight = 0 this collapses to plain shortest
 *   total travel time.
 *
 * ALGORITHM (the ONLY strategy in the application: DBSCAN -> Nearest Neighbor -> 2-opt)
 *   The three stages are orchestrated in clustering.ts; this file holds the cost
 *   function and the Nearest Neighbor / 2-opt primitives it is built from.
 *   - Nearest Neighbor: repeatedly append the unvisited stop with the lowest
 *     selection key  t x (1 + loadWeight x R/L) / (1 + priorityWeight x factor)
 *     - the load-adjusted leg cost, divided so that a HIGH/URGENT stop looks
 *     proportionally "closer" (a greedy step cannot see the future waiting cost of
 *     a delayed urgent parcel, so it is expressed this way). NN is only a starting
 *     point; 2-opt uses the exact full cost.
 *   - 2-opt: for every pair of positions (i, j) reverse the segment i..j; keep the
 *     reversal ONLY if the FULL route cost strictly drops; otherwise undo it. Repeat
 *     passes until no reversal helps, a pass limit is hit, or a wall-clock budget
 *     expires. The whole route is re-evaluated (O(n)) because the load and priority
 *     terms make an edge-only delta invalid.
 */

export interface StopLoad {
  /** Parcels carried for this stop (Delivery.parcelCount). */
  load: number;
  /** 0 for NORMAL/LOW; see PRIORITY_FACTOR. */
  priorityFactor: number;
  /** Dwell time at the stop, seconds. */
  serviceSeconds: number;
}

export interface CostParams {
  loadWeight: number;
  priorityWeight: number;
}

export const DEFAULT_LOAD_WEIGHT = 0.35;
export const DEFAULT_PRIORITY_WEIGHT = 0.25;

export const DEFAULT_COST_PARAMS: CostParams = {
  loadWeight: DEFAULT_LOAD_WEIGHT,
  priorityWeight: DEFAULT_PRIORITY_WEIGHT
};

export const PRIORITY_FACTOR: Record<string, number> = { LOW: 0, NORMAL: 0, HIGH: 1, URGENT: 3 };

export interface CostBreakdown {
  travel: number;
  loadPenalty: number;
  priorityPenalty: number;
  total: number;
}

function loadFraction(remaining: number, total: number): number {
  return total > 0 ? Math.max(0, remaining) / total : 0;
}

export function totalLoadOf(stops: StopLoad[]): number {
  return stops.reduce((sum, s) => sum + s.load, 0);
}

/** Full cost of visiting `order` (stop indices) from node 0. */
export function evaluateRoute(
  order: readonly number[],
  durations: readonly (readonly number[])[],
  stops: readonly StopLoad[],
  params: CostParams
): CostBreakdown {
  const total = totalLoadOf(stops as StopLoad[]);
  let remaining = total;
  let prev = 0;
  let clock = 0;
  let travel = 0;
  let loadPenalty = 0;
  let priorityPenalty = 0;

  for (const idx of order) {
    const node = idx + 1;
    const t = durations[prev][node];
    const stop = stops[idx];

    travel += t;
    loadPenalty += params.loadWeight * t * loadFraction(remaining, total);
    clock += t;
    priorityPenalty += params.priorityWeight * stop.priorityFactor * clock;

    clock += stop.serviceSeconds;
    remaining -= stop.load;
    prev = node;
  }

  return { travel, loadPenalty, priorityPenalty, total: travel + loadPenalty + priorityPenalty };
}

export interface NnState {
  /** Matrix node the route is currently at (0 = the start). */
  prev: number;
  /** Seconds elapsed (travel + service) so far. */
  clock: number;
  /** Parcels still on board. */
  remaining: number;
}

/** The greedy selection key described in the header: load-adjusted leg time,
 * divided so a HIGH/URGENT stop looks proportionally closer. */
export function nnKey(
  durations: readonly (readonly number[])[],
  stops: readonly StopLoad[],
  params: CostParams,
  state: NnState,
  total: number,
  idx: number
): number {
  const t = durations[state.prev][idx + 1];
  const carried = 1 + params.loadWeight * loadFraction(state.remaining, total);
  return (t * carried) / (1 + params.priorityWeight * stops[idx].priorityFactor);
}

/**
 * Nearest Neighbor over `candidates` only, continuing from `state`. Returns
 * the visiting order and the state after the last stop, so callers (the
 * DBSCAN variant) can chain several runs — one per cluster.
 */
export function nearestNeighborFrom(
  durations: readonly (readonly number[])[],
  stops: readonly StopLoad[],
  params: CostParams,
  candidates: readonly number[],
  start: NnState
): { order: number[]; state: NnState } {
  const total = totalLoadOf(stops as StopLoad[]);
  const unvisited = new Set<number>(candidates);
  const state: NnState = { ...start };
  const order: number[] = [];

  while (unvisited.size > 0) {
    let bestIdx = -1;
    let bestKey = Infinity;
    let bestTravel = Infinity;

    for (const idx of unvisited) {
      const t = durations[state.prev][idx + 1];
      const key = nnKey(durations, stops, params, state, total, idx);

      // Deterministic tie-break: lower key, then shorter leg, then lower
      // index — so identical/duplicate coordinates give a stable order.
      if (key < bestKey || (key === bestKey && (t < bestTravel || (t === bestTravel && idx < bestIdx)))) {
        bestIdx = idx;
        bestKey = key;
        bestTravel = t;
      }
    }

    const chosen = stops[bestIdx];
    state.clock += durations[state.prev][bestIdx + 1] + chosen.serviceSeconds;
    state.remaining -= chosen.load;
    state.prev = bestIdx + 1;
    order.push(bestIdx);
    unvisited.delete(bestIdx);
  }

  return { order, state };
}

/** Greedy construction over every stop (selection key documented in the header). */
export function nearestNeighborRoute(
  durations: readonly (readonly number[])[],
  stops: readonly StopLoad[],
  params: CostParams
): number[] {
  const all = stops.map((_, i) => i);
  return nearestNeighborFrom(durations, stops, params, all, {
    prev: 0,
    clock: 0,
    remaining: totalLoadOf(stops as StopLoad[])
  }).order;
}

function reverseInPlace(order: number[], i: number, j: number): void {
  while (i < j) {
    const tmp = order[i];
    order[i] = order[j];
    order[j] = tmp;
    i++;
    j--;
  }
}

export interface TwoOptOptions {
  maxPasses: number;
  maxMillis: number;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
  /** A reversal must beat the current cost by more than this to count. */
  epsilon?: number;
  /** When given, only reversals of positions i..j for which this returns true
   * are tried (the DBSCAN variant keeps every cluster contiguous this way). */
  allowMove?: (i: number, j: number) => boolean;
}

export interface TwoOptResult {
  order: number[];
  cost: number;
  passes: number;
  improvements: number;
  stoppedBy: "CONVERGED" | "MAX_PASSES" | "TIME_LIMIT";
}

/**
 * First-improvement 2-opt over an open path with a fixed start. `evaluate`
 * returns the FULL cost of an order, so any cost model (including the
 * order-dependent load/priority terms) is supported.
 */
export function twoOpt(
  initialOrder: readonly number[],
  evaluate: (order: readonly number[]) => number,
  options: TwoOptOptions
): TwoOptResult {
  const now = options.now ?? Date.now;
  const epsilon = options.epsilon ?? 1e-6;
  const order = [...initialOrder];
  const n = order.length;

  let bestCost = evaluate(order);
  let passes = 0;
  let improvements = 0;

  // 0 or 1 stops have exactly one order. (With 2 stops the swap is still tested.)
  if (n < 2) return { order, cost: bestCost, passes, improvements, stoppedBy: "CONVERGED" };

  const startedAt = now();

  for (;;) {
    if (passes >= options.maxPasses) {
      return { order, cost: bestCost, passes, improvements, stoppedBy: "MAX_PASSES" };
    }
    passes++;
    let improvedThisPass = false;

    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        if (options.allowMove && !options.allowMove(i, j)) continue;
        if (now() - startedAt > options.maxMillis) {
          return { order, cost: bestCost, passes, improvements, stoppedBy: "TIME_LIMIT" };
        }

        reverseInPlace(order, i, j);
        const candidateCost = evaluate(order);
        if (candidateCost < bestCost - epsilon) {
          bestCost = candidateCost;
          improvements++;
          improvedThisPass = true;
        } else {
          reverseInPlace(order, i, j); // undo
        }
      }
    }

    if (!improvedThisPass) {
      return { order, cost: bestCost, passes, improvements, stoppedBy: "CONVERGED" };
    }
  }
}

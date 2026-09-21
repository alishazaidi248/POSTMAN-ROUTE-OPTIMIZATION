/**
 * ALNS - Adaptive Large Neighborhood Search (Ropke & Pisinger, 2006), applied to the postman's route.
 *
 * It starts from the DBSCAN -> Nearest Neighbor -> 2-opt route and tries to find a cheaper one under
 * the SAME cost function (routeAlgorithms.ts: travel + load + priority, from the road travel-time
 * matrix). Each iteration:
 *
 *   1. picks a DESTROY operator and a REPAIR operator by roulette-wheel on their adaptive weights;
 *   2. removes q stops from the current route (destroy) and puts them back (repair);
 *   3. compares the new route with the current one using the exact cost;
 *   4. accepts or rejects it with a simulated-annealing criterion (a worse route may be accepted early on,
 *      which is how the search escapes the local optimum 2-opt is stuck in);
 *   5. rewards the operators that were used (new global best > better than current > accepted worse);
 *   6. every `segmentLength` iterations turns the collected rewards into new operator weights.
 *
 * The best route seen is tracked separately and is what is returned - never the last iteration - so the
 * result can never be worse than the route it started from.
 *
 * Destroy operators: random, worst, related (Shaw), cluster.
 * Repair operators : greedy, regret-2, regret-3.
 *
 * CLUSTERS. The route the pipeline builds keeps every DBSCAN cluster in one unbroken run (that is the point
 * of clustering: compact neighbourhood-by-neighbourhood rounds). With `preserveClusters` (the default) ALNS
 * keeps that guarantee: a removed stop can only be re-inserted inside its own cluster's run - or, when its
 * whole cluster was removed, between two other clusters. So ALNS can still reorder stops inside a cluster and
 * move a whole cluster to a better place, but it never scatters a cluster. With `preserveClusters: false` a
 * stop may go anywhere, and the cost function alone decides.
 *
 * SPEED. Inserting a stop changes every later arrival time and every later "remaining load", so a route's
 * cost is not local. But the change has a closed form (see InsertionContext): with prefix/suffix sums of the
 * current route the exact cost delta of inserting a stop at ANY position is O(1). Repair therefore costs
 * O(k x n) per round instead of O(k x n^2), and the tests check the closed form against the full cost
 * function. Acceptance always uses the full, exact cost of the candidate route.
 */

import { CostParams, DEFAULT_COST_PARAMS, StopLoad, evaluateRoute } from "./routeAlgorithms";

export const DESTROY_OPERATORS = ["random", "worst", "related", "cluster"] as const;
export const REPAIR_OPERATORS = ["greedy", "regret2", "regret3"] as const;
export type DestroyOperator = (typeof DESTROY_OPERATORS)[number];
export type RepairOperator = (typeof REPAIR_OPERATORS)[number];

export interface AlnsInput {
  /** Road travel times; node 0 = start, node i + 1 = stop i. */
  durations: readonly (readonly number[])[];
  stops: readonly StopLoad[];
  params?: CostParams;
  /** The route to improve (a permutation of 0..n-1). */
  initialOrder: readonly number[];
  /** stop -> DBSCAN cluster label. Enables the cluster operator and (with preserveClusters) contiguity. */
  clusterOf?: readonly number[];
  preserveClusters?: boolean;
  maxIterations: number;
  maxMillis: number;
  /** Stop after this many iterations in a row without a new best. */
  noImprovementLimit: number;
  /** Same seed -> same search (given the same limits). */
  seed?: number;
  /** Iterations per weight update. */
  segmentLength?: number;
  now?: () => number;
  /**
   * Optional local search (2-opt) applied to a candidate that beats the best so far, and once to the final
   * route. Its result is used only if it is strictly cheaper.
   */
  polish?: (order: readonly number[]) => number[];
}

export interface OperatorStats {
  used: number;
  newBest: number;
  improved: number;
  acceptedWorse: number;
  weight: number;
}

export interface AlnsResult {
  order: number[];
  initialCost: number;
  bestCost: number;
  iterations: number;
  /** How many times a new best route was found. */
  improvements: number;
  acceptedImproving: number;
  acceptedWorse: number;
  rejected: number;
  destroyUsage: Record<DestroyOperator, OperatorStats>;
  repairUsage: Record<RepairOperator, OperatorStats>;
  stoppedBy: "MAX_ITERATIONS" | "TIME_LIMIT" | "NO_IMPROVEMENT" | "NOT_RUN";
  runtimeMs: number;
  temperatureStart: number;
  temperatureEnd: number;
  clustersPreserved: boolean;
}

// ── deterministic random numbers ────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── exact insertion cost ────────────────────────────────────────────────────

/**
 * Prefix/suffix sums of a (partial) route that give the EXACT change in cost when one more stop is inserted at
 * any position, in O(1). With legs t_i, remaining parcels R_i, clock C_i before leg i, stop loads L, service
 * times s, priority factors f, total parcels T, and x inserted between prev and next (a = t(prev,x),
 * b = t(x,next), c = t(prev,next)):
 *
 *   travel   : a + b - c
 *   load     : (lw / T) * ( a*R_p + b*(R_p - L_x) - c*R_p - L_x * sum_{i>p} t_i )
 *   priority : pw * ( f_x * (C_p + a) + (a + s_x + b - c) * sum_{i>=p} f_i )
 *
 * (T is the total of ALL stops, as in evaluateRoute, so the numbers agree with the full cost function.)
 */
class InsertionContext {
  private readonly R: number[];
  private readonly C: number[];
  private readonly St: number[];
  private readonly F: number[];

  constructor(
    private readonly route: readonly number[],
    private readonly d: readonly (readonly number[])[],
    private readonly stops: readonly StopLoad[],
    private readonly params: CostParams,
    private readonly totalLoad: number
  ) {
    const m = route.length;
    this.R = new Array<number>(m + 1);
    this.C = new Array<number>(m + 1);
    this.St = new Array<number>(m + 1).fill(0);
    this.F = new Array<number>(m + 1).fill(0);

    const legs = new Array<number>(m);
    let prev = 0;
    for (let i = 0; i < m; i++) {
      legs[i] = d[prev][route[i] + 1];
      prev = route[i] + 1;
    }
    this.R[0] = totalLoad;
    this.C[0] = 0;
    for (let i = 0; i < m; i++) {
      const stop = stops[route[i]];
      this.R[i + 1] = this.R[i] - stop.load;
      this.C[i + 1] = this.C[i] + legs[i] + stop.serviceSeconds;
    }
    // St[p] = sum of legs strictly after the leg into position p
    for (let p = m - 1; p >= 0; p--) this.St[p] = (p + 1 < m ? this.St[p + 1] + legs[p + 1] : 0);
    for (let p = m - 1; p >= 0; p--) this.F[p] = this.F[p + 1] + stops[route[p]].priorityFactor;
  }

  /** Cost change of inserting stop x so that it sits at index p of the route. */
  delta(x: number, p: number): number {
    const { route, d, stops, params, totalLoad } = this;
    const m = route.length;
    const prev = p === 0 ? 0 : route[p - 1] + 1;
    const xn = x + 1;
    const a = d[prev][xn];
    let b = 0;
    let c = 0;
    if (p < m) {
      const next = route[p] + 1;
      b = d[xn][next];
      c = d[prev][next];
    }
    const stop = stops[x];
    const travel = a + b - c;
    const load =
      totalLoad > 0
        ? (params.loadWeight / totalLoad) * (a * this.R[p] + b * (this.R[p] - stop.load) - c * this.R[p] - stop.load * this.St[p])
        : 0;
    const shift = a + stop.serviceSeconds + b - c;
    const priority = params.priorityWeight * (stop.priorityFactor * (this.C[p] + a) + shift * this.F[p]);
    return travel + load + priority;
  }
}

// ── the search ──────────────────────────────────────────────────────────────

const MIN_WEIGHT = 0.1;
const SCORE_NEW_BEST = 33;
const SCORE_IMPROVED = 9;
const SCORE_ACCEPTED = 3;
const REACTION = 0.5;
/** Regret value given to a stop that has fewer feasible positions than k: it must go in first. */
const NO_OPTION = 1e9;

class Operators<T extends string> {
  readonly stats: Record<T, OperatorStats>;
  private readonly score: Record<T, number>;
  private readonly uses: Record<T, number>;

  constructor(private readonly names: readonly T[]) {
    const blank = (): OperatorStats => ({ used: 0, newBest: 0, improved: 0, acceptedWorse: 0, weight: 1 });
    this.stats = Object.fromEntries(names.map((n) => [n, blank()])) as Record<T, OperatorStats>;
    this.score = Object.fromEntries(names.map((n) => [n, 0])) as Record<T, number>;
    this.uses = Object.fromEntries(names.map((n) => [n, 0])) as Record<T, number>;
  }

  /** Roulette wheel over the current weights. */
  pick(rand: () => number, allowed: readonly T[] = this.names): T {
    const total = allowed.reduce((s, n) => s + this.stats[n].weight, 0);
    let r = rand() * total;
    for (const n of allowed) {
      r -= this.stats[n].weight;
      if (r <= 0) return n;
    }
    return allowed[allowed.length - 1];
  }

  used(name: T) {
    this.stats[name].used++;
    this.uses[name]++;
  }

  reward(name: T, outcome: "newBest" | "improved" | "acceptedWorse" | "rejected") {
    if (outcome === "newBest") {
      this.stats[name].newBest++;
      this.score[name] += SCORE_NEW_BEST;
    } else if (outcome === "improved") {
      this.stats[name].improved++;
      this.score[name] += SCORE_IMPROVED;
    } else if (outcome === "acceptedWorse") {
      this.stats[name].acceptedWorse++;
      this.score[name] += SCORE_ACCEPTED;
    }
  }

  /** End of a segment: w = (1 - rho) * w + rho * score / uses, then the scores restart. */
  updateWeights() {
    for (const n of this.names) {
      if (this.uses[n] > 0) {
        this.stats[n].weight = Math.max(MIN_WEIGHT, (1 - REACTION) * this.stats[n].weight + (REACTION * this.score[n]) / this.uses[n]);
      }
      this.score[n] = 0;
      this.uses[n] = 0;
    }
  }
}

export function alns(input: AlnsInput): AlnsResult {
  const params = input.params ?? DEFAULT_COST_PARAMS;
  const { durations: d, stops } = input;
  const n = stops.length;
  const now = input.now ?? Date.now;
  const startedAt = now();
  const rand = mulberry32(input.seed ?? 20260921);
  const totalLoad = stops.reduce((s, x) => s + x.load, 0);
  const cost = (order: readonly number[]) => evaluateRoute(order, d, stops, params).total;

  const clusterOf = input.clusterOf;
  const keepClusters = !!clusterOf && input.preserveClusters !== false;

  const destroyOps = new Operators<DestroyOperator>(DESTROY_OPERATORS);
  const repairOps = new Operators<RepairOperator>(REPAIR_OPERATORS);

  let current = [...input.initialOrder];
  const initialCost = cost(current);
  let currentCost = initialCost;
  let best = [...current];
  let bestCost = initialCost;

  const result = (stoppedBy: AlnsResult["stoppedBy"], iterations: number, counters: Counters, t0: number, tEnd: number): AlnsResult => ({
    order: best,
    initialCost,
    bestCost,
    iterations,
    improvements: counters.improvements,
    acceptedImproving: counters.acceptedImproving,
    acceptedWorse: counters.acceptedWorse,
    rejected: counters.rejected,
    destroyUsage: destroyOps.stats,
    repairUsage: repairOps.stats,
    stoppedBy,
    runtimeMs: now() - startedAt,
    temperatureStart: t0,
    temperatureEnd: tEnd,
    clustersPreserved: keepClusters
  });
  interface Counters {
    improvements: number;
    acceptedImproving: number;
    acceptedWorse: number;
    rejected: number;
  }
  const counters: Counters = { improvements: 0, acceptedImproving: 0, acceptedWorse: 0, rejected: 0 };

  // Nothing to search with fewer than 3 stops (there is at most one non-trivial order to compare).
  if (n < 3 || input.maxIterations <= 0 || input.maxMillis <= 0) return result("NOT_RUN", 0, counters, 0, 0);

  // ── annealing schedule: a route 5% worse than the start is accepted with probability 1/2 at first ──
  const t0 = Math.max((0.05 * initialCost) / Math.LN2, 1e-9);
  const tEndTarget = t0 * 1e-3;
  const segmentLength = input.segmentLength ?? 50;

  const minRemove = Math.min(n, Math.max(2, Math.ceil(0.1 * n)));
  const maxRemove = Math.min(n, Math.max(minRemove, Math.min(Math.ceil(0.4 * n), 25)));

  const sym = (i: number, j: number) => (d[i + 1][j + 1] + d[j + 1][i + 1]) / 2;
  let maxSym = 1e-9;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) maxSym = Math.max(maxSym, sym(i, j));

  // ── destroy ──
  const arrivals = (order: readonly number[]): number[] => {
    const at = new Array<number>(n).fill(0);
    let clock = 0;
    let prev = 0;
    for (const idx of order) {
      clock += d[prev][idx + 1];
      at[idx] = clock;
      clock += stops[idx].serviceSeconds;
      prev = idx + 1;
    }
    return at;
  };

  function destroy(kind: DestroyOperator, order: readonly number[], q: number): number[] {
    const m = order.length;
    q = Math.min(q, m);
    if (kind === "random") {
      const pool = [...order];
      const out: number[] = [];
      for (let k = 0; k < q; k++) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
      return out;
    }
    if (kind === "worst") {
      // the stops whose removal would save the most (Ropke's worst removal, with a little randomness)
      const gains = order.map((idx, position) => ({ idx, gain: currentCost - cost([...order.slice(0, position), ...order.slice(position + 1)]) }));
      gains.sort((a, b) => b.gain - a.gain);
      const out: number[] = [];
      while (out.length < q && gains.length > 0) {
        const pick = Math.floor(Math.pow(rand(), 3) * gains.length);
        out.push(gains.splice(pick, 1)[0].idx);
      }
      return out;
    }
    if (kind === "related") {
      // Shaw removal: a random seed stop, then the stops most related to it (close in road time,
      // in arrival time and in priority)
      const at = arrivals(order);
      const horizon = Math.max(1, ...at);
      const seed = order[Math.floor(rand() * m)];
      const related = (i: number) =>
        sym(seed, i) / maxSym + 0.5 * (Math.abs(at[seed] - at[i]) / horizon) + 0.25 * (stops[seed].priorityFactor === stops[i].priorityFactor ? 0 : 1);
      const rest = order.filter((i) => i !== seed).sort((a, b) => related(a) - related(b));
      const out = [seed];
      while (out.length < q && rest.length > 0) out.push(rest.splice(Math.floor(Math.pow(rand(), 3) * rest.length), 1)[0]);
      return out;
    }
    // cluster removal: a whole DBSCAN cluster (or a random part of it when it is bigger than q)
    if (clusterOf) {
      const present = [...new Set(order.map((i) => clusterOf[i]))];
      const label = present[Math.floor(rand() * present.length)];
      const members = order.filter((i) => clusterOf[i] === label);
      if (members.length > q) {
        const out: number[] = [];
        while (out.length < q) out.push(members.splice(Math.floor(rand() * members.length), 1)[0]);
        return out;
      }
      // a small cluster: take its nearest neighbours too, so that something can actually move
      const out = [...members];
      const others = order.filter((i) => clusterOf[i] !== label).sort((a, b) => sym(members[0], a) - sym(members[0], b));
      while (out.length < minRemove && others.length > 0) out.push(others.shift() as number);
      return out;
    }
    // no clusters known: a contiguous stretch of the route
    const start = Math.floor(rand() * Math.max(1, m - q + 1));
    return order.slice(start, start + q);
  }

  // ── repair ──
  /** Indices at which x may be inserted into `route`. */
  function positions(route: readonly number[], x: number): number[] {
    const m = route.length;
    const all = (): number[] => Array.from({ length: m + 1 }, (_, p) => p);
    if (!keepClusters || !clusterOf) return all();
    const label = clusterOf[x];
    let first = -1;
    let last = -1;
    for (let i = 0; i < m; i++) {
      if (clusterOf[route[i]] === label) {
        if (first < 0) first = i;
        last = i;
      }
    }
    if (first >= 0) return Array.from({ length: last - first + 2 }, (_, k) => first + k); // inside (or at the edges of) its own run
    // the cluster is absent: any gap between two clusters
    const gaps: number[] = [0];
    for (let p = 1; p < m; p++) if (clusterOf[route[p - 1]] !== clusterOf[route[p]]) gaps.push(p);
    if (m > 0) gaps.push(m);
    return gaps;
  }

  function repair(kind: RepairOperator, partial: number[], removed: readonly number[]): number[] {
    const route = [...partial];
    const pending = [...removed];
    const k = kind === "regret3" ? 3 : kind === "regret2" ? 2 : 1;

    while (pending.length > 0) {
      const ctx = new InsertionContext(route, d, stops, params, totalLoad);
      let chosen = -1;
      let chosenPos = 0;
      let chosenScore = -Infinity;
      let chosenBest = Infinity;

      for (let pi = 0; pi < pending.length; pi++) {
        const x = pending[pi];
        // best insertion cost per position, cheapest first
        const options = positions(route, x)
          .map((p) => ({ p, c: ctx.delta(x, p) }))
          .sort((a, b) => a.c - b.c);
        const best1 = options[0];
        let score: number;
        if (k === 1) score = -best1.c; // greedy: the cheapest insertion overall
        else {
          score = 0;
          for (let j = 1; j < k; j++) score += j < options.length ? options[j].c - best1.c : NO_OPTION;
        }
        if (score > chosenScore + 1e-12 || (Math.abs(score - chosenScore) <= 1e-12 && best1.c < chosenBest)) {
          chosenScore = score;
          chosenBest = best1.c;
          chosen = pi;
          chosenPos = best1.p;
        }
      }
      route.splice(chosenPos, 0, pending[chosen]);
      pending.splice(chosen, 1);
    }
    return route;
  }

  // ── main loop ──
  let sinceBest = 0;
  let iteration = 0;
  let stoppedBy: AlnsResult["stoppedBy"] = "MAX_ITERATIONS";
  let temperature = t0;
  let tEnd = t0;

  for (; iteration < input.maxIterations; iteration++) {
    const elapsed = now() - startedAt;
    if (elapsed >= input.maxMillis) {
      stoppedBy = "TIME_LIMIT";
      break;
    }
    if (sinceBest >= input.noImprovementLimit) {
      stoppedBy = "NO_IMPROVEMENT";
      break;
    }

    const progress = Math.min(1, Math.max(iteration / input.maxIterations, elapsed / input.maxMillis));
    temperature = t0 * Math.pow(tEndTarget / t0, progress);
    tEnd = temperature;

    const destroyKind = destroyOps.pick(rand);
    const repairKind = repairOps.pick(rand);
    destroyOps.used(destroyKind);
    repairOps.used(repairKind);

    const q = minRemove + Math.floor(rand() * (maxRemove - minRemove + 1));
    const removed = destroy(destroyKind, current, q);
    const removedSet = new Set(removed);
    let candidate = repair(
      repairKind,
      current.filter((i) => !removedSet.has(i)),
      removed
    );
    let candidateCost = cost(candidate);

    // a candidate that beats the best gets a local-search pass (2-opt) before it is compared
    if (candidateCost < bestCost - 1e-9 && input.polish) {
      const polished = input.polish(candidate);
      const polishedCost = cost(polished);
      if (polishedCost < candidateCost - 1e-9) {
        candidate = polished;
        candidateCost = polishedCost;
      }
    }

    // Outcome (for the operators' reward) and whether the search moves to the candidate.
    let outcome: "newBest" | "improved" | "acceptedWorse" | "rejected";
    let moveTo = true;
    if (candidateCost < bestCost - 1e-9) {
      outcome = "newBest";
      best = [...candidate];
      bestCost = candidateCost;
      counters.improvements++;
      sinceBest = 0;
    } else {
      sinceBest++;
      if (candidateCost < currentCost - 1e-9) outcome = "improved";
      else if (candidateCost <= currentCost + 1e-9) {
        outcome = "rejected"; // the same cost: move (it diversifies the search) but earn no reward
      } else if (rand() < Math.exp(-(candidateCost - currentCost) / temperature)) outcome = "acceptedWorse";
      else {
        outcome = "rejected";
        moveTo = false;
      }
    }

    if (!moveTo) counters.rejected++;
    else {
      current = candidate;
      currentCost = candidateCost;
      if (outcome === "acceptedWorse") counters.acceptedWorse++;
      else counters.acceptedImproving++;
    }
    destroyOps.reward(destroyKind, outcome);
    repairOps.reward(repairKind, outcome);

    if ((iteration + 1) % segmentLength === 0) {
      destroyOps.updateWeights();
      repairOps.updateWeights();
    }
  }

  // final local search on the best route; used only if strictly cheaper
  if (input.polish) {
    const polished = input.polish(best);
    const polishedCost = cost(polished);
    if (polishedCost < bestCost - 1e-9) {
      best = polished;
      bestCost = polishedCost;
      counters.improvements++;
    }
  }

  return result(stoppedBy, iteration, counters, t0, tEnd);
}

/** Exposed for the tests: the closed-form insertion delta against the full cost function. */
export function insertionDelta(
  route: readonly number[],
  x: number,
  position: number,
  durations: readonly (readonly number[])[],
  stops: readonly StopLoad[],
  params: CostParams
): number {
  const total = stops.reduce((s, st) => s + st.load, 0);
  return new InsertionContext(route, durations, stops, params, total).delta(x, position);
}

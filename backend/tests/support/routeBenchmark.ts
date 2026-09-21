/**
 * Deterministic benchmark of the route pipeline, shared by tests/routeBenchmark.test.ts and
 * scripts/benchmark-route.ts.
 *
 * Every stage is measured on the SAME round, the SAME road travel-time / distance matrix and the SAME
 * cost function (routeAlgorithms.evaluateRoute). Nothing here is an expected number: the figures come out
 * of running the code. The matrix is synthetic (a Manhattan-like street grid with one river that is costly
 * to cross), because a benchmark that depends on a public routing server is neither repeatable nor
 * offline; `npm run route:alns` measures the same pipeline against the real OSRM.
 *
 *   1  input order                     (what no optimization gives)
 *   2  Nearest Neighbor
 *   3  Nearest Neighbor + 2-opt        (no clustering)
 *   4  DBSCAN + Nearest Neighbor
 *   5  DBSCAN + Nearest Neighbor + 2-opt        <- the ALNS starting route
 *   6  DBSCAN + Nearest Neighbor + 2-opt + ALNS <- the production route
 *
 * Stages 4-6 come from optimizeWithAlns(), the function the production planner calls; runRound() also plans
 * the same round through planRouteFromInputs() (the production entry point) and reports whether it produced
 * exactly the stage-6 route, so the benchmark provably measures what production runs.
 */
import { AlnsSettings, optimizeWithAlns } from "../../src/services/optimization/clustering";
import {
  DEFAULT_COST_PARAMS,
  PRIORITY_FACTOR,
  StopLoad,
  evaluateRoute,
  nearestNeighborRoute,
  twoOpt
} from "../../src/services/optimization/routeAlgorithms";
import {
  PlanInput,
  RoutableDelivery,
  planRouteFromInputs
} from "../../src/services/optimization/RoadRouteOptimizationService";
import { RoutingService } from "../../src/services/optimization/routing";

export type Pt = { latitude: number; longitude: number };

export const START = { latitude: 19.1436, longitude: 72.9345, source: "POST_OFFICE" as const };

/** Settings of the production ALNS stage (env defaults), without the wall-clock cap so the result is repeatable. */
export const PRODUCTION_ALNS: AlnsSettings = {
  maxIterations: 2500,
  maxMillis: 600_000,
  noImprovementLimit: 600,
  preserveClusters: true
};

function lcg(seed: number) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
}

/**
 * n deliveries over a Bhandup-sized area: about three in four sit in a handful of neighbourhoods (so DBSCAN
 * has clusters to find), the rest are isolated. Mixed priorities, parcel counts and service times.
 */
export function makeRound(n: number, seed: number): RoutableDelivery[] {
  const rnd = lcg(seed);
  const centres = Array.from({ length: Math.max(2, Math.round(n / 8)) }, () => ({
    latitude: 19.11 + rnd() * 0.07,
    longitude: 72.9 + rnd() * 0.09
  }));
  return Array.from({ length: n }, (_, i) => {
    const clustered = rnd() < 0.75;
    const c = centres[Math.floor(rnd() * centres.length)];
    return {
      id: `d${i}`,
      latitude: clustered ? c.latitude + (rnd() - 0.5) * 0.004 : 19.11 + rnd() * 0.07,
      longitude: clustered ? c.longitude + (rnd() - 0.5) * 0.004 : 72.9 + rnd() * 0.09,
      parcelCount: 1 + Math.floor(rnd() * 5),
      weightKg: 0.5 + Math.floor(rnd() * 9) * 0.5,
      priority: ["LOW", "NORMAL", "NORMAL", "HIGH", "URGENT"][Math.floor(rnd() * 5)],
      serviceTimeMinutes: 2 + Math.floor(rnd() * 4)
    };
  });
}

const RIVER_LATITUDE = 19.145;

const crossesRiver = (a: Pt, b: Pt) => (a.latitude - RIVER_LATITUDE) * (b.latitude - RIVER_LATITUDE) < 0;

/** Street-grid metres between two points: the L1 distance with a 1.25 detour, plus a bridge detour over the river. */
export function roadMeters(a: Pt, b: Pt): number {
  const dLat = Math.abs(a.latitude - b.latitude) * 111_000;
  const dLng = Math.abs(a.longitude - b.longitude) * 111_000 * Math.cos((19.13 * Math.PI) / 180);
  return (dLat + dLng) * 1.25 + (crossesRiver(a, b) ? 900 : 0);
}

/** Seconds at 7 m/s (about 25 km/h), plus a fixed 2 minutes at the bridge. */
export function roadSeconds(a: Pt, b: Pt): number {
  return roadMeters(a, b) / 7 + (crossesRiver(a, b) ? 120 : 0);
}

/** A stand-in for OSRM's /table and /route that answers from the functions above (like the real one, it honours sources/destinations). */
export function fakeOsrm(maxTablePoints?: number): RoutingService {
  const httpGet = async (url: string): Promise<unknown> => {
    const [path, query = ""] = url.split("/").pop()!.split("?");
    const pts: Pt[] = path.split(";").map((c) => {
      const [lng, lat] = c.split(",").map(Number);
      return { latitude: lat, longitude: lng };
    });
    if (url.includes("/table/")) {
      const params = new URLSearchParams(query);
      const idx = (name: string) => (params.get(name) ? params.get(name)!.split(";").map(Number) : pts.map((_, i) => i));
      const src = idx("sources");
      const dst = idx("destinations");
      return {
        code: "Ok",
        durations: src.map((i) => dst.map((j) => (i === j ? 0 : roadSeconds(pts[i], pts[j])))),
        distances: src.map((i) => dst.map((j) => (i === j ? 0 : roadMeters(pts[i], pts[j]))))
      };
    }
    return {
      code: "Ok",
      routes: [{ distance: 1, duration: 1, geometry: { type: "LineString", coordinates: pts.map((p) => [p.longitude, p.latitude]) } }]
    };
  };
  return new RoutingService({ baseUrl: "http://osrm.test", httpGet, maxTablePoints });
}

export interface Stage {
  name: string;
  order: number[];
  /** The one cost function: driving time + load penalty + priority penalty. */
  cost: number;
  distanceKm: number;
  travelMinutes: number;
  /** null: not separable from the next stage (DBSCAN + NN and its 2-opt come out of one call). */
  runtimeMs: number | null;
}

export interface RoundReport {
  stops: number;
  stages: Stage[];
  /** How much ALNS took off the DBSCAN + NN + 2-opt cost, percent (0 when it found nothing better). */
  alnsOver2OptPercent: number;
  alnsOverNnPercent: number;
  alnsOverInputPercent: number;
  alnsIterations: number;
  alnsImprovements: number;
  alnsStoppedBy: string;
  /** planRouteFromInputs (the production entry point) produced exactly the last stage's route. */
  productionMatches: boolean;
  productionCost: number;
}

const round = (value: number, digits = 2) => {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
};
const percentLower = (before: number, after: number) => (before > 0 ? round(((before - after) / before) * 100) : 0);

function build(deliveries: RoutableDelivery[]) {
  const nodes: Pt[] = [START, ...deliveries];
  const n = nodes.length;
  const durations = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : roadSeconds(nodes[i], nodes[j]))));
  const distances = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : roadMeters(nodes[i], nodes[j]))));
  const stops: StopLoad[] = deliveries.map((d) => ({
    load: d.weightKg!,
    priorityFactor: PRIORITY_FACTOR[d.priority] ?? 0,
    serviceSeconds: (d.serviceTimeMinutes ?? 0) * 60
  }));
  return { durations, distances, stops };
}

const pathSum = (order: readonly number[], matrix: readonly (readonly number[])[]) => {
  let prev = 0;
  let sum = 0;
  for (const idx of order) {
    sum += matrix[prev][idx + 1];
    prev = idx + 1;
  }
  return sum;
};

export async function runRound(
  n: number,
  seed: number,
  alnsSettings: AlnsSettings = PRODUCTION_ALNS,
  plan: Partial<PlanInput> = {}
): Promise<RoundReport> {
  const deliveries = makeRound(n, seed);
  const { durations, distances, stops } = build(deliveries);
  const params = DEFAULT_COST_PARAMS;
  const cost = (order: readonly number[]) => evaluateRoute(order, durations, stops, params).total;
  const stage = (name: string, order: number[], runtimeMs: number | null): Stage => ({
    name,
    order,
    cost: cost(order),
    distanceKm: pathSum(order, distances) / 1000,
    travelMinutes: pathSum(order, durations) / 60,
    runtimeMs
  });
  const timed = <T>(fn: () => T): [T, number] => {
    const t0 = performance.now();
    const value = fn();
    return [value, performance.now() - t0];
  };

  const inputOrder = stops.map((_, i) => i);
  const [nn, nnMs] = timed(() => nearestNeighborRoute(durations, stops, params));
  const [nn2, nn2Ms] = timed(() => twoOpt(nn, cost, { maxPasses: 500, maxMillis: 600_000 }).order);
  const [full, fullMs] = timed(() =>
    optimizeWithAlns({ durations, stops, params, maxPasses: 500, maxMillis: 600_000, alns: alnsSettings })
  );

  const stages = [
    stage("Original (input order)", inputOrder, 0),
    stage("NN", nn, nnMs),
    stage("NN + 2-opt", nn2, nnMs + nn2Ms),
    stage("DBSCAN + NN", full.initialOrder, null),
    stage("DBSCAN + NN + 2-opt", full.twoOptOrder, full.optimizationMs),
    stage("DBSCAN + NN + 2-opt + ALNS", full.order, fullMs)
  ];

  // The production entry point, given the same round and the same road answers.
  const production = await planRouteFromInputs(
    { postmanId: "p", beatId: "b", start: START, deliveries, maxPasses: 500, maxMillis: 600_000, alns: alnsSettings, ...plan },
    fakeOsrm()
  );
  const byId = new Map(deliveries.map((d, i) => [d.id, i]));
  const productionOrder = production.stops.map((s) => byId.get(s.deliveryId) as number);

  const twoOptStage = stages[4];
  const alnsStage = stages[5];
  return {
    stops: n,
    stages,
    alnsOver2OptPercent: percentLower(twoOptStage.cost, alnsStage.cost),
    alnsOverNnPercent: percentLower(stages[1].cost, alnsStage.cost),
    alnsOverInputPercent: percentLower(stages[0].cost, alnsStage.cost),
    alnsIterations: full.alns.iterations,
    alnsImprovements: full.alns.improvements,
    alnsStoppedBy: full.alns.stoppedBy,
    productionMatches: productionOrder.length === n && productionOrder.every((v, i) => v === full.order[i]),
    productionCost: production.metrics.totalCost
  };
}

/** A round in the layout asked for: one block per stage, then the ALNS improvement. */
export function formatRound(r: RoundReport): string {
  const lines = [`Dataset: ${r.stops} deliveries`, ""];
  for (const s of r.stages) {
    lines.push(`${s.name}:`);
    lines.push(`  Distance: ${s.distanceKm.toFixed(2)} km`);
    lines.push(`  Travel time: ${s.travelMinutes.toFixed(1)} min`);
    lines.push(`  Cost: ${s.cost.toFixed(0)}`);
    lines.push(`  Runtime: ${s.runtimeMs === null ? "(included in the next stage)" : `${s.runtimeMs.toFixed(1)} ms`}`);
    lines.push("");
  }
  lines.push(`ALNS improvement over 2-opt: ${r.alnsOver2OptPercent}%   (over NN: ${r.alnsOverNnPercent}%, over input order: ${r.alnsOverInputPercent}%)`);
  lines.push(`ALNS: ${r.alnsIterations} iterations, ${r.alnsImprovements} new best routes, stopped by ${r.alnsStoppedBy}`);
  lines.push(`Production entry point returned the same route: ${r.productionMatches ? "yes" : "NO"}`);
  return lines.join("\n");
}

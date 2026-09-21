/**
 * The five route algorithms on the REAL Bhandup West deliveries, with REAL road times from the routing engine (OSRM):
 *
 *   input order · Nearest Neighbor · NN + 2-opt · DBSCAN + NN + 2-opt · DBSCAN + NN + 2-opt + ALNS
 *
 *   DATABASE_URL=... OSRM_BASE_URL=... npx tsx scripts/benchmark-bhandup.ts   ->  backend/data/bhandup/routing-benchmark.json
 *
 * Rounds: the 130 deliveries as ONE round, and five rounds of 26 (beats 1-5, 6-10, ...). Everything is measured on this machine
 * with the production ALNS settings (1.5 s wall-clock cap). Nothing is estimated and nothing is tuned to look better: if ALNS does
 * not improve on 2-opt, the report says so.
 *
 * Read it with one fact in mind: the geocoder returned AREA / PINCODE level points for these addresses, so the 130 stops sit on
 * very few distinct coordinates (`distinctCoordinates` below). The problem is real road times between those points, but the
 * stops within one point are at distance zero - the benchmark says how the algorithms order the places, not the houses.
 */
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../src/config/prisma";
import { env } from "../src/config/env";
import { optimizeWithAlns } from "../src/services/optimization/clustering";
import { DEFAULT_COST_PARAMS, PRIORITY_FACTOR, StopLoad, evaluateRoute, nearestNeighborRoute, twoOpt } from "../src/services/optimization/routeAlgorithms";
import { getRoutingService } from "../src/services/optimization/routing";

const OUT = path.join(__dirname, "..", "data", "bhandup", "routing-benchmark.json");
const START = { latitude: 19.1436, longitude: 72.9345 }; // Bhandup West post office
const ALNS = { maxIterations: env.alnsMaxIterations, maxMillis: env.alnsMaxMs, noImprovementLimit: env.alnsNoImprovementLimit, preserveClusters: env.alnsPreserveClusters };

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const percentLower = (before: number, after: number) => (before > 0 ? round(((before - after) / before) * 100) : 0);

async function benchmark(label: string, points: { id: string; latitude: number; longitude: number; priority: string; serviceMinutes: number }[]) {
  const routing = getRoutingService();
  const nodes = [START, ...points];
  const matrix = await routing.getMatrix(nodes);
  const { durations, distances } = matrix;
  const stops: StopLoad[] = points.map((p) => ({ load: 0, priorityFactor: PRIORITY_FACTOR[p.priority] ?? 0, serviceSeconds: p.serviceMinutes * 60 }));
  // no delivery has a weight in this data set: the load term is off, exactly as the production planner does
  const params = { ...DEFAULT_COST_PARAMS, loadWeight: 0 };
  const cost = (order: readonly number[]) => evaluateRoute(order, durations, stops, params).total;
  const pathSum = (order: readonly number[], m: readonly (readonly number[])[]) => {
    let prev = 0, sum = 0;
    for (const i of order) { sum += m[prev][i + 1]; prev = i + 1; }
    return sum;
  };
  const stage = (name: string, order: number[], ms: number | null) => ({
    name, cost: round(cost(order), 1), distanceKm: round(pathSum(order, distances) / 1000), travelMinutes: round(pathSum(order, durations) / 60, 1), runtimeMs: ms === null ? null : round(ms, 1)
  });
  const timed = <T>(fn: () => T): [T, number] => { const t0 = performance.now(); const v = fn(); return [v, performance.now() - t0]; };

  const input = stops.map((_, i) => i);
  const [nn, nnMs] = timed(() => nearestNeighborRoute(durations, stops, params));
  const [nn2, nn2Ms] = timed(() => twoOpt(nn, cost, { maxPasses: 500, maxMillis: env.twoOptMaxMillis }).order);
  const [full, fullMs] = timed(() => optimizeWithAlns({ durations, stops, params, maxPasses: 500, maxMillis: env.twoOptMaxMillis, alns: ALNS }));
  const stages = [
    stage("Input order", input, 0),
    stage("Nearest Neighbor", nn, nnMs),
    stage("NN + 2-opt", nn2, nnMs + nn2Ms),
    stage("DBSCAN + NN + 2-opt", full.twoOptOrder, full.optimizationMs),
    stage("DBSCAN + NN + 2-opt + ALNS", full.order, fullMs)
  ];
  const [, , , twoOptStage, alnsStage] = stages;
  return {
    label,
    stops: points.length,
    distinctCoordinates: new Set(points.map((p) => `${p.latitude.toFixed(5)},${p.longitude.toFixed(5)}`)).size,
    matrixMode: matrix.mode,
    stages,
    alnsOver2OptPercent: percentLower(twoOptStage.cost, alnsStage.cost),
    alnsOverNnPercent: percentLower(stages[1].cost, alnsStage.cost),
    alnsOverInputPercent: percentLower(stages[0].cost, alnsStage.cost),
    alnsDistanceOver2OptPercent: percentLower(twoOptStage.distanceKm, alnsStage.distanceKm),
    alns: { iterations: full.alns.iterations, improvements: full.alns.improvements, stoppedBy: full.alns.stoppedBy },
    clusters: full.clusters?.length ?? undefined
  };
}

async function main() {
  const deliveries = await prisma.delivery.findMany({
    where: { address: { latitude: { not: null }, longitude: { not: null } } },
    include: { address: true, beat: { select: { beatNumber: true } } },
    orderBy: { createdAt: "asc" }
  });
  const pts = deliveries
    .map((d) => ({ id: d.id, beat: Number(d.beat?.beatNumber ?? 0), latitude: d.address.latitude!, longitude: d.address.longitude!, priority: d.priority, serviceMinutes: d.serviceTimeMinutes ?? env.defaultServiceTimeMinutes }))
    .sort((a, b) => a.beat - b.beat);

  const results = [await benchmark("all 130 deliveries, one round", pts)];
  for (let g = 0; g < 5; g++) {
    const chunk = pts.filter((p) => p.beat > g * 5 && p.beat <= (g + 1) * 5);
    if (chunk.length >= 5) results.push(await benchmark(`beats ${g * 5 + 1}-${g * 5 + 5} (${chunk.length} deliveries)`, chunk));
  }
  fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), osrm: env.osrmBaseUrl, alnsSettings: ALNS, results }, null, 2));
  for (const r of results) {
    console.log(`\n${r.label}  (${r.stops} stops on ${r.distinctCoordinates} distinct coordinates, ${r.matrixMode} matrix)`);
    for (const s of r.stages) console.log(`  ${s.name.padEnd(28)} ${String(s.distanceKm).padStart(8)} km  ${String(s.travelMinutes).padStart(8)} min  cost ${String(s.cost).padStart(9)}  ${s.runtimeMs === null ? "" : s.runtimeMs + " ms"}`);
    console.log(`  ALNS over 2-opt: ${r.alnsOver2OptPercent}%   over NN: ${r.alnsOverNnPercent}%   over input order: ${r.alnsOverInputPercent}%   (${r.alns.iterations} iterations, ${r.alns.improvements} improvements, stopped by ${r.alns.stoppedBy})`);
  }
}

main().finally(() => prisma.$disconnect());

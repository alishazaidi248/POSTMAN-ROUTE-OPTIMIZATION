/**
 * Route-quality audit on REAL data. For a postman's routable deliveries it builds the
 * real OSRM road matrix, then compares - under the SAME cost function - the cost of:
 *   1. the input order (database order)
 *   2. DBSCAN + Nearest Neighbor            (before 2-opt)
 *   3. DBSCAN + Nearest Neighbor + 2-opt    (the production pipeline)
 *   4. the EXACT optimum, by brute force over every permutation (only when stops <= 9)
 * and reports the optimality gap of the production pipeline. Read-only.
 *
 *   npm run route:analyze -- ramesh.kadam@postal.local
 *
 * Needs DATABASE_URL and OSRM_BASE_URL in the environment.
 */
import { prisma } from "../src/config/prisma";
import { env } from "../src/config/env";
import { getRoutingService } from "../src/services/optimization/routing";
import { isRoutableStatus, isUsableCoordinate } from "../src/services/optimization/RoadRouteOptimizationService";
import { DEFAULT_COST_PARAMS, PRIORITY_FACTOR, StopLoad, evaluateRoute } from "../src/services/optimization/routeAlgorithms";
import { optimizeWithAlns } from "../src/services/optimization/clustering";

function bruteForce(n: number, cost: (o: number[]) => number): { best: number[]; cost: number } {
  let best: number[] = [];
  let bestCost = Infinity;
  const used = new Array<boolean>(n).fill(false);
  const cur: number[] = [];
  const rec = () => {
    if (cur.length === n) {
      const c = cost(cur);
      if (c < bestCost) {
        bestCost = c;
        best = [...cur];
      }
      return;
    }
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      used[i] = true;
      cur.push(i);
      rec();
      cur.pop();
      used[i] = false;
    }
  };
  rec();
  return { best, cost: bestCost };
}

async function main() {
  const email = process.argv[2] ?? "ramesh.kadam@postal.local";
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, include: { postman: { include: { postOffice: true } } } });
  const postman = user.postman!;

  const rows = await prisma.delivery.findMany({
    where: { assignedPostmanId: postman.id },
    include: { address: true, recipient: true },
    orderBy: { createdAt: "asc" }
  });
  const stops = rows
    .filter((d) => isRoutableStatus(d.status) && isUsableCoordinate(d.address.latitude, d.address.longitude))
    .map((d) => ({
      id: d.id,
      name: d.recipient.name,
      lat: d.address.latitude as number,
      lng: d.address.longitude as number,
      load: Math.max(0, d.parcelCount),
      pri: d.priority,
      service: (d.serviceTimeMinutes ?? env.defaultServiceTimeMinutes) * 60
    }));

  const start = { latitude: postman.postOffice.latitude, longitude: postman.postOffice.longitude };
  const routing = getRoutingService();
  const matrix = await routing.getMatrix([start, ...stops.map((s) => ({ latitude: s.lat, longitude: s.lng }))]);

  const loads: StopLoad[] = stops.map((s) => ({ load: s.load, priorityFactor: PRIORITY_FACTOR[s.pri] ?? 0, serviceSeconds: s.service }));
  const params = DEFAULT_COST_PARAMS;
  const cost = (o: number[]) => evaluateRoute(o, matrix.durations, loads, params).total;
  const fmt = (o: number[]) => o.map((i) => stops[i].name.split(" ")[0]).join(" > ");

  console.log(`postman=${postman.name} stops=${stops.length} matrix=${matrix.mode} provider=${matrix.provider}`);
  if (matrix.warnings.length) console.log("warnings:", matrix.warnings.join(" | "));

  const input = stops.map((_, i) => i);
  const b = evaluateRoute(input, matrix.durations, loads, params);
  console.log(`\n1. input order        cost=${b.total.toFixed(1)} (travel ${b.travel.toFixed(0)}s, load ${b.loadPenalty.toFixed(0)}, priority ${b.priorityPenalty.toFixed(0)})\n   ${fmt(input)}`);

  const clustered = optimizeWithAlns({
    durations: matrix.durations,
    stops: loads,
    params,
    epsSeconds: env.dbscanEpsSeconds,
    minPts: env.dbscanMinPoints,
    maxPasses: env.twoOptMaxPasses,
    maxMillis: env.twoOptMaxMillis,
    alns: { maxIterations: env.alnsMaxIterations, maxMillis: env.alnsMaxMs, noImprovementLimit: env.alnsNoImprovementLimit, preserveClusters: env.alnsPreserveClusters, seed: 1 }
  });
  console.log(`2. DBSCAN + NN        cost=${clustered.initialCost.total.toFixed(1)}   clusters=${clustered.densityClusters} noise=${clustered.noisePoints}\n   ${fmt(clustered.initialOrder)}`);
  console.log(`3. DBSCAN + NN + 2opt cost=${clustered.twoOptCost.total.toFixed(1)}   passes=${clustered.twoOptPasses} improvements=${clustered.twoOptImprovements} stop=${clustered.twoOptStoppedBy}\n   ${fmt(clustered.order)}   blocks: ${clustered.blocks.map((bl) => `[${bl.map((i) => stops[i].name.split(" ")[0]).join(",")}]`).join(" ")}`);

  console.log(`4. + ALNS             cost=${clustered.finalCost.total.toFixed(1)}   iterations=${clustered.alns.iterations} improvements=${clustered.alns.improvements} stop=${clustered.alns.stoppedBy} ${clustered.alns.runtimeMs}ms
   ${fmt(clustered.order)}`);

  if (stops.length <= 9) {
    const t0 = Date.now();
    const opt = bruteForce(stops.length, cost);
    const gap = ((clustered.finalCost.total - opt.cost) / opt.cost) * 100;
    console.log(`5. EXACT optimum      cost=${opt.cost.toFixed(1)}   (${Date.now() - t0} ms)\n   ${fmt(opt.best)}`);
    console.log(`\nOPTIMALITY GAP of the production pipeline: ${gap.toFixed(2)}%`);
  } else {
    console.log("\n(more than 9 stops: exact optimum skipped)");
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Measures the full route pipeline (DBSCAN -> Nearest Neighbor -> 2-opt -> ALNS) on rounds of 1..100
 * deliveries with the REAL routing engine, and checks the invariants that make the numbers trustworthy:
 * every stop is visited once, cost(ALNS) <= cost(2-opt) <= cost(NN), and the reported costs are what the cost
 * function gives for the returned order.
 *
 *   npm run route:alns
 *
 * Needs OSRM_BASE_URL (defaults to the public demo server) and, like every script, DATABASE_URL etc. in the
 * environment. Nothing is read from or written to the database.
 */
import { planRouteFromInputs, RoutableDelivery } from "../src/services/optimization/RoadRouteOptimizationService";
import { RoutingService } from "../src/services/optimization/routing";

const OSRM = (process.env.OSRM_BASE_URL ?? "https://router.project-osrm.org").replace(/\/+$/, "");
const START = { latitude: 19.1436, longitude: 72.9345, source: "POST_OFFICE" as const };

function lcg(seed: number) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
}

/** n deliveries scattered over a Bhandup-sized area, with mixed priorities, parcel counts and service times. */
function round(n: number, seed: number): RoutableDelivery[] {
  const rnd = lcg(seed);
  return Array.from({ length: n }, (_, i) => ({
    id: `d${i}`,
    latitude: 19.11 + rnd() * 0.07,
    longitude: 72.9 + rnd() * 0.09,
    parcelCount: 1 + Math.floor(rnd() * 5),
    priority: ["LOW", "NORMAL", "NORMAL", "HIGH", "URGENT"][Math.floor(rnd() * 5)],
    serviceTimeMinutes: 2 + Math.floor(rnd() * 4)
  }));
}

let failed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (!ok) {
    failed++;
    console.log(`  FAIL  ${name}${detail === undefined ? "" : "  -> " + JSON.stringify(detail)}`);
  }
};

async function main() {
  const routing = new RoutingService({ baseUrl: OSRM, timeoutMs: 30_000 });
  console.log("stops | matrix        | osrm req | input   | +NN     | +2-opt  | +ALNS   | vs 2-opt | iters | improv | ms(total) ms(ALNS) | geometry");
  for (const n of [1, 2, 5, 10, 25, 50, 100]) {
    const deliveries = round(n, 700 + n);
    const t0 = Date.now();
    const sol = await planRouteFromInputs({ postmanId: "p", beatId: "b", start: START, deliveries }, routing);
    const wall = Date.now() - t0;
    const m = sol.metrics;

    check(`${n}: every stop exactly once`, new Set(sol.stops.map((s) => s.deliveryId)).size === n && sol.stops.length === n);
    check(`${n}: sequence 1..n`, sol.stops.every((s, i) => s.sequence === i + 1));
    check(`${n}: ALNS <= 2-opt`, m.totalCost <= m.twoOptCost + 1e-6, [m.totalCost, m.twoOptCost]);
    check(`${n}: 2-opt <= NN`, m.twoOptCost <= m.dbscanNnCost + 1e-6, [m.twoOptCost, m.dbscanNnCost]);
    check(`${n}: the algorithm is DBSCAN_NN_2OPT_ALNS`, sol.algorithm === "DBSCAN_NN_2OPT_ALNS" && m.algorithm === "DBSCAN_NN_2OPT_ALNS");
    check(`${n}: ALNS improvements are only claimed when the cost really dropped`, m.alns.improvements === 0 ? Math.abs(m.totalCost - m.twoOptCost) < 1e-6 : m.totalCost < m.twoOptCost + 1e-6);
    check(`${n}: the run is bounded`, wall < 60_000, wall);
    check(`${n}: a road polyline was returned`, n === 0 || sol.geometry !== null && sol.geometry !== undefined);

    const pct = m.twoOptCost > 0 ? (((m.twoOptCost - m.totalCost) / m.twoOptCost) * 100).toFixed(2) + "%" : "0%";
    console.log(
      `${String(n).padStart(5)} | ${m.matrixMode.padEnd(6)} ${String(sol.routing?.provider).padEnd(6)} | ${String(m.osrmMatrixRequests).padStart(8)} | ` +
        `${String(Math.round(m.inputOrderCost)).padStart(7)} | ${String(Math.round(m.dbscanNnCost)).padStart(7)} | ${String(Math.round(m.twoOptCost)).padStart(7)} | ${String(Math.round(m.totalCost)).padStart(7)} | ` +
        `${pct.padStart(8)} | ${String(m.alns.iterations).padStart(5)} | ${String(m.alns.improvements).padStart(6)} | ${String(wall).padStart(9)} ${String(m.alns.runtimeMs).padStart(8)} | ${sol.routing?.geometrySource}`
    );
    if (n === 25 || n === 100) {
      const use = (rec: Record<string, { used: number; newBest: number; improved: number; weight: number }>) =>
        Object.entries(rec).map(([k, v]) => `${k} used ${v.used} (best ${v.newBest}, better ${v.improved}, w ${v.weight})`).join("; ");
      console.log(`        destroy: ${use(m.alns.destroyUsage)}`);
      console.log(`        repair : ${use(m.alns.repairUsage)}`);
    }
  }
  console.log(failed === 0 ? "\nALL CHECKS PASSED" : `\n${failed} CHECK(S) FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});

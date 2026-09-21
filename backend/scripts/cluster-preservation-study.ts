/**
 * Does keeping every DBSCAN cluster as one unbroken run in the final route (ROUTE_ALNS_PRESERVE_CLUSTERS=true) cost route
 * quality? Measured on deterministic synthetic rounds (tests/support/routeBenchmark.ts: a street-grid road model with a
 * river and bridge; about three in four stops in neighbourhoods) - NOT on real roads.
 *
 *   npx tsx scripts/cluster-preservation-study.ts            (rounds of 25 / 50 / 100 stops, 20 seeds each)
 *
 * Two conditions, because the cost function has three parts (travel + load + priority):
 *   PLAIN   every delivery NORMAL priority and no weights -> cost = driving time. This is the condition of the real data
 *           set (the Bhandup files have neither), and the fair test of "shorter route".
 *   MIXED   random priorities and weights -> the priority / load terms are live and ALNS may trade driving time for them.
 * The wall-clock cap is off so the numbers are repeatable.
 */
import { planRouteFromInputs } from "../src/services/optimization/RoadRouteOptimizationService";
import { fakeOsrm, makeRound, PRODUCTION_ALNS, START } from "../tests/support/routeBenchmark";
import { env } from "../src/config/env";

type Cond = "PLAIN" | "MIXED";

async function run(n: number, seed: number, cond: Cond, preserve: boolean) {
  const round = makeRound(n, seed).map((d) => (cond === "PLAIN" ? { ...d, priority: "NORMAL", weightKg: null } : d));
  // The production planner reads the preserve flag from env; flip it for this run.
  (env as { alnsPreserveClusters: boolean }).alnsPreserveClusters = preserve;
  (env as { alnsMaxMs: number }).alnsMaxMs = PRODUCTION_ALNS.maxMillis;
  const t0 = performance.now();
  const sol = await planRouteFromInputs({ postmanId: "p", beatId: "b", start: START, deliveries: round }, fakeOsrm());
  return { minutes: sol.metrics.totalTravelSeconds / 60, km: sol.metrics.totalDistanceMeters / 1000, cost: sol.metrics.totalCost, ms: performance.now() - t0 };
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

async function main() {
  const seeds = Array.from({ length: 20 }, (_, i) => 100 + i);
  console.log("condition  stops  travel min (preserve | free)   difference   km (preserve | free)   ALNS+all ms (preserve | free)   free shorter in");
  for (const cond of ["PLAIN", "MIXED"] as Cond[]) {
    for (const n of [25, 50, 100]) {
      const keep = [], free = [];
      for (const seed of seeds) {
        keep.push(await run(n, seed, cond, true));
        free.push(await run(n, seed, cond, false));
      }
      const km = mean(keep.map((r) => r.minutes)), mf = mean(free.map((r) => r.minutes));
      const wins = free.filter((r, i) => r.minutes < keep[i].minutes - 1e-6).length;
      console.log(
        `${cond.padEnd(9)}  ${String(n).padStart(5)}  ${km.toFixed(1).padStart(9)} | ${mf.toFixed(1).padEnd(9)}   ${(((mf - km) / km) * 100).toFixed(1).padStart(6)} %   ` +
          `${mean(keep.map((r) => r.km)).toFixed(1).padStart(7)} | ${mean(free.map((r) => r.km)).toFixed(1).padEnd(7)}   ${mean(keep.map((r) => r.ms)).toFixed(0).padStart(6)} | ${mean(free.map((r) => r.ms)).toFixed(0).padEnd(6)}   ${wins}/${seeds.length} rounds`
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

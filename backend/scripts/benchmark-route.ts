/**
 * Prints the stage-by-stage route benchmark (input order, NN, NN+2-opt, DBSCAN+NN, +2-opt, +ALNS) on
 * deterministic rounds. No network, no database. The same code the test suite asserts on.
 *
 *   npm run route:bench                    (10, 25, 50, 100 deliveries)
 *   npm run route:bench -- 200 500         (any sizes; larger ones take longer)
 *   npm run route:bench -- 100 --ms=1500   (apply the production wall-clock cap to ALNS)
 *   npm run route:bench -- 100 --free-clusters   (ALNS may move stops between DBSCAN clusters)
 *
 * By default ALNS runs to its iteration / no-improvement limits without the wall-clock cap so the numbers are
 * repeatable; --ms shows what the capped production setting gives on this machine.
 */
import { formatRound, PRODUCTION_ALNS, runRound } from "../tests/support/routeBenchmark";

async function main() {
  const args = process.argv.slice(2);
  const ms = args.find((a) => a.startsWith("--ms="));
  const sizes = args.filter((a) => /^\d+$/.test(a)).map(Number);
  const settings = {
    ...PRODUCTION_ALNS,
    ...(ms ? { maxMillis: Number(ms.slice(5)) } : {}),
    ...(args.includes("--free-clusters") ? { preserveClusters: false } : {})
  };
  console.log(`ALNS settings: ${JSON.stringify(settings)}
`);

  const failures: string[] = [];
  for (const n of sizes.length ? sizes : [10, 25, 50, 100]) {
    const r = await runRound(n, 900 + n, settings);
    console.log(formatRound(r));
    console.log("\n----------------------------------------\n");
    const [, , , , twoOptStage, alnsStage] = r.stages;
    if (alnsStage.cost > twoOptStage.cost + 1e-6) failures.push(`${n}: ALNS dearer than 2-opt`);
    if (!r.productionMatches && !ms) failures.push(`${n}: production entry point differs from the measured route`);
  }
  console.log(failures.length === 0 ? "INVARIANTS HOLD (ALNS never dearer than 2-opt)" : `FAILED: ${failures.join("; ")}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});

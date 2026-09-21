/**
 * The route pipeline measured stage by stage on 10 / 25 / 50 / 100 deliveries (see support/routeBenchmark.ts).
 *
 * These tests assert what must ALWAYS hold - a valid route, the same cost function at every stage, ALNS never
 * dearer than the 2-opt route it started from, the production entry point returning the measured route. They
 * do NOT assert that ALNS wins by some percentage: how much it improves is measured and printed, whatever it is.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/config/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));
vi.mock("../src/config/prisma", () => ({ prisma: {} }));

import { planRouteFromInputs } from "../src/services/optimization/RoadRouteOptimizationService";
import { PRODUCTION_ALNS, RoundReport, START, fakeOsrm, formatRound, makeRound, runRound } from "./support/routeBenchmark";

const SIZES = [10, 25, 50, 100];
const isPermutation = (order: number[], n: number) => order.length === n && new Set(order).size === n && order.every((i) => i >= 0 && i < n);

describe("benchmark: input order vs NN vs NN+2-opt vs DBSCAN+NN(+2-opt)(+ALNS)", () => {
  const reports: RoundReport[] = [];

  it.each(SIZES)("%i deliveries: every stage is a valid route, costs never rise stage to stage, production agrees", async (n) => {
    const r = await runRound(n, 900 + n);
    reports.push(r);
    const [input, nn, nn2opt, dbscanNn, dbscan2opt, alns] = r.stages;

    for (const s of r.stages) expect(isPermutation(s.order, n), s.name).toBe(true);

    // The same cost function everywhere, so these comparisons are meaningful.
    expect(nn2opt.cost).toBeLessThanOrEqual(nn.cost + 1e-6);
    expect(dbscan2opt.cost).toBeLessThanOrEqual(dbscanNn.cost + 1e-6);
    expect(alns.cost, "ALNS may not be dearer than the 2-opt route it started from").toBeLessThanOrEqual(dbscan2opt.cost + 1e-6);
    // ...and optimizing is not the input order.
    expect(alns.cost).toBeLessThan(input.cost);

    expect(r.alnsOver2OptPercent).toBeGreaterThanOrEqual(0);
    expect(r.alnsIterations).toBeGreaterThan(0);
    // Production (planRouteFromInputs) returned exactly the route the benchmark measured as the last stage.
    expect(r.productionMatches).toBe(true);
    expect(r.productionCost).toBeCloseTo(alns.cost, 1); // the service reports costs rounded to 0.01
  }, 120_000);

  it("is repeatable: the same round gives the same routes and costs", async () => {
    const a = await runRound(25, 925);
    const b = await runRound(25, 925);
    expect(b.stages.map((s) => s.order)).toEqual(a.stages.map((s) => s.order));
    expect(b.stages.map((s) => s.cost)).toEqual(a.stages.map((s) => s.cost));
  }, 60_000);

  it("prints the measured figures (whatever they are)", () => {
    // Runs after the sizes above; the table is the honest output of this file.
    const text = reports
      .sort((a, b) => a.stops - b.stops)
      .map(formatRound)
      .join("\n\n----------------------------------------\n\n");
    console.log(`\n${text}\n`);
    expect(reports.length).toBe(SIZES.length);
  });
});

describe("the planned route is consistent for every round size", () => {
  it.each([1, 2, 5, 10, 25, 50, 100])(
    "%i deliveries: each once, numbered 1..n, legs and ETAs consistent, geometry follows the stop order",
    async (n) => {
      const deliveries = makeRound(n, 300 + n);
      const sol = await planRouteFromInputs({ postmanId: "p", beatId: "b", start: START, deliveries, alns: PRODUCTION_ALNS }, fakeOsrm());

      expect(sol.stops.map((s) => s.sequence)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
      expect(new Set(sol.stops.map((s) => s.deliveryId))).toEqual(new Set(deliveries.map((d) => d.id)));
      expect(sol.metrics.totalCost).toBeLessThanOrEqual(sol.metrics.twoOptCost + 1e-6);
      expect(sol.metrics.totalCost).toBeLessThanOrEqual(sol.metrics.dbscanNnCost + 1e-6);

      // Legs add up to the totals, and arrival times only move forward.
      const legMeters = sol.stops.reduce((s, x) => s + (x.distanceFromPreviousMeters ?? 0), 0);
      expect(Math.abs(legMeters - sol.totalDistanceMeters)).toBeLessThan(n + 1);
      const times = sol.stops.map((s) => new Date(s.estimatedArrival).getTime());
      expect([...times].sort((a, b) => a - b)).toEqual(times);

      // The road polyline is built from the FINAL stop order: start, then every stop in sequence.
      const byId = new Map(deliveries.map((d) => [d.id, d]));
      expect(sol.geometry?.coordinates).toEqual([
        [START.longitude, START.latitude],
        ...sol.stops.map((s) => [byId.get(s.deliveryId)!.longitude, byId.get(s.deliveryId)!.latitude])
      ]);
    },
    60_000
  );

  it("100 deliveries with the production time cap (1.5 s) still finish, valid and no worse than 2-opt", async () => {
    const deliveries = makeRound(100, 777);
    const t0 = Date.now();
    const sol = await planRouteFromInputs({ postmanId: "p", beatId: "b", start: START, deliveries, alns: { maxMillis: 1500 } }, fakeOsrm());
    expect(Date.now() - t0).toBeLessThan(15_000);
    expect(sol.stops).toHaveLength(100);
    expect(sol.metrics.totalCost).toBeLessThanOrEqual(sol.metrics.twoOptCost + 1e-6);
  }, 60_000);
});

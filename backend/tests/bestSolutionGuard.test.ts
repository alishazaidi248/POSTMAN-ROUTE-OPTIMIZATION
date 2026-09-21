/**
 * "Never return the worse solution just because ALNS ran": the final route is BEST(2-opt route, ALNS best).
 *
 * alns.ts only ever returns its best route (which starts as the 2-opt route), so a worse result cannot happen by
 * itself. This test makes it happen on purpose - by replacing alns() with one that returns the reverse of the
 * route it was given - and checks that the pipeline still returns the 2-opt route.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/services/optimization/alns", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/optimization/alns")>();
  return {
    ...actual,
    alns: (input: Parameters<typeof actual.alns>[0]) => {
      const real = actual.alns(input);
      // A deliberately terrible answer: the start route, reversed.
      return { ...real, order: [...input.initialOrder].reverse() };
    }
  };
});

import { optimizeWithAlns } from "../src/services/optimization/clustering";
import { DEFAULT_COST_PARAMS, evaluateRoute, StopLoad } from "../src/services/optimization/routeAlgorithms";

describe("the best-solution rule", () => {
  it("a worse ALNS result is discarded: the final route is the 2-opt route", () => {
    const n = 12;
    // A line of stops away from the start: the reverse of a good route is clearly dearer.
    const durations = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => Math.abs(i - j) * 60));
    const stops: StopLoad[] = Array.from({ length: n }, () => ({ load: 1, priorityFactor: 0, serviceSeconds: 0 }));

    const r = optimizeWithAlns({
      durations,
      stops,
      alns: { maxIterations: 50, maxMillis: 5000, noImprovementLimit: 50, preserveClusters: true }
    });

    const cost = (order: number[]) => evaluateRoute(order, durations, stops, DEFAULT_COST_PARAMS).total;
    const reversed = [...r.twoOptOrder].reverse();
    expect(cost(reversed)).toBeGreaterThan(cost(r.twoOptOrder)); // the "ALNS" answer really was worse

    expect(r.alnsReverted).toBe(true);
    expect(r.order).toEqual(r.twoOptOrder);
    expect(r.finalCost.total).toBeCloseTo(cost(r.twoOptOrder), 6);
    expect(r.finalCost.total).toBeLessThanOrEqual(cost(reversed));
  });
});

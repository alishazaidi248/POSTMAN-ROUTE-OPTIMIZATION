import { beforeEach, describe, expect, it, vi } from "vitest";

type StoredRequest = {
  id: string;
  requestType: string;
  parameters: Record<string, unknown>;
  status: string;
  results: { createdAt: Date; resultData: unknown }[];
};

const state = vi.hoisted(() => ({
  activeIds: [] as string[],
  stored: null as null | {
    id: string;
    requestType: string;
    parameters: Record<string, unknown>;
    status: string;
    results: { createdAt: Date; resultData: unknown }[];
  },
  completedCount: 0,
  nextId: 1,
  pendingRequests: new Map<string, { requestType: string; parameters: Record<string, unknown> }>()
}));

const prismaMock = vi.hoisted(() => ({
  delivery: { findMany: vi.fn() },
  optimizationRequest: { findFirst: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn() },
  optimizationResult: { create: vi.fn() },
  postman: { findUnique: vi.fn() }
}));

vi.mock("../src/config/prisma", () => ({ prisma: prismaMock }));
vi.mock("../src/config/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

import { getOrPlanRoute, recalculateRoute } from "../src/services/routePlanner.service";
import { OptimizationSolution, RouteMetrics, setOptimizationServiceForTests } from "../src/services/optimization";

const postman = { id: "pm1", postOfficeId: "po1", assignedBeatId: "beat1" } as never;

const metricsFor = (stops: number): RouteMetrics => ({
  algorithm: "DBSCAN_NN_2OPT_ALNS",
  stops,
  clusters: 1,
  noisePoints: 0,
  dbscanEpsSeconds: 300,
  dbscanEpsAuto: false,
  dbscanMinPoints: 2,
  totalDistanceMeters: 100,
  totalTravelSeconds: 60,
  serviceSeconds: 0,
  travelCost: 60,
  loadPenalty: 0,
  priorityPenalty: 0,
  totalCost: 60,
  loadWeight: 0.35,
  loadBasis: "WEIGHT_KG",
  priorityWeight: 0.25,
  inputOrderCost: 60,
  dbscanNnCost: 60,
  improvementOverInputPercent: 0,
  improvementFrom2OptPercent: 0,
  twoOptPasses: 1,
  twoOptImprovements: 0,
  twoOptStoppedBy: "CONVERGED",
  twoOptReverted: false,
  twoOptCost: 60,
  improvementFromAlnsPercent: 0,
  alns: {
    initialCost: 60, bestCost: 60, iterations: 10, improvements: 0, acceptedImproving: 0, acceptedWorse: 0, rejected: 10,
    destroyUsage: {}, repairUsage: {}, stoppedBy: "MAX_ITERATIONS", runtimeMs: 1, temperatureStart: 1, temperatureEnd: 0.001, clustersPreserved: true
  },
  optimizationMs: 1,
  reusedOrder: false,
  matrixMode: "ROAD",
  osrmMatrixRequests: 1
});

const solutionFor = (ids: string[]): OptimizationSolution => ({
  postmanId: "pm1",
  beatId: "beat1",
  algorithm: "DBSCAN_NN_2OPT_ALNS",
  metrics: metricsFor(ids.length),
  generatedAt: "2026-09-20T08:00:00.000Z",
  totalDistanceMeters: 100,
  estimatedDurationMinutes: 5,
  stops: ids.map((deliveryId, i) => ({
    deliveryId,
    sequence: i + 1,
    latitude: 19.1,
    longitude: 72.9,
    estimatedArrival: "2026-09-20T08:10:00.000Z"
  })),
  unroutable: []
});

/** What routes stored by the older strategies look like when read back from JSON. */
const legacySolution = (ids: string[], algorithm: string, withMetrics = false): OptimizationSolution => {
  const { metrics, ...rest } = solutionFor(ids);
  return { ...rest, algorithm, ...(withMetrics ? { metrics } : {}) } as unknown as OptimizationSolution;
};

const optimizer = {
  planRoute: vi.fn(),
  reoptimize: vi.fn()
};

function seedStored(solution: OptimizationSolution) {
  state.stored = {
    id: "req-old",
    requestType: "ROUTE_PLAN",
    parameters: { postmanId: "pm1", trigger: "DELIVERIES_CHANGED" },
    status: "COMPLETED",
    results: [{ createdAt: new Date("2026-09-20T08:00:00Z"), resultData: solution }]
  };
  state.completedCount = 1;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.activeIds = [];
  state.stored = null;
  state.completedCount = 0;
  state.nextId = 1;
  state.pendingRequests.clear();

  prismaMock.delivery.findMany.mockImplementation(async () => state.activeIds.map((id) => ({ id })));
  prismaMock.optimizationRequest.findFirst.mockImplementation(async () => state.stored);
  prismaMock.optimizationRequest.count.mockImplementation(async () => state.completedCount);
  prismaMock.optimizationRequest.create.mockImplementation(
    async ({ data }: { data: { requestType: string; parameters: Record<string, unknown> } }) => {
      const id = `req-${state.nextId++}`;
      state.pendingRequests.set(id, { requestType: data.requestType, parameters: data.parameters });
      return { id };
    }
  );
  prismaMock.optimizationResult.create.mockImplementation(
    async ({ data }: { data: { optimizationRequestId: string; resultData: unknown; source: string } }) => {
      const pending = state.pendingRequests.get(data.optimizationRequestId)!;
      const createdAt = new Date("2026-09-20T09:00:00Z");
      state.stored = {
        id: data.optimizationRequestId,
        requestType: pending.requestType,
        parameters: pending.parameters,
        status: "COMPLETED",
        results: [{ createdAt, resultData: data.resultData }]
      } as StoredRequest;
      state.completedCount++;
      return { createdAt };
    }
  );
  prismaMock.optimizationRequest.update.mockResolvedValue({});

  optimizer.planRoute.mockImplementation(async (p: { deliveryIds: string[] }) => solutionFor(p.deliveryIds));
  optimizer.reoptimize.mockImplementation(async (p: { deliveryIds: string[]; fixedOrder?: string[] }) =>
    solutionFor(p.fixedOrder ?? p.deliveryIds)
  );
  setOptimizationServiceForTests(optimizer);
});

describe("getOrPlanRoute", () => {
  it("returns null and does no work when the postman has nothing left to deliver", async () => {
    expect(await getOrPlanRoute(postman)).toBeNull();
    expect(optimizer.planRoute).not.toHaveBeenCalled();
    expect(prismaMock.optimizationRequest.create).not.toHaveBeenCalled();
  });

  it("plans and stores a route the first time, using the real algorithm name as the source", async () => {
    state.activeIds = ["d1", "d2"];

    const route = await getOrPlanRoute(postman);

    expect(optimizer.planRoute).toHaveBeenCalledTimes(1);
    expect(optimizer.planRoute.mock.calls[0][0]).toMatchObject({
      postmanId: "pm1",
      postOfficeId: "po1",
      deliveryIds: ["d1", "d2"]
    });
    expect(prismaMock.optimizationResult.create.mock.calls[0][0].data.source).toBe("DBSCAN_NN_2OPT_ALNS");
    expect(route?.solution.stops.map((s) => s.deliveryId)).toEqual(["d1", "d2"]);
    expect(route?.version).toBe(1);
  });

  it("serves the stored route unchanged while the delivery set is the same (no recompute)", async () => {
    state.activeIds = ["d1", "d2"];
    seedStored(solutionFor(["d2", "d1"]));

    const route = await getOrPlanRoute(postman);

    expect(optimizer.planRoute).not.toHaveBeenCalled();
    expect(optimizer.reoptimize).not.toHaveBeenCalled();
    expect(route?.routeId).toBe("req-old");
    expect(route?.solution.stops.map((s) => s.deliveryId)).toEqual(["d2", "d1"]);
  });

  it("when a stop is completed, keeps the remaining order and only refreshes legs (pruned, not reshuffled)", async () => {
    seedStored(solutionFor(["d3", "d1", "d2"]));
    state.activeIds = ["d1", "d2"]; // d3 was delivered

    const route = await getOrPlanRoute(postman);

    expect(optimizer.planRoute).not.toHaveBeenCalled();
    expect(optimizer.reoptimize).toHaveBeenCalledTimes(1);
    const [problem, trigger] = optimizer.reoptimize.mock.calls[0];
    expect(problem.fixedOrder).toEqual(["d1", "d2"]);
    expect(problem.deliveryIds).toEqual(["d1", "d2"]);
    expect(trigger).toBe("STOPS_REMOVED");
    expect(route?.solution.stops.map((s) => s.deliveryId)).toEqual(["d1", "d2"]);
  });

  it("runs a full re-optimization when a delivery is added", async () => {
    seedStored(solutionFor(["d1"]));
    state.activeIds = ["d1", "d2"];

    await getOrPlanRoute(postman);

    expect(optimizer.planRoute).toHaveBeenCalledTimes(1);
    expect(optimizer.planRoute.mock.calls[0][0].fixedOrder).toBeUndefined();
  });

  it("does not loop forever on a delivery that has no coordinates (it is 'covered' as unroutable)", async () => {
    const stored = solutionFor(["d1"]);
    stored.unroutable = [{ deliveryId: "d2", reason: "MISSING_COORDINATES" }];
    seedStored(stored);
    state.activeIds = ["d1", "d2"];

    await getOrPlanRoute(postman);

    expect(optimizer.planRoute).not.toHaveBeenCalled();
    expect(optimizer.reoptimize).not.toHaveBeenCalled();
  });

  it.each([
    ["the old mock", "MOCK_SEQUENTIAL"],
    ["the old NN + 2-opt", "NN_2OPT"]
  ])("replaces a stored route produced by %s instead of showing it as optimized", async (_label, algorithm) => {
    seedStored(legacySolution(["d1"], algorithm, true));
    state.activeIds = ["d1"];

    await getOrPlanRoute(postman);

    expect(optimizer.planRoute).toHaveBeenCalledTimes(1);
  });

  it("replaces a stored DBSCAN route that carries no measured metrics", async () => {
    seedStored(legacySolution(["d1"], "DBSCAN_NN_2OPT_ALNS", false));
    state.activeIds = ["d1"];

    await getOrPlanRoute(postman);

    expect(optimizer.planRoute).toHaveBeenCalledTimes(1);
  });

  it("refresh: true forces a full re-optimization even when nothing changed", async () => {
    seedStored(solutionFor(["d1", "d2"]));
    state.activeIds = ["d1", "d2"];

    await getOrPlanRoute(postman, { refresh: true, trigger: "MANUAL" });

    expect(optimizer.planRoute).toHaveBeenCalledTimes(1);
  });

  it("passes the requested start location through to the optimizer", async () => {
    state.activeIds = ["d1"];
    await getOrPlanRoute(postman, { start: { latitude: 19.2, longitude: 72.9 } });
    expect(optimizer.planRoute.mock.calls[0][0].start).toEqual({ latitude: 19.2, longitude: 72.9 });
  });

  it("returns the last stored route, flagged stale, if recomputing fails", async () => {
    seedStored(solutionFor(["d1"]));
    state.activeIds = ["d1", "d2"];
    optimizer.planRoute.mockRejectedValue(new Error("db down"));

    const route = await getOrPlanRoute(postman);

    expect(route?.stale).toBe(true);
    expect(route?.routeId).toBe("req-old");
    expect(prismaMock.optimizationRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "FAILED" } })
    );
  });

  it("propagates the failure when there is no stored route to fall back to", async () => {
    state.activeIds = ["d1"];
    optimizer.planRoute.mockRejectedValue(new Error("db down"));
    await expect(getOrPlanRoute(postman)).rejects.toThrow("db down");
  });

  it("serialises concurrent requests so the optimizer runs once", async () => {
    state.activeIds = ["d1", "d2"];

    const [a, b] = await Promise.all([getOrPlanRoute(postman), getOrPlanRoute(postman)]);

    expect(optimizer.planRoute).toHaveBeenCalledTimes(1);
    expect(a?.routeId).toBe(b?.routeId);
  });

  it("does not create a route for a postman with a beat-less assignment problem: beatId falls back to empty", async () => {
    state.activeIds = ["d1"];
    await getOrPlanRoute({ id: "pm1", postOfficeId: "po1", assignedBeatId: null } as never);
    expect(optimizer.planRoute.mock.calls[0][0].beatId).toBe("");
  });
});

describe("there is one algorithm and the caller cannot choose it", () => {
  const withClusters = () => {
    const s = solutionFor(["d1", "d2", "d3"]);
    s.stops[0].clusterId = 1;
    s.stops[1].clusterId = 1;
    s.stops[2].clusterId = 2;
    return s;
  };

  it("the problem handed to the optimizer carries no algorithm field at all", async () => {
    state.activeIds = ["d1"];
    await getOrPlanRoute(postman);
    expect(optimizer.planRoute.mock.calls[0][0]).not.toHaveProperty("algorithm");
  });

  it("an `algorithm` smuggled into the options is dropped, for reads and for recalculation", async () => {
    state.activeIds = ["d1"];
    const smuggled = { algorithm: "NN_2OPT", trigger: "MANUAL", refresh: true } as never;
    await getOrPlanRoute(postman, smuggled);
    expect(optimizer.planRoute.mock.calls[0][0]).not.toHaveProperty("algorithm");

    optimizer.planRoute.mockClear();
    await recalculateRoute(postman, { algorithm: "NN_2OPT", trigger: "MANUAL" } as never);
    expect(optimizer.planRoute.mock.calls[0][0]).not.toHaveProperty("algorithm");
    expect(prismaMock.optimizationResult.create.mock.calls.at(-1)?.[0].data.source).toBe("DBSCAN_NN_2OPT_ALNS");
  });

  it("a plain read of a current route never recomputes it", async () => {
    seedStored(solutionFor(["d1", "d2"]));
    state.activeIds = ["d1", "d2"];
    const route = await getOrPlanRoute(postman);
    expect(optimizer.planRoute).not.toHaveBeenCalled();
    expect(route?.solution.algorithm).toBe("DBSCAN_NN_2OPT_ALNS");
  });

  it("pruning passes the fixed order and the stops' cluster ids along", async () => {
    seedStored(withClusters());
    state.activeIds = ["d2", "d3"]; // d1 delivered

    await getOrPlanRoute(postman);

    const [problem] = optimizer.reoptimize.mock.calls[0];
    expect(problem.fixedOrder).toEqual(["d2", "d3"]);
    expect(problem.fixedClusterIds).toEqual({ d1: 1, d2: 1, d3: 2 });
  });
});

describe("what triggers a full re-optimization and what only prunes", () => {
  it("a completed delivery only prunes: the remaining order is kept", async () => {
    seedStored(solutionFor(["d3", "d1", "d2"]));
    state.activeIds = ["d1", "d2"]; // d3 delivered

    await recalculateRoute(postman, { trigger: "DELIVERY_COMPLETED" });

    expect(optimizer.planRoute).not.toHaveBeenCalled();
    expect(optimizer.reoptimize.mock.calls[0][0].fixedOrder).toEqual(["d1", "d2"]);
  });

  it.each(["RECIPIENT_UNAVAILABLE", "WRONG_ADDRESS", "ADDRESS_NOT_FOUND", "DELIVERY_FAILED", "MANUAL", "ROUTE_DEVIATION"])(
    "%s re-runs the full pipeline",
    async (trigger) => {
      seedStored(solutionFor(["d1", "d2"]));
      state.activeIds = ["d1", "d2"];

      await recalculateRoute(postman, { trigger });

      expect(optimizer.planRoute).toHaveBeenCalledTimes(1);
      expect(optimizer.planRoute.mock.calls[0][0].fixedOrder).toBeUndefined();
    }
  );

  it("a newly assigned delivery re-runs the full pipeline on the next read", async () => {
    seedStored(solutionFor(["d1", "d2"]));
    state.activeIds = ["d1", "d2", "d9"];

    await getOrPlanRoute(postman);

    expect(optimizer.planRoute).toHaveBeenCalledTimes(1);
    expect(optimizer.planRoute.mock.calls[0][0].fixedOrder).toBeUndefined();
  });

  it("a reassigned-away delivery only prunes", async () => {
    seedStored(solutionFor(["d1", "d2", "d3"]));
    state.activeIds = ["d1", "d3"];

    await getOrPlanRoute(postman);

    expect(optimizer.planRoute).not.toHaveBeenCalled();
    expect(optimizer.reoptimize.mock.calls[0][0].fixedOrder).toEqual(["d1", "d3"]);
  });
});

describe("recalculateRoute", () => {
  it("always runs a full optimization for the remaining deliveries", async () => {
    seedStored(solutionFor(["d1", "d2"]));
    state.activeIds = ["d1", "d2"];

    const route = await recalculateRoute(postman, { trigger: "MANUAL", start: { latitude: 19.1, longitude: 72.9 } });

    expect(optimizer.planRoute).toHaveBeenCalledTimes(1);
    expect(route?.trigger).toBe("MANUAL");
    expect(optimizer.planRoute.mock.calls[0][0].start).toEqual({ latitude: 19.1, longitude: 72.9 });
  });

  it("returns null when there is nothing to route", async () => {
    expect(await recalculateRoute(postman, { trigger: "MANUAL" })).toBeNull();
  });
});

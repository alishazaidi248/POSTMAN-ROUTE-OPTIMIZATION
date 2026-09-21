import { Postman, Prisma } from "@prisma/client";
import { logger } from "../config/logger";
import { prisma } from "../config/prisma";
import {
  LatLng,
  OptimizationProblem,
  OptimizationSolution,
  ROUTE_ALGORITHM,
  getOptimizationService
} from "./optimization";
import { ROUTABLE_STATUSES } from "./optimization/RoadRouteOptimizationService";

/**
 * Owns "the current route" for a postman: when to compute a new one, when a
 * stored one is still valid, and how it is persisted.
 *
 * Persistence deliberately reuses the existing OptimizationRequest /
 * OptimizationResult tables (the app's established source of truth for
 * /me/route) — no schema change. The `Route`/`RouteStop` tables remain unused.
 *
 * Freshness rules for GET /me/route (evaluated on every read, cheap — one id
 * query):
 *   • same set of active deliveries as the stored route  → return stored
 *   • only REMOVALS (delivered / failed / reassigned)     → keep the existing
 *     order, drop those stops and refresh legs, ETAs and polyline ("pruned").
 *     The remaining stops never reshuffle just because one was completed.
 *   • any ADDITION (or a stored route that was not produced by the
 *     current pipeline / carries no metrics)              → the full pipeline
 *   • explicit recalculate / re-optimization event        → the full pipeline
 *
 * "The full pipeline" is always road matrix → DBSCAN → Nearest Neighbor → 2-opt → ALNS → best
 * solution → road geometry (see services/optimization). Nothing here, and nothing a client sends,
 * can select another one.
 */

export interface RouteResponse {
  routeId: string;
  version: number;
  trigger: string;
  status: string;
  generatedAt: Date;
  solution: OptimizationSolution;
  /** True when a fresh computation failed and the last stored route is returned instead. */
  stale?: boolean;
}

/**
 * A route as the postman's app receives it: the stops, legs, ETAs and road geometry - without the
 * optimizer's diagnostics or the name of the algorithm. Postmen consume a route; they never need to
 * know how it was made. (Administrators get the full solution, diagnostics included.)
 */
export type PostmanRouteResponse = Omit<RouteResponse, "solution"> & {
  solution: Omit<OptimizationSolution, "metrics" | "algorithm">;
};

export function toPostmanRoute(route: RouteResponse): PostmanRouteResponse {
  const { metrics, algorithm, ...solution } = route.solution;
  void metrics;
  void algorithm;
  return { ...route, solution };
}

export interface PlanOptions {
  trigger: string;
  start?: LatLng;
}

/**
 * Was this stored route produced by the one and only pipeline, with measured metrics?
 * Routes written by the older strategies (NN_2OPT, the mock) have neither and are
 * recomputed on next read rather than shown as if they were optimized.
 */
function isCurrentPipeline(solution: OptimizationSolution): boolean {
  return solution.algorithm === ROUTE_ALGORITHM && !!solution.metrics;
}

// Serialises route work per postman so a burst of GETs and a status-event
// recompute never race, and the second caller simply reuses the first result.
const locks = new Map<string, Promise<unknown>>();

async function withPostmanLock<T>(postmanId: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(postmanId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(fn);
  locks.set(postmanId, next);
  try {
    return await next;
  } finally {
    if (locks.get(postmanId) === next) locks.delete(postmanId);
  }
}

async function activeDeliveryIds(postmanId: string): Promise<string[]> {
  const rows = await prisma.delivery.findMany({
    where: { assignedPostmanId: postmanId, status: { in: ROUTABLE_STATUSES } },
    select: { id: true },
    orderBy: { createdAt: "asc" }
  });
  return rows.map((r) => r.id);
}

async function loadLatest(postman: Postman): Promise<RouteResponse | null> {
  const request = await prisma.optimizationRequest.findFirst({
    where: {
      postOfficeId: postman.postOfficeId,
      status: "COMPLETED",
      parameters: { path: ["postmanId"], equals: postman.id }
    },
    orderBy: { createdAt: "desc" },
    include: { results: { orderBy: { createdAt: "desc" }, take: 1 } }
  });
  if (!request || request.results.length === 0) return null;

  const version = await prisma.optimizationRequest.count({
    where: {
      postOfficeId: postman.postOfficeId,
      status: "COMPLETED",
      parameters: { path: ["postmanId"], equals: postman.id }
    }
  });
  const params = (request.parameters ?? {}) as { trigger?: string };

  return {
    routeId: request.id,
    version,
    trigger: params.trigger ?? request.requestType,
    status: request.status,
    generatedAt: request.results[0].createdAt,
    solution: request.results[0].resultData as unknown as OptimizationSolution
  };
}

async function computeAndStore(
  postman: Postman,
  ids: string[],
  options: PlanOptions & { fixedOrder?: string[]; fixedClusterIds?: Record<string, number> }
): Promise<RouteResponse> {
  const requestType = options.fixedOrder ? "REOPTIMIZE" : "ROUTE_PLAN";
  const problem: OptimizationProblem = {
    postOfficeId: postman.postOfficeId,
    // The optimizer doesn't need a beat; a postman covering deliveries by
    // override (no assigned beat) still gets a route.
    beatId: postman.assignedBeatId ?? "",
    postmanId: postman.id,
    deliveryIds: ids,
    requestType,
    start: options.start,
    fixedOrder: options.fixedOrder,
    fixedClusterIds: options.fixedClusterIds
  };

  const request = await prisma.optimizationRequest.create({
    data: {
      postOfficeId: postman.postOfficeId,
      requestType,
      parameters: {
        postmanId: postman.id,
        beatId: problem.beatId,
        deliveryIds: ids,
        trigger: options.trigger,
        algorithm: ROUTE_ALGORITHM,
        pruned: !!options.fixedOrder
      } as Prisma.InputJsonObject,
      status: "RUNNING"
    }
  });

  try {
    const service = getOptimizationService();
    const solution =
      requestType === "REOPTIMIZE"
        ? await service.reoptimize(problem, options.trigger)
        : await service.planRoute(problem);

    const result = await prisma.optimizationResult.create({
      data: {
        optimizationRequestId: request.id,
        resultData: solution as unknown as Prisma.InputJsonObject,
        source: solution.algorithm
      }
    });
    await prisma.optimizationRequest.update({ where: { id: request.id }, data: { status: "COMPLETED" } });

    const version = await prisma.optimizationRequest.count({
      where: {
        postOfficeId: postman.postOfficeId,
        status: "COMPLETED",
        parameters: { path: ["postmanId"], equals: postman.id }
      }
    });

    return {
      routeId: request.id,
      version,
      trigger: options.trigger,
      status: "COMPLETED",
      generatedAt: result.createdAt,
      solution
    };
  } catch (err) {
    await prisma.optimizationRequest
      .update({ where: { id: request.id }, data: { status: "FAILED" } })
      .catch(() => undefined);
    throw err;
  }
}

/**
 * The postman's current route. Returns null when they have nothing left to
 * deliver. `refresh: true` forces a full re-optimization.
 */
export async function getOrPlanRoute(
  postman: Postman,
  options: { refresh?: boolean; start?: LatLng; trigger?: string } = {}
): Promise<RouteResponse | null> {
  return withPostmanLock(postman.id, async () => {
    const ids = await activeDeliveryIds(postman.id);
    if (ids.length === 0) return null;

    const latest = await loadLatest(postman);
    const trigger = options.trigger ?? "ROUTE_REQUESTED";

    try {
      if (!options.refresh && latest && isCurrentPipeline(latest.solution)) {
        const storedOrder = latest.solution.stops.map((s) => s.deliveryId);
        const covered = new Set([...storedOrder, ...(latest.solution.unroutable ?? []).map((u) => u.deliveryId)]);
        const activeSet = new Set(ids);

        const hasAddition = ids.some((id) => !covered.has(id));
        const hasRemoval = storedOrder.some((id) => !activeSet.has(id)) || covered.size !== activeSet.size;

        if (!hasAddition && !hasRemoval) return latest;

        if (!hasAddition) {
          // Only removals: keep the order, drop finished stops, refresh legs/geometry.
          return await computeAndStore(postman, ids, {
            trigger: "STOPS_REMOVED",
            start: options.start,
            fixedOrder: storedOrder.filter((id) => activeSet.has(id)),
            fixedClusterIds: Object.fromEntries(
              latest.solution.stops.filter((s) => s.clusterId !== undefined).map((s) => [s.deliveryId, s.clusterId as number])
            )
          });
        }
      }

      return await computeAndStore(postman, ids, {
        trigger: options.refresh ? trigger : "DELIVERIES_CHANGED",
        start: options.start
      });
    } catch (err) {
      logger.error({ err, postmanId: postman.id }, "route computation failed");
      // A stale route is more useful to a postman mid-round than an error.
      if (latest) return { ...latest, stale: true };
      throw err;
    }
  });
}

/** Forces a full run of the one pipeline (manual recalculation and failure events). */
export async function recalculateRoute(postman: Postman, options: PlanOptions): Promise<RouteResponse | null> {
  // A completed delivery only REMOVES a stop: the remaining order is kept (pruned), not reshuffled.
  if (options.trigger === "DELIVERY_COMPLETED") return getOrPlanRoute(postman, options);
  return withPostmanLock(postman.id, async () => {
    const ids = await activeDeliveryIds(postman.id);
    if (ids.length === 0) return null;
    return computeAndStore(postman, ids, options);
  });
}

/** Used by the delivery-event listener, which only has a postman id. */
export async function recalculateRouteForPostmanId(postmanId: string, trigger: string): Promise<void> {
  const postman = await prisma.postman.findUnique({ where: { id: postmanId } });
  if (!postman) return;
  await recalculateRoute(postman, { trigger });
}

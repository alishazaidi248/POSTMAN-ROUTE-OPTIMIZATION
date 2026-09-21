import { DeliveryStatus } from "@prisma/client";
import { env } from "../../config/env";
import { logger } from "../../config/logger";
import { prisma } from "../../config/prisma";
import {
  GeometrySource,
  LatLng,
  OptimizationProblem,
  OptimizationService,
  OptimizationSolution,
  OptimizationStop,
  ROUTE_ALGORITHM,
  RouteGeometry,
  RouteMetrics,
  StartSource,
  UnroutableDelivery
} from "./OptimizationService";
import {
  CostBreakdown,
  CostParams,
  DEFAULT_COST_PARAMS,
  PRIORITY_FACTOR,
  StopLoad,
  evaluateRoute,
  totalLoadOf
} from "./routeAlgorithms";
import { RoutingService, getRoutingService, haversineMeters } from "./routing";
import { AlnsSettings, optimizeWithAlns } from "./clustering";

/**
 * Only deliveries in these states are still "to do" for a postman. Final
 * states (DELIVERED / RETURNED / CANCELLED) and failed-attempt states awaiting
 * a reschedule (RECIPIENT_UNAVAILABLE, REJECTED, WRONG_ADDRESS,
 * ADDRESS_NOT_FOUND, FAILED) are excluded from route optimization.
 */
export const ROUTABLE_STATUSES: DeliveryStatus[] = ["ASSIGNED", "OUT_FOR_DELIVERY", "RESCHEDULED"];

export function isRoutableStatus(status: DeliveryStatus): boolean {
  return ROUTABLE_STATUSES.includes(status);
}

/** A location fix older than this is not trusted as "where the postman is". */
const LOCATION_FRESH_MS = 12 * 60 * 60 * 1000;

export function isUsableCoordinate(latitude: unknown, longitude: unknown): latitude is number {
  return (
    typeof latitude === "number" &&
    typeof longitude === "number" &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180 &&
    !(latitude === 0 && longitude === 0)
  );
}

export interface RoutableDelivery {
  id: string;
  latitude: number;
  longitude: number;
  parcelCount: number;
  priority: string;
  serviceTimeMinutes: number | null;
}

export interface PlanInput {
  postmanId: string;
  beatId: string;
  start: LatLng & { source: StartSource };
  startIgnored?: { source: StartSource; reason: string }[];
  deliveries: RoutableDelivery[];
  unroutable?: UnroutableDelivery[];
  /** Keep this order (stops were only removed); only legs/ETAs/polyline/metrics are refreshed. */
  fixedOrder?: string[];
  fixedClusterIds?: Record<string, number>;
  costParams?: CostParams;
  /** DBSCAN radius in seconds; omitted or <= 0 derives it from the data. */
  dbscanEpsSeconds?: number;
  dbscanMinPoints?: number;
  maxPasses?: number;
  maxMillis?: number;
  /** Bounds of the ALNS stage (the defaults come from the environment). */
  alns?: Partial<AlnsSettings>;
  defaultServiceMinutes?: number;
  now?: Date;
}

const round = (value: number, digits = 1) => {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
};

const percentLower = (before: number, after: number) => (before > 0 ? round(((before - after) / before) * 100, 2) : 0);

const NOT_RUN_ALNS = (cost: number): RouteMetrics["alns"] => ({
  initialCost: cost,
  bestCost: cost,
  iterations: 0,
  improvements: 0,
  acceptedImproving: 0,
  acceptedWorse: 0,
  rejected: 0,
  destroyUsage: {},
  repairUsage: {},
  stoppedBy: "NOT_RUN",
  runtimeMs: 0,
  temperatureStart: 0,
  temperatureEnd: 0,
  clustersPreserved: true
});

type StageMetrics = Pick<
  RouteMetrics,
  | "clusters"
  | "noisePoints"
  | "dbscanEpsSeconds"
  | "dbscanEpsAuto"
  | "dbscanNnCost"
  | "twoOptCost"
  | "alns"
  | "twoOptPasses"
  | "twoOptImprovements"
  | "twoOptStoppedBy"
  | "twoOptReverted"
  | "optimizationMs"
  | "reusedOrder"
>;

/**
 * Plans one route from already-loaded, already-validated inputs:
 *
 *   road matrix -> DBSCAN -> cluster order -> Nearest Neighbor -> 2-opt -> ALNS -> best route -> legs/ETAs -> road polyline
 *
 * No database access - everything external comes in through `routing`, so this is what the
 * unit tests exercise. With `fixedOrder` the stops keep their order (used when a stop was
 * only REMOVED) and only the legs, ETAs, polyline and metrics are refreshed.
 */
export async function planRouteFromInputs(input: PlanInput, routing: RoutingService): Promise<OptimizationSolution> {
  const now = input.now ?? new Date();
  const params = input.costParams ?? DEFAULT_COST_PARAMS;
  const defaultServiceMinutes = input.defaultServiceMinutes ?? env.defaultServiceTimeMinutes;
  const minPts = input.dbscanMinPoints ?? env.dbscanMinPoints;
  const eps = input.dbscanEpsSeconds ?? env.dbscanEpsSeconds;
  const deliveries = input.deliveries;

  const emptyMetrics = (mode: RouteMetrics["matrixMode"]): RouteMetrics => ({
    algorithm: ROUTE_ALGORITHM,
    stops: 0,
    clusters: 0,
    noisePoints: 0,
    dbscanEpsSeconds: eps > 0 ? eps : 0,
    dbscanEpsAuto: !(eps > 0),
    dbscanMinPoints: minPts,
    totalDistanceMeters: 0,
    totalTravelSeconds: 0,
    serviceSeconds: 0,
    travelCost: 0,
    loadPenalty: 0,
    priorityPenalty: 0,
    totalCost: 0,
    loadWeight: params.loadWeight,
    priorityWeight: params.priorityWeight,
    inputOrderCost: 0,
    dbscanNnCost: 0,
    twoOptCost: 0,
    improvementOverInputPercent: 0,
    improvementFrom2OptPercent: 0,
    improvementFromAlnsPercent: 0,
    alns: NOT_RUN_ALNS(0),
    twoOptPasses: 0,
    twoOptImprovements: 0,
    twoOptStoppedBy: "NOT_RUN",
    twoOptReverted: false,
    optimizationMs: 0,
    reusedOrder: false,
    matrixMode: mode,
    osrmMatrixRequests: 0
  });

  const base = {
    postmanId: input.postmanId,
    beatId: input.beatId,
    algorithm: ROUTE_ALGORITHM,
    generatedAt: now.toISOString(),
    start: input.start,
    startIgnored: input.startIgnored?.length ? input.startIgnored : undefined,
    unroutable: input.unroutable ?? []
  };

  if (deliveries.length === 0) {
    const mode = routing.isConfigured ? "ROAD" : "ESTIMATED";
    return {
      ...base,
      stops: [],
      totalDistanceMeters: 0,
      totalTravelTimeSeconds: 0,
      estimatedDurationMinutes: 0,
      totalLoad: 0,
      geometry: null,
      routing: {
        mode,
        provider: routing.isConfigured ? "osrm" : "haversine-estimate",
        geometrySource: "NONE",
        warnings: []
      },
      metrics: emptyMetrics(mode)
    };
  }

  // Node 0 = the route start, node i+1 = deliveries[i]. The start IS part of the matrix, so
  // START->A, A->B, ... are all real road times.
  const points: LatLng[] = [input.start, ...deliveries];
  const matrix = await routing.getMatrix(points);

  const stopLoads: StopLoad[] = deliveries.map((d) => ({
    load: Math.max(0, d.parcelCount ?? 1),
    priorityFactor: PRIORITY_FACTOR[d.priority] ?? 0,
    serviceSeconds: (d.serviceTimeMinutes ?? defaultServiceMinutes) * 60
  }));

  const inputCost = evaluateRoute(
    deliveries.map((_, i) => i),
    matrix.durations,
    stopLoads,
    params
  );

  let order: number[];
  let clusterOfStop: number[] | null = null;
  let finalCost: CostBreakdown;
  let stage: StageMetrics;

  if (input.fixedOrder) {
    // Stops were only removed: keep the order, refresh everything else.
    const startedAt = Date.now();
    const indexById = new Map(deliveries.map((d, i) => [d.id, i]));
    const kept = input.fixedOrder.map((id) => indexById.get(id)).filter((i): i is number => i !== undefined);
    const keptSet = new Set(kept);
    // Anything not covered by the fixed order (shouldn't normally happen) goes last.
    order = [...kept, ...deliveries.map((_, i) => i).filter((i) => !keptSet.has(i))];
    finalCost = evaluateRoute(order, matrix.durations, stopLoads, params);

    if (input.fixedClusterIds) {
      // Keep the clusters the route already had; renumber so they stay 1..k in visiting order.
      const renumber = new Map<number, number>();
      const ids = new Array<number>(deliveries.length).fill(0);
      for (const idx of order) {
        const old = input.fixedClusterIds[deliveries[idx].id] ?? 0;
        if (!renumber.has(old)) renumber.set(old, renumber.size + 1);
        ids[idx] = renumber.get(old) as number;
      }
      clusterOfStop = ids;
    }
    stage = {
      clusters: clusterOfStop ? new Set(clusterOfStop).size : 0,
      noisePoints: 0,
      dbscanEpsSeconds: eps > 0 ? eps : 0,
      dbscanEpsAuto: !(eps > 0),
      dbscanNnCost: finalCost.total,
      twoOptCost: finalCost.total,
      alns: NOT_RUN_ALNS(finalCost.total),
      twoOptPasses: 0,
      twoOptImprovements: 0,
      twoOptStoppedBy: "NOT_RUN",
      twoOptReverted: false,
      optimizationMs: Date.now() - startedAt,
      reusedOrder: true
    };
  } else {
    // The full pipeline: DBSCAN -> cluster order -> Nearest Neighbor -> 2-opt -> ALNS.
    const result = optimizeWithAlns({
      durations: matrix.durations,
      stops: stopLoads,
      params,
      epsSeconds: eps,
      minPts,
      maxPasses: input.maxPasses ?? env.twoOptMaxPasses,
      maxMillis: input.maxMillis ?? env.twoOptMaxMillis,
      alns: {
        maxIterations: input.alns?.maxIterations ?? env.alnsMaxIterations,
        maxMillis: input.alns?.maxMillis ?? env.alnsMaxMs,
        noImprovementLimit: input.alns?.noImprovementLimit ?? env.alnsNoImprovementLimit,
        preserveClusters: input.alns?.preserveClusters ?? env.alnsPreserveClusters,
        seed: input.alns?.seed
      }
    });
    order = result.order;
    clusterOfStop = result.clusterOfStop;
    finalCost = result.finalCost;
    const a = result.alns;
    stage = {
      // Every visited block is a cluster (noise stops are single-stop clusters).
      clusters: result.blocks.length,
      noisePoints: result.noisePoints,
      dbscanEpsSeconds: round(result.epsSeconds, 1),
      dbscanEpsAuto: result.epsAuto,
      dbscanNnCost: result.initialCost.total,
      twoOptCost: result.twoOptCost.total,
      alns: {
        initialCost: round(a.initialCost, 2),
        bestCost: round(a.bestCost, 2),
        iterations: a.iterations,
        improvements: a.improvements,
        acceptedImproving: a.acceptedImproving,
        acceptedWorse: a.acceptedWorse,
        rejected: a.rejected,
        destroyUsage: Object.fromEntries(Object.entries(a.destroyUsage).map(([k, v]) => [k, { ...v, weight: round(v.weight, 3) }])),
        repairUsage: Object.fromEntries(Object.entries(a.repairUsage).map(([k, v]) => [k, { ...v, weight: round(v.weight, 3) }])),
        stoppedBy: a.stoppedBy,
        runtimeMs: a.runtimeMs,
        temperatureStart: round(a.temperatureStart, 3),
        temperatureEnd: round(a.temperatureEnd, 4),
        clustersPreserved: a.clustersPreserved
      },
      twoOptPasses: result.twoOptPasses,
      twoOptImprovements: result.twoOptImprovements,
      twoOptStoppedBy: result.twoOptStoppedBy,
      twoOptReverted: result.twoOptReverted,
      optimizationMs: result.totalOptimizationMs,
      reusedOrder: false
    };
  }

  // Assemble stops with per-leg distance/time and a running ETA.
  const stops: OptimizationStop[] = [];
  let prevNode = 0;
  let clockSeconds = 0;
  let totalDistance = 0;
  let totalTravel = 0;
  let totalService = 0;

  order.forEach((deliveryIdx, position) => {
    const node = deliveryIdx + 1;
    const legSeconds = matrix.durations[prevNode][node];
    const legMeters = matrix.distances[prevNode][node];
    const delivery = deliveries[deliveryIdx];

    clockSeconds += legSeconds;
    totalTravel += legSeconds;
    totalDistance += legMeters;

    stops.push({
      deliveryId: delivery.id,
      sequence: position + 1,
      latitude: delivery.latitude,
      longitude: delivery.longitude,
      estimatedArrival: new Date(now.getTime() + clockSeconds * 1000).toISOString(),
      distanceFromPreviousMeters: Math.round(legMeters),
      travelTimeFromPreviousSeconds: Math.round(legSeconds),
      load: stopLoads[deliveryIdx].load,
      priority: delivery.priority,
      serviceTimeMinutes: stopLoads[deliveryIdx].serviceSeconds / 60,
      ...(clusterOfStop ? { clusterId: clusterOfStop[deliveryIdx] } : {})
    });

    clockSeconds += stopLoads[deliveryIdx].serviceSeconds;
    totalService += stopLoads[deliveryIdx].serviceSeconds;
    prevNode = node;
  });

  // Road polyline for the final order. Falls back to a flagged straight guide.
  const warnings = [...matrix.warnings];
  const orderedPoints: LatLng[] = [input.start, ...order.map((i) => deliveries[i])];
  const road = matrix.mode === "ROAD" ? await routing.getRoadRoute(orderedPoints) : null;

  let geometry: RouteGeometry | null;
  let geometrySource: GeometrySource;
  if (road) {
    geometry = road.geometry;
    geometrySource = "ROAD";
  } else {
    geometry = {
      type: "LineString",
      coordinates: orderedPoints.map((p) => [p.longitude, p.latitude] as [number, number])
    };
    geometrySource = "STRAIGHT_LINE";
    if (matrix.mode === "ROAD") {
      warnings.push("Road geometry could not be retrieved: the map line is a straight-line guide, not a road path.");
    }
  }

  const metrics: RouteMetrics = {
    algorithm: ROUTE_ALGORITHM,
    stops: stops.length,
    ...stage,
    dbscanMinPoints: minPts,
    totalDistanceMeters: Math.round(totalDistance),
    totalTravelSeconds: Math.round(totalTravel),
    serviceSeconds: Math.round(totalService),
    travelCost: round(finalCost.travel, 1),
    loadPenalty: round(finalCost.loadPenalty, 2),
    priorityPenalty: round(finalCost.priorityPenalty, 2),
    totalCost: round(finalCost.total, 2),
    loadWeight: params.loadWeight,
    priorityWeight: params.priorityWeight,
    inputOrderCost: round(inputCost.total, 2),
    dbscanNnCost: round(stage.dbscanNnCost, 2),
    twoOptCost: round(stage.twoOptCost, 2),
    improvementOverInputPercent: percentLower(inputCost.total, finalCost.total),
    improvementFrom2OptPercent: percentLower(stage.dbscanNnCost, stage.twoOptCost),
    improvementFromAlnsPercent: percentLower(stage.twoOptCost, finalCost.total),
    matrixMode: matrix.mode,
    osrmMatrixRequests: matrix.requests
  };

  logger.info(
    {
      postmanId: input.postmanId,
      algorithm: metrics.algorithm,
      stops: metrics.stops,
      clusters: metrics.clusters,
      eps: metrics.dbscanEpsSeconds,
      cost: { input: metrics.inputOrderCost, dbscanNn: metrics.dbscanNnCost, twoOpt: metrics.twoOptCost, final: metrics.totalCost },
      alns: { iterations: metrics.alns.iterations, improvements: metrics.alns.improvements, stoppedBy: metrics.alns.stoppedBy, ms: metrics.alns.runtimeMs },
      twoOpt: {
        passes: metrics.twoOptPasses,
        improvements: metrics.twoOptImprovements,
        stoppedBy: metrics.twoOptStoppedBy
      },
      ms: metrics.optimizationMs,
      reusedOrder: metrics.reusedOrder,
      matrix: metrics.matrixMode,
      osrmRequests: metrics.osrmMatrixRequests
    },
    "route planned"
  );

  return {
    ...base,
    stops,
    totalDistanceMeters: Math.round(totalDistance),
    totalTravelTimeSeconds: Math.round(totalTravel),
    estimatedDurationMinutes: round((totalTravel + totalService) / 60, 1),
    totalLoad: totalLoadOf(stopLoads),
    geometry,
    routing: { mode: matrix.mode, provider: matrix.provider, geometrySource, warnings },
    metrics,
    reusedOrder: stage.reusedOrder
  };
}

/**
 * Where the route begins, in priority order:
 *   1. a start supplied with the request (the app's live GPS fix)
 *   2. the postman's most recent location ping (< 12h old)
 *   3. the post office (the depot)
 * A candidate farther than ROUTE_START_MAX_KM from the post office is not a plausible
 * place for a delivery round to begin (a stray GPS fix, a developer's laptop in another
 * city): it is passed over and REPORTED, so a route is never planned from hundreds of km
 * away. Never a hard-coded coordinate.
 */
export async function resolveRouteStart(problem: OptimizationProblem): Promise<{
  start: LatLng & { source: StartSource };
  ignored: { source: StartSource; reason: string }[];
}> {
  const office = await prisma.postOffice.findUniqueOrThrow({
    where: { id: problem.postOfficeId },
    select: { latitude: true, longitude: true }
  });
  const maxMeters = env.routeStartMaxKm * 1000;
  const ignored: { source: StartSource; reason: string }[] = [];

  const accept = (source: StartSource, p: LatLng): (LatLng & { source: StartSource }) | null => {
    const meters = haversineMeters(p, office);
    if (meters > maxMeters) {
      ignored.push({
        source,
        reason: `${Math.round(meters / 1000)} km from the post office (limit ${env.routeStartMaxKm} km)`
      });
      return null;
    }
    return { latitude: p.latitude, longitude: p.longitude, source };
  };

  if (problem.start && isUsableCoordinate(problem.start.latitude, problem.start.longitude)) {
    const chosen = accept("REQUEST", problem.start);
    if (chosen) return { start: chosen, ignored };
  }

  const lastPing = await prisma.postmanLocationHistory.findFirst({
    where: { postmanId: problem.postmanId, recordedAt: { gte: new Date(Date.now() - LOCATION_FRESH_MS) } },
    orderBy: { recordedAt: "desc" },
    select: { latitude: true, longitude: true }
  });
  if (lastPing && isUsableCoordinate(lastPing.latitude, lastPing.longitude)) {
    const chosen = accept("POSTMAN_LOCATION", lastPing);
    if (chosen) return { start: chosen, ignored };
  }

  return { start: { latitude: office.latitude, longitude: office.longitude, source: "POST_OFFICE" }, ignored };
}

export class RoadRouteOptimizationService implements OptimizationService {
  async planRoute(problem: OptimizationProblem): Promise<OptimizationSolution> {
    return this.solve(problem);
  }

  async reoptimize(problem: OptimizationProblem, triggerEvent: string): Promise<OptimizationSolution> {
    logger.info({ postmanId: problem.postmanId, trigger: triggerEvent }, "re-optimizing route");
    return this.solve(problem);
  }

  private async solve(problem: OptimizationProblem): Promise<OptimizationSolution> {
    const rows = await prisma.delivery.findMany({
      where: { id: { in: problem.deliveryIds } },
      include: { address: { select: { latitude: true, longitude: true } } }
    });

    const byId = new Map(rows.map((r) => [r.id, r]));
    const deliveries: RoutableDelivery[] = [];
    const unroutable: UnroutableDelivery[] = [];

    for (const id of problem.deliveryIds) {
      const row = byId.get(id);
      if (!row) {
        unroutable.push({ deliveryId: id, reason: "NOT_FOUND" });
        continue;
      }
      if (!isRoutableStatus(row.status)) {
        unroutable.push({ deliveryId: id, reason: "NOT_ROUTABLE_STATUS" });
        continue;
      }
      const { latitude, longitude } = row.address;
      if (latitude == null || longitude == null) {
        unroutable.push({ deliveryId: id, reason: "MISSING_COORDINATES" });
        continue;
      }
      if (!isUsableCoordinate(latitude, longitude)) {
        unroutable.push({ deliveryId: id, reason: "INVALID_COORDINATES" });
        continue;
      }
      deliveries.push({
        id: row.id,
        latitude,
        longitude,
        parcelCount: row.parcelCount,
        priority: row.priority,
        serviceTimeMinutes: row.serviceTimeMinutes
      });
    }

    const { start, ignored } = await resolveRouteStart(problem);

    return planRouteFromInputs(
      {
        postmanId: problem.postmanId,
        beatId: problem.beatId,
        start,
        startIgnored: ignored,
        deliveries,
        unroutable,
        fixedOrder: problem.fixedOrder,
        fixedClusterIds: problem.fixedClusterIds
      },
      getRoutingService()
    );
  }
}

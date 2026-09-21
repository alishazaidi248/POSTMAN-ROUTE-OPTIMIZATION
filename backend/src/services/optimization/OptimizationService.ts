export interface LatLng {
  latitude: number;
  longitude: number;
}

export type RoutingMode = "ROAD" | "ESTIMATED";
export type GeometrySource = "ROAD" | "STRAIGHT_LINE" | "NONE";
export type StartSource = "REQUEST" | "POSTMAN_LOCATION" | "POST_OFFICE";

/**
 * The ONLY route algorithm in the application: DBSCAN clusters (over road travel
 * times), Nearest Neighbor inside/between clusters, 2-opt, then ALNS (adaptive large
 * neighborhood search) starting from that route. It is not a setting:
 * nothing in the API, the database or the apps can select another one, and a client
 * that sends an `algorithm` is simply ignored.
 */
export const ROUTE_ALGORITHM = "DBSCAN_NN_2OPT_ALNS" as const;
export type RouteAlgorithm = typeof ROUTE_ALGORITHM;

export interface OptimizationStop {
  deliveryId: string;
  sequence: number;
  latitude: number;
  longitude: number;
  estimatedArrival: string;
  /** Road (or estimated) distance from the previous stop / the start. */
  distanceFromPreviousMeters?: number;
  travelTimeFromPreviousSeconds?: number;
  /** Parcel load carried for this stop (Delivery.parcelCount - there is no weight field). */
  load?: number;
  priority?: string;
  serviceTimeMinutes?: number;
  /** 1-based position of this stop's DBSCAN cluster in the visiting order. */
  clusterId?: number;
}

export interface OptimizationProblem {
  postOfficeId: string;
  beatId: string;
  postmanId: string;
  deliveryIds: string[];
  requestType: "ROUTE_PLAN" | "REOPTIMIZE";
  /** Where the route begins (e.g. the postman's live GPS fix). When absent - or when it
   * is implausible (see ROUTE_START_MAX_KM) - the service falls back to the postman's last
   * known location, then the post office. Never a hard-coded coordinate. */
  start?: LatLng;
  /** Keep this stop order instead of running the full pipeline (used to prune delivered
   * stops without reshuffling the rest of the route). */
  fixedOrder?: string[];
  /** Cluster numbers to carry over when `fixedOrder` prunes a route. */
  fixedClusterIds?: Record<string, number>;
}

export interface UnroutableDelivery {
  deliveryId: string;
  reason: "MISSING_COORDINATES" | "INVALID_COORDINATES" | "IMPRECISE_LOCATION" | "NOT_ROUTABLE_STATUS" | "NOT_FOUND";
}

export interface RouteGeometry {
  type: "LineString";
  /** [longitude, latitude] pairs, start first. */
  coordinates: [number, number][];
}

export interface AlnsOperatorMetrics {
  used: number;
  newBest: number;
  improved: number;
  acceptedWorse: number;
  /** The operator's adaptive weight when the search ended. */
  weight: number;
}

/** What the ALNS stage did. Diagnostics for administrators and research; never shown to postmen. */
export interface AlnsMetrics {
  /** Cost of the route ALNS started from (after DBSCAN + NN + 2-opt). */
  initialCost: number;
  /** Cost of the best route ALNS found (never above initialCost). */
  bestCost: number;
  iterations: number;
  /** Times a new best route was found. */
  improvements: number;
  acceptedImproving: number;
  acceptedWorse: number;
  rejected: number;
  destroyUsage: Record<string, AlnsOperatorMetrics>;
  repairUsage: Record<string, AlnsOperatorMetrics>;
  stoppedBy: "MAX_ITERATIONS" | "TIME_LIMIT" | "NO_IMPROVEMENT" | "NOT_RUN";
  runtimeMs: number;
  temperatureStart: number;
  temperatureEnd: number;
  /** true: every DBSCAN cluster stays one unbroken run; false: stops may move between clusters. */
  clustersPreserved: boolean;
}

/**
 * Everything measured about one planned route: what it costs under the cost function
 * (see routeAlgorithms.ts) at each stage, and how the optimizer got there. Not shown
 * to postmen; it is how a route is proven, debugged and compared.
 */
export interface RouteMetrics {
  algorithm: RouteAlgorithm;
  stops: number;
  clusters: number;
  /** Stops that fell in no DBSCAN cluster (each visited as its own single-stop cluster). */
  noisePoints: number;
  dbscanEpsSeconds: number;
  dbscanEpsAuto: boolean;
  dbscanMinPoints: number;

  totalDistanceMeters: number;
  /** Driving time only. */
  totalTravelSeconds: number;
  /** Dwell time at the stops. */
  serviceSeconds: number;

  /** The three parts of the cost of the FINAL route, and their sum. */
  travelCost: number;
  loadPenalty: number;
  priorityPenalty: number;
  totalCost: number;
  loadWeight: number;
  priorityWeight: number;
  /**
   * What the "load" in the cost is made of. WEIGHT_KG: every stop has a real weight (Delivery.weightKg).
   * PARTIAL_WEIGHT_KG: some do; the others are given the median known weight. NONE: no stop has a weight, so the load
   * term is switched off (loadWeight is reported as 0) - a parcel COUNT is never treated as a weight.
   */
  loadBasis: "WEIGHT_KG" | "PARTIAL_WEIGHT_KG" | "NONE";

  /** Cost of the stops in input (database) order: what no optimization would give. */
  inputOrderCost: number;
  /** Cost after DBSCAN + Nearest Neighbor, before 2-opt. */
  dbscanNnCost: number;
  /** Cost after DBSCAN + Nearest Neighbor + 2-opt, before ALNS. */
  twoOptCost: number;
  /** improvement of the FINAL route over the input order. */
  improvementOverInputPercent: number;
  /** How much 2-opt took off dbscanNnCost. Never negative. */
  improvementFrom2OptPercent: number;
  /** How much ALNS took off twoOptCost. Never negative. */
  improvementFromAlnsPercent: number;
  alns: AlnsMetrics;

  twoOptPasses: number;
  twoOptImprovements: number;
  twoOptStoppedBy: "CONVERGED" | "MAX_PASSES" | "TIME_LIMIT" | "NOT_RUN";
  twoOptReverted: boolean;
  optimizationMs: number;

  /** True when the previous order was kept and only legs/ETAs/polyline were refreshed. */
  reusedOrder: boolean;
  matrixMode: RoutingMode;
  /** Routing-engine matrix requests this plan needed (0 = answered entirely from the cache). */
  osrmMatrixRequests: number;
}

export interface OptimizationSolution {
  postmanId: string;
  beatId: string;
  stops: OptimizationStop[];
  totalDistanceMeters: number;
  estimatedDurationMinutes: number;
  algorithm: RouteAlgorithm;
  generatedAt: string;
  metrics: RouteMetrics;
  start?: LatLng & { source: StartSource };
  /** Start candidates that were passed over (e.g. a GPS fix hundreds of km from the post office). */
  startIgnored?: { source: StartSource; reason: string }[];
  totalTravelTimeSeconds?: number;
  totalLoad?: number;
  geometry?: RouteGeometry | null;
  routing?: {
    mode: RoutingMode;
    provider: string;
    geometrySource: GeometrySource;
    warnings: string[];
  };
  /** Deliveries that could not be routed, with the reason - reported, never silently dropped. */
  unroutable?: UnroutableDelivery[];
  reusedOrder?: boolean;
}

/** The single seam through which routes are planned. */
export interface OptimizationService {
  planRoute(problem: OptimizationProblem): Promise<OptimizationSolution>;
  reoptimize(problem: OptimizationProblem, triggerEvent: string): Promise<OptimizationSolution>;
}

export interface OptimizationStop {
  deliveryId: string;
  sequence: number;
  latitude: number;
  longitude: number;
  estimatedArrival: string;
}

export interface OptimizationProblem {
  postOfficeId: string;
  beatId: string;
  postmanId: string;
  deliveryIds: string[];
  requestType: "ROUTE_PLAN" | "REOPTIMIZE";
  parameters?: Record<string, unknown>;
}

export interface OptimizationSolution {
  postmanId: string;
  beatId: string;
  stops: OptimizationStop[];
  totalDistanceMeters: number;
  estimatedDurationMinutes: number;
  algorithm: string;
  generatedAt: string;
}

/**
 * The admin app never implements GA/ACO/ALNS/DBSCAN/etc itself (spec §35,
 * §36). This interface is the sole seam the external research optimization
 * engine plugs into. MockOptimizationService below returns deterministic
 * placeholder data for local development only.
 */
export interface OptimizationService {
  planRoute(problem: OptimizationProblem): Promise<OptimizationSolution>;
  reoptimize(problem: OptimizationProblem, triggerEvent: string): Promise<OptimizationSolution>;
}

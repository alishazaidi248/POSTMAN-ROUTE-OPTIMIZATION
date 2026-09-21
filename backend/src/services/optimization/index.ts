import { OptimizationService } from "./OptimizationService";
import { RoadRouteOptimizationService } from "./RoadRouteOptimizationService";

let instance: OptimizationService | null = null;

/** The one optimizer: DBSCAN -> Nearest Neighbor -> 2-opt -> ALNS over the road travel-time matrix. */
export function getOptimizationService(): OptimizationService {
  if (!instance) instance = new RoadRouteOptimizationService();
  return instance;
}

/** Test seam. Pass null to reset. */
export function setOptimizationServiceForTests(service: OptimizationService | null): void {
  instance = service;
}

export * from "./OptimizationService";

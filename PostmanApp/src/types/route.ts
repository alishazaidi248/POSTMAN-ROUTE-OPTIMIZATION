// Mirrors backend/src/services/optimization/OptimizationService.ts
// (OptimizationStop / OptimizationSolution) — the mobile app only ever
// *consumes* this contract; it must never implement routing algorithms
// itself (spec §31).
export interface OptimizationStop {
  deliveryId: string;
  sequence: number;
  latitude: number;
  longitude: number;
  estimatedArrival: string;
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

export type ReoptimizeTrigger =
  | "DELIVERY_COMPLETED"
  | "RECIPIENT_UNAVAILABLE"
  | "WRONG_ADDRESS"
  | "ADDRESS_NOT_FOUND"
  | "DELIVERY_FAILED"
  | "ROUTE_DEVIATION"
  | "MANUAL";

export interface CurrentRouteResponse {
  route: null;
}

export interface ActiveRouteResponse {
  routeId: string;
  version: number;
  trigger: string;
  status: string;
  generatedAt: string;
  solution: OptimizationSolution;
}

export type RouteResponse = CurrentRouteResponse | ActiveRouteResponse;

export function hasActiveRoute(response: RouteResponse): response is ActiveRouteResponse {
  return "solution" in response;
}

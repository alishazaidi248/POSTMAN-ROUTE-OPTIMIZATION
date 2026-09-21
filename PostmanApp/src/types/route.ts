// Mirrors backend/src/services/optimization/OptimizationService.ts
// (OptimizationStop / OptimizationSolution) — the mobile app only ever
// *consumes* this contract; it must never implement routing algorithms
// itself (spec §31). Everything past the original five stop fields is
// optional/additive so a route stored by an older backend still parses.
export interface OptimizationStop {
  deliveryId: string;
  sequence: number;
  latitude: number;
  longitude: number;
  estimatedArrival: string;
  /** Road (or estimated, see routing.mode) distance from the previous stop / the start. */
  distanceFromPreviousMeters?: number;
  travelTimeFromPreviousSeconds?: number;
  /** Parcel load for the stop (Delivery.parcelCount). */
  load?: number;
  priority?: string;
  serviceTimeMinutes?: number;
  /** Backend-internal grouping; the app does not use or show it. */
  clusterId?: number;
}

export type RoutingMode = "ROAD" | "ESTIMATED";
export type GeometrySource = "ROAD" | "STRAIGHT_LINE" | "NONE";
export type StartSource = "REQUEST" | "POSTMAN_LOCATION" | "POST_OFFICE";

export interface RouteStart {
  latitude: number;
  longitude: number;
  source: StartSource;
}

export interface RouteGeometry {
  type: "LineString";
  /** [longitude, latitude] pairs, start first. */
  coordinates: [number, number][];
}

export interface OptimizationSolution {
  postmanId: string;
  beatId: string;
  stops: OptimizationStop[];
  totalDistanceMeters: number;
  estimatedDurationMinutes: number;
  generatedAt: string;
  start?: RouteStart;
  /** Start candidates passed over (e.g. a GPS fix far from the post office). */
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
  reusedOrder?: boolean;
  unroutable?: { deliveryId: string; reason: string }[];
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
  /** The server could not refresh the route and returned the last stored one. */
  stale?: boolean;
}

export type RouteResponse = CurrentRouteResponse | ActiveRouteResponse;

export function hasActiveRoute(response: RouteResponse): response is ActiveRouteResponse {
  return "solution" in response;
}

/** True when the route line/ETAs are road-network based (not straight-line estimates). */
export function hasRoadGeometry(route: ActiveRouteResponse | null | undefined): boolean {
  return route?.solution.routing?.geometrySource === "ROAD";
}

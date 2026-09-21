import { axiosClient } from "./axiosClient";
import { getLastFix } from "../services/lastFix";
import { ActiveRouteResponse, ReoptimizeTrigger, RouteResponse } from "../types/route";

// The first request after the delivery set changes makes the server build a
// road matrix and polyline (two routing-engine calls), so it gets a longer
// timeout than the app's 15s default.
const ROUTE_TIMEOUT_MS = 30_000;

export interface RouteStartPoint {
  latitude: number;
  longitude: number;
}

// The app never says HOW to plan a route - there is no algorithm parameter anywhere in this
// file. The backend always runs its one pipeline; the app only reports where the postman is.
export const routeApi = {
  async getCurrentRoute(): Promise<RouteResponse> {
    const fix = getLastFix();
    const { data } = await axiosClient.get<RouteResponse>("/me/route", {
      timeout: ROUTE_TIMEOUT_MS,
      params: fix ? { startLat: fix.latitude, startLng: fix.longitude } : undefined
    });
    return data;
  },
  /**
   * Asks the server to re-run route optimization for the remaining deliveries,
   * beginning at the given GPS fix (or, when omitted, the latest one the device knows).
   */
  async reoptimize(
    trigger: ReoptimizeTrigger,
    start?: RouteStartPoint
  ): Promise<ActiveRouteResponse | { route: null; message: string }> {
    const from = start ?? getLastFix() ?? undefined;
    const { data } = await axiosClient.post(
      "/me/route/reoptimize",
      { trigger, ...(from ? { start: { latitude: from.latitude, longitude: from.longitude } } : {}) },
      { timeout: ROUTE_TIMEOUT_MS }
    );
    return data;
  }
};

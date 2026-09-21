import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SERVER_POLL_MS } from "../config/polling";
import { routeApi, RouteStartPoint } from "../api/routeApi";
import { offlineStorage } from "../storage/offlineStorage";
import { ApiError } from "../types/api";
import { hasActiveRoute, ReoptimizeTrigger, RouteResponse } from "../types/route";

export const routeQueryOptions = () =>
  queryOptions({
    queryKey: ["route", "current"],
    queryFn: async (): Promise<RouteResponse> => {
      try {
        const data = await routeApi.getCurrentRoute();
        await offlineStorage.setCachedRoute(data);
        return data;
      } catch (err) {
        // Offline: fall back to the last route this device saw rather than
        // showing an error in the middle of a round.
        if (err instanceof ApiError && err.isNetworkError) {
          const cached = await offlineStorage.getCachedRoute<RouteResponse>();
          if (cached) return cached;
        }
        throw err;
      }
    },
    // The server decides when a route is stale (the delivery set changed); asking
    // again is cheap when nothing changed, so it follows the deliveries' cadence.
    staleTime: 60_000,
    refetchInterval: SERVER_POLL_MS
  });

export function useCurrentRoute() {
  return useQuery({
    ...routeQueryOptions(),
    select: (data) => (hasActiveRoute(data) ? data : null)
  });
}

interface ReoptimizeInput {
  trigger: ReoptimizeTrigger;
  /** Begin the recalculated route at this position (the device's GPS fix). */
  start?: RouteStartPoint;
}

export function useReoptimizeRoute() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ReoptimizeTrigger | ReoptimizeInput) =>
      typeof input === "string" ? routeApi.reoptimize(input) : routeApi.reoptimize(input.trigger, input.start),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["route"] });
    }
  });
}

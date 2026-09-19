import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { routeApi } from "../api/routeApi";
import { offlineStorage } from "../storage/offlineStorage";
import { hasActiveRoute, ReoptimizeTrigger } from "../types/route";

export function useCurrentRoute() {
  return useQuery({
    queryKey: ["route", "current"],
    queryFn: async () => {
      const data = await routeApi.getCurrentRoute();
      await offlineStorage.setCachedRoute(data);
      return data;
    },
    staleTime: 30_000,
    select: (data) => (hasActiveRoute(data) ? data : null)
  });
}

export function useReoptimizeRoute() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (trigger: ReoptimizeTrigger) => routeApi.reoptimize(trigger),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["route"] });
    }
  });
}

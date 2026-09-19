import { useMemo } from "react";
import { useCurrentRoute } from "../../hooks/useRoute";
import { useDeliveries } from "../../hooks/useDeliveries";
import { findCurrentAndNext } from "../../services/routeService";

/**
 * Platform-independent route/delivery data for the Map screen. Shared by
 * MapScreen.native.tsx (@maplibre/maplibre-react-native) and
 * MapScreen.web.tsx (maplibre-gl) so the two map renderers stay in sync
 * without duplicating the query/derivation logic.
 */
export function useMapScreenData() {
  const routeQuery = useCurrentRoute();
  const deliveriesQuery = useDeliveries();

  const statusByDeliveryId = useMemo(() => {
    const map: Record<string, { status: string; name: string }> = {};
    for (const d of deliveriesQuery.data?.rows ?? []) {
      map[d.id] = { status: d.status, name: d.recipient.name };
    }
    return map;
  }, [deliveriesQuery.data]);

  const route = routeQuery.data ?? null;

  const completedIds = useMemo(
    () => new Set((deliveriesQuery.data?.rows ?? []).filter((d) => d.status === "DELIVERED").map((d) => d.id)),
    [deliveriesQuery.data]
  );

  const { current, next } = route
    ? findCurrentAndNext(route.solution.stops, completedIds)
    : { current: null, next: null };

  const recipientNameByDeliveryId = useMemo(
    () => Object.fromEntries(Object.entries(statusByDeliveryId).map(([id, v]) => [id, v.name])),
    [statusByDeliveryId]
  );

  return {
    isLoading: routeQuery.isLoading || deliveriesQuery.isLoading,
    isError: routeQuery.isError,
    refetch: () => routeQuery.refetch(),
    route,
    statusByDeliveryId,
    completedIds,
    current,
    next,
    recipientNameByDeliveryId
  };
}

import { useCallback, useMemo } from "react";
import { useCurrentRoute } from "../../hooks/useRoute";
import { useDeliveries, usePendingStatusOverrides } from "../../hooks/useDeliveries";
import { SelectionSource, useRouteStore } from "../../store/routeStore";
import { OptimizationStop, hasRoadGeometry } from "../../types/route";
import {
  StopView,
  buildMarkerModels,
  buildRouteLine,
  buildStopViews,
  countRemaining,
  findNextStop
} from "../../utils/routeView";

/**
 * Platform-independent route/delivery data for the Map screen. Shared by
 * MapScreen.native.tsx (@maplibre/maplibre-react-native) and
 * MapScreen.web.tsx (maplibre-gl) so the two map renderers stay in sync
 * without duplicating the query/derivation logic — and so the map and the
 * Deliveries tab are always built from the same StopViews (same numbering,
 * same "next stop", same completed/pending state, same offline overrides).
 */
export function useMapScreenData() {
  const routeQuery = useCurrentRoute();
  const deliveriesQuery = useDeliveries();
  const overrides = usePendingStatusOverrides();
  const selectedDeliveryId = useRouteStore((s) => s.selectedDeliveryId);
  const selectDeliveryInStore = useRouteStore((s) => s.selectDelivery);

  const route = routeQuery.data ?? null;
  const rows = deliveriesQuery.data?.rows;

  const views: StopView[] = useMemo(() => buildStopViews(rows ?? [], route, overrides), [rows, route, overrides]);
  const markers = useMemo(() => buildMarkerModels(views, selectedDeliveryId), [views, selectedDeliveryId]);
  const routeLine = useMemo(() => buildRouteLine(route), [route]);

  const next = useMemo(() => findNextStop(views), [views]);
  const remaining = useMemo(() => countRemaining(views), [views]);
  const doneCount = useMemo(() => views.filter((v) => v.state === "DONE").length, [views]);
  const selectedView = useMemo(
    () => views.find((v) => v.delivery.id === selectedDeliveryId) ?? null,
    [views, selectedDeliveryId]
  );

  // Remaining stops still on the road route, in order — for the summary card.
  const pendingRouteStops: OptimizationStop[] = useMemo(
    () => views.filter((v) => v.stop && (v.state === "NEXT" || v.state === "PENDING")).map((v) => v.stop as OptimizationStop),
    [views]
  );

  const recipientNameByDeliveryId = useMemo(
    () => Object.fromEntries(views.map((v) => [v.delivery.id, v.delivery.recipient.name])),
    [views]
  );

  const select = useCallback(
    (deliveryId: string | null, source: SelectionSource = "map") => selectDeliveryInStore(deliveryId, source),
    [selectDeliveryInStore]
  );

  return {
    isLoading: routeQuery.isLoading || deliveriesQuery.isLoading,
    // A failed *route* fetch must not hide the deliveries that did load: the map
    // still shows the pins, just without a route line.
    isError: deliveriesQuery.isError && !deliveriesQuery.data,
    routeError: routeQuery.isError,
    isRefreshing: routeQuery.isFetching || deliveriesQuery.isFetching,
    refetch: () => Promise.all([routeQuery.refetch(), deliveriesQuery.refetch()]),
    route,
    roadGeometry: hasRoadGeometry(route),
    routeIsStale: !!route?.stale,
    views,
    markers,
    routeLine,
    start: route?.solution.start ?? null,
    next,
    remaining,
    doneCount,
    total: views.length,
    selectedView,
    selectedDeliveryId,
    select,
    pendingRouteStops,
    recipientNameByDeliveryId
  };
}

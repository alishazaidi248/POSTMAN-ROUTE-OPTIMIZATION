import { useMemo } from "react";
import { useCurrentRoute } from "../../hooks/useRoute";
import { useDeliveries } from "../../hooks/useDeliveries";
import { findCurrentAndNext } from "../../services/routeService";
import { OptimizationStop } from "../../types/route";
import { validateAndLogCoordinates } from "../../utils/coordinates";

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

  // Before an optimized route exists (or while it's being (re)generated),
  // still plot assigned deliveries that have geocoded coordinates so the map
  // isn't blank — this is deliberately NOT presented as a route: no
  // sequence numbers/polyline, just raw pin locations (spec §12 "assigned
  // delivery locations" is independent of §14 route optimization).
  const unroutedStops: OptimizationStop[] = useMemo(() => {
    if (route) return [];
    const candidates = (deliveriesQuery.data?.rows ?? []).filter((d) => d.status !== "DELIVERED");
    // Coordinate validation (spec §"COORDINATE VALIDATION"): every address
    // is checked for null/NaN/(0,0)/out-of-range/likely lat-lng-reversal
    // before it's allowed near the map — bad ones are dropped (never
    // silently "fixed" by swapping lat/lng) and logged in dev so a broken
    // geocode is visible instead of just vanishing.
    const valid = validateAndLogCoordinates(
      candidates,
      (d) => ({ latitude: d.address.latitude, longitude: d.address.longitude }),
      (d) => `delivery ${d.trackingId} (${d.recipient.name})`
    );
    return valid.map((d, index) => ({
      deliveryId: d.id,
      sequence: index + 1,
      latitude: d.address.latitude as number,
      longitude: d.address.longitude as number,
      estimatedArrival: ""
    }));
  }, [route, deliveriesQuery.data]);

  return {
    isLoading: routeQuery.isLoading || deliveriesQuery.isLoading,
    isError: routeQuery.isError,
    refetch: () => routeQuery.refetch(),
    route,
    statusByDeliveryId,
    completedIds,
    current,
    next,
    recipientNameByDeliveryId,
    unroutedStops
  };
}

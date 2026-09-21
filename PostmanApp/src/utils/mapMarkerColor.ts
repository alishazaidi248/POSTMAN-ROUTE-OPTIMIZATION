import { colors } from "../theme/colors";
import { DeliveryStatus } from "../types/delivery";
import { classifyDeliveryStatus } from "./status";

/**
 * Shared status->color mapping for delivery markers. Deliberately has no
 * dependency on any map library (native or web) so both
 * components/map/DeliveryMarker.tsx (@maplibre/maplibre-react-native) and
 * components/map/WebMapView.web.tsx (maplibre-gl) can import it without
 * pulling the other platform's native/web-only map package into their
 * bundle. Uses the same canonical classification as the filter chips and
 * stats (src/utils/status.ts) rather than its own status list, so a marker
 * is never colored inconsistently with how that same delivery is filtered
 * or counted elsewhere.
 */
export function markerColor(status: DeliveryStatus, isCurrent: boolean): string {
  if (isCurrent) return colors.mapCurrent;
  const bucket = classifyDeliveryStatus(status);
  if (bucket === "COMPLETED") return colors.mapCompleted;
  if (bucket === "FAILED") return colors.mapFailed;
  return colors.mapPending;
}

/** Marker fill for a StopView state (utils/routeView.ts): the next stop is
 * blue, the rest of the round amber, finished stops green, failed ones red. */
export function stateColor(state: "NEXT" | "PENDING" | "DONE" | "FAILED"): string {
  switch (state) {
    case "NEXT":
      return colors.mapCurrent;
    case "DONE":
      return colors.mapCompleted;
    case "FAILED":
      return colors.mapFailed;
    default:
      return colors.mapPending;
  }
}

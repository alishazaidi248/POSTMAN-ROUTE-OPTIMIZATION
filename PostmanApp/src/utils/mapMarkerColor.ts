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

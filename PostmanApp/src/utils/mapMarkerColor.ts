import { colors } from "../theme/colors";
import { DeliveryStatus } from "../types/delivery";

const FAILED_LIKE: DeliveryStatus[] = ["FAILED", "REJECTED", "WRONG_ADDRESS", "ADDRESS_NOT_FOUND", "RETURNED", "CANCELLED"];

/**
 * Shared status->color mapping for delivery markers. Deliberately has no
 * dependency on any map library (native or web) so both
 * components/map/DeliveryMarker.tsx (@maplibre/maplibre-react-native) and
 * components/map/WebMapView.web.tsx (maplibre-gl) can import it without
 * pulling the other platform's native/web-only map package into their
 * bundle.
 */
export function markerColor(status: DeliveryStatus, isCurrent: boolean): string {
  if (isCurrent) return colors.mapCurrent;
  if (status === "DELIVERED") return colors.mapCompleted;
  if (FAILED_LIKE.includes(status)) return colors.mapFailed;
  return colors.mapPending;
}

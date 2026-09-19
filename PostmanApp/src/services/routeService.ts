import { routeApi } from "../api/routeApi";
import { OptimizationStop, ReoptimizeTrigger } from "../types/route";
import { isMeaningfulDeviation } from "../utils/distance";

/** Finds the next PENDING-equivalent stop by sequence for "current stop"
 * display. The mobile app derives this from stop order + each linked
 * delivery's status (passed in by the caller); it does not track its own
 * separate "current stop" state server-side. */
export function findNextStop(stops: OptimizationStop[], completedDeliveryIds: Set<string>): OptimizationStop | null {
  const remaining = stops.filter((s) => !completedDeliveryIds.has(s.deliveryId)).sort((a, b) => a.sequence - b.sequence);
  return remaining[0] ?? null;
}

export function findCurrentAndNext(stops: OptimizationStop[], completedDeliveryIds: Set<string>) {
  const sorted = [...stops].sort((a, b) => a.sequence - b.sequence);
  const remaining = sorted.filter((s) => !completedDeliveryIds.has(s.deliveryId));
  return { current: remaining[0] ?? null, next: remaining[1] ?? null };
}

const DEVIATION_THRESHOLD_METERS = 200;

/** Call on each meaningful GPS update while a route is active. Returns true
 * only when the postman's position has drifted materially from the expected
 * next stop — not on every small GPS jitter (spec §33). */
export function hasDeviatedFromRoute(
  currentFix: { latitude: number; longitude: number; accuracy: number | null },
  expectedStop: OptimizationStop
): boolean {
  return isMeaningfulDeviation(currentFix, expectedStop, DEVIATION_THRESHOLD_METERS);
}

export async function triggerReoptimize(trigger: ReoptimizeTrigger) {
  return routeApi.reoptimize(trigger);
}

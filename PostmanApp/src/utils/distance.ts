const EARTH_RADIUS_METERS = 6371000;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance in meters. Used only for on-device UX (distance
 * badges, deviation checks) — never for route optimization itself, which
 * stays server-side (spec §31). */
export function haversineDistanceMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number }
): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_METERS * c;
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

/**
 * True when a GPS fix indicates a *meaningful* deviation from an expected
 * point — guards against reacting to normal GPS jitter or a low-accuracy
 * reading (spec §33). thresholdMeters should exceed reported accuracy.
 */
export function isMeaningfulDeviation(
  current: { latitude: number; longitude: number; accuracy: number | null },
  expected: { latitude: number; longitude: number },
  thresholdMeters = 150
): boolean {
  if (current.accuracy != null && current.accuracy > thresholdMeters) return false;
  return haversineDistanceMeters(current, expected) > thresholdMeters;
}

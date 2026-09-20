export interface LatLng {
  latitude: number;
  longitude: number;
}

export type CoordinateProblem =
  | "NULL"
  | "NOT_A_NUMBER"
  | "ZERO_ZERO"
  | "LATITUDE_OUT_OF_RANGE"
  | "LONGITUDE_OUT_OF_RANGE"
  | "LIKELY_LAT_LNG_REVERSED";

/**
 * Coordinate sanity checks for delivery addresses before they're plotted on
 * the map. Never "fixes" a bad coordinate (e.g. by swapping lat/lng) — a
 * silent swap can turn a wrong-but-detectable value into a wrong-and-
 * plausible one. Callers should drop/flag problem coordinates instead.
 */
export function isValidLatitude(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -90 && value <= 90;
}

export function isValidLongitude(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -180 && value <= 180;
}

/**
 * Returns every problem found with a coordinate pair, or an empty array if
 * it's clean. A coordinate can have more than one problem (e.g. a reversed
 * pair might also land out of range).
 */
export function findCoordinateProblems(
  latitude: unknown,
  longitude: unknown,
  expectedBounds?: { minLat: number; maxLat: number; minLng: number; maxLng: number }
): CoordinateProblem[] {
  const problems: CoordinateProblem[] = [];

  if (latitude == null || longitude == null) {
    problems.push("NULL");
    return problems;
  }

  const lat = typeof latitude === "string" ? Number(latitude) : latitude;
  const lng = typeof longitude === "string" ? Number(longitude) : longitude;

  if (typeof lat !== "number" || typeof lng !== "number" || Number.isNaN(lat) || Number.isNaN(lng)) {
    problems.push("NOT_A_NUMBER");
    return problems;
  }

  if (lat === 0 && lng === 0) {
    problems.push("ZERO_ZERO");
  }
  if (!isValidLatitude(lat)) problems.push("LATITUDE_OUT_OF_RANGE");
  if (!isValidLongitude(lng)) problems.push("LONGITUDE_OUT_OF_RANGE");

  if (expectedBounds && isValidLatitude(lat) && isValidLongitude(lng)) {
    const inBounds =
      lat >= expectedBounds.minLat && lat <= expectedBounds.maxLat && lng >= expectedBounds.minLng && lng <= expectedBounds.maxLng;
    const swappedInBounds =
      lng >= expectedBounds.minLat &&
      lng <= expectedBounds.maxLat &&
      lat >= expectedBounds.minLng &&
      lat <= expectedBounds.maxLng;
    if (!inBounds && swappedInBounds) {
      problems.push("LIKELY_LAT_LNG_REVERSED");
    }
  }

  return problems;
}

export function isValidCoordinatePair(latitude: unknown, longitude: unknown): boolean {
  return findCoordinateProblems(latitude, longitude).length === 0;
}

// Loose bounding box around the Mumbai metro area (matches the backend
// seed data's Bhandup West post office) — used only to flag a *likely*
// lat/lng reversal for this project's expected delivery area, never to
// reject or silently correct a coordinate.
export const MUMBAI_METRO_BOUNDS = { minLat: 18.8, maxLat: 19.5, minLng: 72.6, maxLng: 73.2 };

/**
 * Filters a list of address-bearing records down to those with a usable,
 * finite lat/lng, logging (dev-only) every one that was dropped and why —
 * so a broken geocode is visible during development instead of silently
 * vanishing from the map or crashing map rendering with NaN coordinates.
 */
export function validateAndLogCoordinates<T>(
  items: T[],
  getCoords: (item: T) => { latitude: unknown; longitude: unknown },
  getLabel: (item: T) => string,
  expectedBounds: { minLat: number; maxLat: number; minLng: number; maxLng: number } = MUMBAI_METRO_BOUNDS
): T[] {
  const valid: T[] = [];
  for (const item of items) {
    const { latitude, longitude } = getCoords(item);
    const problems = findCoordinateProblems(latitude, longitude, expectedBounds);
    const hardProblems = problems.filter((p) => p !== "LIKELY_LAT_LNG_REVERSED");

    if (problems.length > 0 && __DEV__) {
       
      console.warn(`[coordinates] ${getLabel(item)}: ${problems.join(", ")} (lat=${latitude}, lng=${longitude})`);
    }
    if (hardProblems.length === 0) {
      valid.push(item);
    }
  }
  return valid;
}

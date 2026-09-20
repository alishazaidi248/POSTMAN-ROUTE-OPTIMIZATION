export interface LngLatBoundsBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

// Minimum half-span (degrees) applied around a single point so a one-stop
// route (or a route where every point coincides) doesn't produce a
// zero-area bounding box, which most "fit to bounds" implementations either
// reject or render as a nonsensically deep zoom.
const MIN_HALF_SPAN_DEG = 0.01; // ~1.1km at this latitude

/**
 * Computes a bounding box around every given [lng, lat] point. Returns null
 * for an empty input — callers should fall back to a fixed default center
 * (e.g. the postman's beat/post-office) rather than treating null as an
 * error.
 */
export function computeBoundsForPoints(points: [number, number][]): LngLatBoundsBox | null {
  if (points.length === 0) return null;

  let west = points[0][0];
  let east = points[0][0];
  let south = points[0][1];
  let north = points[0][1];

  for (const [lng, lat] of points) {
    if (lng < west) west = lng;
    if (lng > east) east = lng;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }

  if (east - west < MIN_HALF_SPAN_DEG * 2) {
    const centerLng = (east + west) / 2;
    west = centerLng - MIN_HALF_SPAN_DEG;
    east = centerLng + MIN_HALF_SPAN_DEG;
  }
  if (north - south < MIN_HALF_SPAN_DEG * 2) {
    const centerLat = (north + south) / 2;
    south = centerLat - MIN_HALF_SPAN_DEG;
    north = centerLat + MIN_HALF_SPAN_DEG;
  }

  return { west, south, east, north };
}

/** [west, south, east, north] — the flat tuple shape MapLibre RN's Camera expects. */
export function toFlatBounds(box: LngLatBoundsBox): [number, number, number, number] {
  return [box.west, box.south, box.east, box.north];
}

/** [[west, south], [east, north]] — the shape maplibre-gl JS's fitBounds expects. */
export function toCornerBounds(box: LngLatBoundsBox): [[number, number], [number, number]] {
  return [
    [box.west, box.south],
    [box.east, box.north]
  ];
}

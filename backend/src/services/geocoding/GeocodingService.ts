export interface GeocodeQuery {
  addressLine1: string;
  addressLine2?: string | null;
  area?: string | null;
  city: string;
  state: string;
  pincode: string;
}

export interface GeocodeResult {
  latitude: number;
  longitude: number;
  confidence: number;
  source: string;
  status: "SUCCESS" | "FAILED";
  raw?: unknown;
}

/**
 * Abstraction over any OSM-compatible geocoder. Swap the provider behind
 * this interface (Nominatim today, something self-hosted later) without
 * touching import/assignment code. Never geocode from the browser (spec §14).
 */
export interface GeocodingService {
  geocode(query: GeocodeQuery): Promise<GeocodeResult>;
}

function cacheKey(q: GeocodeQuery): string {
  return [q.addressLine1, q.addressLine2, q.area, q.city, q.state, q.pincode]
    .map((s) => (s ?? "").trim().toLowerCase())
    .join("|");
}

export { cacheKey };

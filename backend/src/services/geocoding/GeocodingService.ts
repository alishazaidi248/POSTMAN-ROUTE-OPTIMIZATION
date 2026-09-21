import { GeocodingPrecision } from "@prisma/client";

export interface GeocodeQuery {
  addressLine1: string;
  addressLine2?: string | null;
  area?: string | null;
  city: string;
  state: string;
  pincode: string;
}

/** The parts of the address the provider recognised (what it says the point IS, not what we asked for). */
export interface GeocodeComponents {
  houseNumber?: string;
  building?: string;
  road?: string;
  locality?: string;
  city?: string;
  state?: string;
  pincode?: string;
}

export interface GeocodeResult {
  latitude: number;
  longitude: number;
  /** 0..1, the provider's own certainty, capped by how specific the query that matched was. */
  confidence: number;
  /** Which query tier / provider produced it: "nominatim", "nominatim-area", "google", "manual", "learned"... */
  source: string;
  status: "SUCCESS" | "FAILED";
  /**
   * How precisely the returned point identifies the delivery address. This - not `confidence` - decides whether the
   * point may be used to choose a beat: only HOUSE is strong evidence, STREET is usable support, AREA / PINCODE are the
   * centre of a place and never assign anything on their own.
   */
  precision: GeocodingPrecision;
  components?: GeocodeComponents;
  /** Provider name and raw match details, stored on the address for audit ("why did it geocode there?"). */
  provider?: string;
  raw?: unknown;
}

export const FAILED_RESULT = (source: string): GeocodeResult => ({ latitude: 0, longitude: 0, confidence: 0, source, status: "FAILED", precision: "NONE" });

/**
 * Provider-independent geocoding. Implementations (Nominatim, Google, a self-hosted Pelias/Photon...) only have to
 * return a GeocodeResult with an honest `precision`; nothing else in the system knows which provider is behind it.
 * Never geocode from the browser (spec §14).
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

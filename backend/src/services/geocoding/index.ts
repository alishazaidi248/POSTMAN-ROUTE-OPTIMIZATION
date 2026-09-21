import { Prisma } from "@prisma/client";
import { GeocodeQuery, GeocodeResult, GeocodingService } from "./GeocodingService";
import { NominatimGeocodingService } from "./NominatimGeocodingService";
import { GoogleGeocodingService } from "./GoogleGeocodingService";
import { NoGeocodingService } from "./NoGeocodingService";
import { env } from "../../config/env";
import { learnableKey } from "../addressing/locationLearning";
import { addressKey } from "../addressing/normalize";
import { lookupLearnedLocation } from "../addressLearning.service";

let instance: GeocodingService | null = null;

/** The configured provider (GEOCODING_PROVIDER). Everything else talks to the GeocodingService interface only. */
export function getGeocodingService(): GeocodingService {
  if (!instance) {
    switch (env.geocodingProvider) {
      case "google":
        instance = new GoogleGeocodingService();
        break;
      case "none":
        instance = new NoGeocodingService();
        break;
      case "nominatim":
      default:
        instance = new NominatimGeocodingService();
    }
  }
  return instance;
}

/**
 * Where is this address? A location learned from earlier completed deliveries to the same address comes first (it is a
 * verified point, and free); otherwise the configured provider is asked. Never throws: a provider error is a FAILED
 * result, which the assignment step turns into an exception for an administrator (or a name-based assignment).
 */
export async function geocodeAddress(query: GeocodeQuery, postOfficeId?: string): Promise<GeocodeResult> {
  if (postOfficeId) {
    const learned = await lookupLearnedLocation(postOfficeId, query);
    if (learned) return learned;
  }
  return getGeocodingService().geocode(query);
}

/** The Address columns for a geocode outcome. A failed one keeps whatever coordinates the address already had. */
export function addressGeocodeData(result: GeocodeResult, query: GeocodeQuery, opts: { manual?: boolean } = {}) {
  const ok = result.status === "SUCCESS";
  return {
    latitude: ok ? result.latitude : undefined,
    longitude: ok ? result.longitude : undefined,
    geocodingStatus: opts.manual ? ("MANUAL" as const) : result.status,
    geocodingSource: result.source,
    geocodingConfidence: result.confidence,
    geocodingPrecision: result.precision,
    geocodingMeta: { provider: result.provider ?? result.source, components: result.components ?? null, match: result.raw ?? null } as Prisma.InputJsonValue,
    normalizedKey: learnableKey([query.addressLine1, query.addressLine2, query.area, query.city, query.state]) ?? addressKey([query.addressLine1, query.addressLine2, query.area]),
    geocodedAt: new Date()
  };
}

/** A pin an administrator placed by hand: exact by definition. */
export const manualGeocode = (latitude: number, longitude: number): GeocodeResult => ({
  latitude,
  longitude,
  confidence: 1,
  source: "manual",
  status: "SUCCESS",
  precision: "HOUSE",
  provider: "manual"
});

export * from "./GeocodingService";

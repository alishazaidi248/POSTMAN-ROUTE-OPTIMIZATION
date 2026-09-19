import axios from "axios";
import { prisma } from "../../config/prisma";
import { logger } from "../../config/logger";
import { GeocodeQuery, GeocodeResult, GeocodingService, cacheKey } from "./GeocodingService";
import { env } from "../../config/env";

const inMemoryCache = new Map<string, GeocodeResult>();

// Google Geocoding API is billed per request; 20/sec is well under Google's
// per-second quota, but this keeps a single client well-behaved by default.
let lastRequestAt = 0;
async function throttle() {
  const elapsed = Date.now() - lastRequestAt;
  const minGapMs = 50;
  if (elapsed < minGapMs) {
    await new Promise((resolve) => setTimeout(resolve, minGapMs - elapsed));
  }
  lastRequestAt = Date.now();
}

const CONFIDENCE_BY_LOCATION_TYPE: Record<string, number> = {
  ROOFTOP: 1,
  RANGE_INTERPOLATED: 0.8,
  GEOMETRIC_CENTER: 0.55,
  APPROXIMATE: 0.35
};

export class GoogleGeocodingService implements GeocodingService {
  async geocode(query: GeocodeQuery): Promise<GeocodeResult> {
    if (!env.googleGeocodingApiKey) {
      logger.error("GOOGLE_GEOCODING_API_KEY is not set — cannot geocode with GEOCODING_PROVIDER=google");
      return { latitude: 0, longitude: 0, confidence: 0, source: "google", status: "FAILED" };
    }

    const key = cacheKey(query);

    const cached = inMemoryCache.get(key);
    if (cached) return cached;

    const dbCached = await prisma.address.findFirst({
      where: {
        pincode: query.pincode,
        city: query.city,
        addressLine1: query.addressLine1,
        geocodingStatus: "SUCCESS"
      },
      select: { latitude: true, longitude: true, geocodingConfidence: true, geocodingSource: true }
    });
    if (dbCached?.latitude && dbCached?.longitude) {
      const result: GeocodeResult = {
        latitude: dbCached.latitude,
        longitude: dbCached.longitude,
        confidence: dbCached.geocodingConfidence ?? 0.5,
        source: dbCached.geocodingSource ?? "google-cache",
        status: "SUCCESS"
      };
      inMemoryCache.set(key, result);
      return result;
    }

    const dedupeJoin = (pieces: (string | null | undefined)[]) =>
      pieces
        .filter((piece): piece is string => Boolean(piece))
        .reduce<string[]>((acc, piece) => {
          const alreadyPresent = acc.some((p) => p.toLowerCase().includes(piece.toLowerCase()));
          return alreadyPresent ? acc : [...acc, piece];
        }, [])
        .join(", ");

    // Same progressive-fallback approach as the Nominatim service: retry
    // with less specific candidates if the full address has no match, so a
    // chawl-level line that Google can't pinpoint still resolves to an
    // area/pincode-level point instead of failing outright.
    const candidates: { queryString: string; confidence: number; source: string }[] = [
      { queryString: dedupeJoin([query.addressLine1, query.addressLine2, query.area, query.city, query.state, query.pincode]), confidence: 1, source: "google" },
      { queryString: dedupeJoin([query.area, query.city, query.state, query.pincode]), confidence: 0.4, source: "google-area" },
      { queryString: dedupeJoin([query.city, query.state, query.pincode]), confidence: 0.25, source: "google-pincode" }
    ].filter((c, i, arr) => c.queryString && arr.findIndex((o) => o.queryString === c.queryString) === i);

    for (const candidate of candidates) {
      try {
        await throttle();
        const { data } = await axios.get("https://maps.googleapis.com/maps/api/geocode/json", {
          params: {
            address: candidate.queryString,
            key: env.googleGeocodingApiKey,
            region: "in",
            components: "country:IN"
          },
          timeout: 8000
        });

        if (data.status === "ZERO_RESULTS") {
          logger.warn({ addressString: candidate.queryString }, "Google found no match for this candidate, trying next fallback if any");
          continue;
        }

        if (data.status !== "OK") {
          logger.warn(
            { addressString: candidate.queryString, status: data.status, errorMessage: data.error_message },
            "Google geocoding request did not return OK, trying next fallback if any"
          );
          continue;
        }

        const match = data.results[0];
        const locationType: string = match.geometry?.location_type ?? "APPROXIMATE";
        const baseConfidence = CONFIDENCE_BY_LOCATION_TYPE[locationType] ?? 0.4;

        const result: GeocodeResult = {
          latitude: match.geometry.location.lat,
          longitude: match.geometry.location.lng,
          confidence: Math.min(candidate.confidence, baseConfidence),
          source: candidate.source,
          status: "SUCCESS",
          raw: match
        };
        inMemoryCache.set(key, result);
        return result;
      } catch (err) {
        logger.warn({ err, addressString: candidate.queryString }, "Google geocoding request failed, trying next fallback if any");
      }
    }

    return { latitude: 0, longitude: 0, confidence: 0, source: "google", status: "FAILED" };
  }
}

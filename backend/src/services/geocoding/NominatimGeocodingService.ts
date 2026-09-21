import axios from "axios";
import { prisma } from "../../config/prisma";
import { logger } from "../../config/logger";
import { FAILED_RESULT, GeocodeQuery, GeocodeResult, GeocodingService, cacheKey } from "./GeocodingService";
import { QueryTier, nominatimComponents, nominatimPrecision, precisionFromSource } from "./precision";
import { env } from "../../config/env";

const inMemoryCache = new Map<string, GeocodeResult>();
let lastRequestAt = 0;

// Nominatim's usage policy requires >= 1 request/second per client.
async function throttle() {
  const elapsed = Date.now() - lastRequestAt;
  const minGapMs = 1100;
  if (elapsed < minGapMs) {
    await new Promise((resolve) => setTimeout(resolve, minGapMs - elapsed));
  }
  lastRequestAt = Date.now();
}

export class NominatimGeocodingService implements GeocodingService {
  async geocode(query: GeocodeQuery): Promise<GeocodeResult> {
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
      select: { latitude: true, longitude: true, geocodingConfidence: true, geocodingSource: true, geocodingPrecision: true }
    });
    if (dbCached?.latitude && dbCached?.longitude) {
      const result: GeocodeResult = {
        latitude: dbCached.latitude,
        longitude: dbCached.longitude,
        confidence: dbCached.geocodingConfidence ?? 0.5,
        source: dbCached.geocodingSource ?? "nominatim-cache",
        status: "SUCCESS",
        precision: dbCached.geocodingPrecision ?? precisionFromSource(dbCached.geocodingSource, "SUCCESS"),
        provider: "nominatim"
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

    // Building/chawl-level addressLine1 text often has no match in OSM's
    // index for informal-settlement areas, even though the surrounding
    // area/city/pincode does. Rather than give up after one miss, retry with
    // progressively less specific candidates so the delivery still lands on
    // an area-level point (and can be beat-matched) instead of sitting in
    // FAILED forever. Each fallback tier is tagged with a lower confidence so
    // downstream code/UI can tell a rooftop match from an area-level one.
    const candidates: { queryString: string; confidence: number; source: string; tier: QueryTier }[] = [
      { queryString: dedupeJoin([query.addressLine1, query.addressLine2, query.area, query.city, query.state, query.pincode]), confidence: 1, source: "nominatim", tier: "full" as QueryTier },
      { queryString: dedupeJoin([query.area, query.city, query.state, query.pincode]), confidence: 0.4, source: "nominatim-area", tier: "area" as QueryTier },
      { queryString: dedupeJoin([query.city, query.state, query.pincode]), confidence: 0.25, source: "nominatim-pincode", tier: "pincode" as QueryTier }
    ].filter((c, i, arr) => c.queryString && arr.findIndex((o) => o.queryString === c.queryString) === i);

    candidateLoop: for (const candidate of candidates) {
      const maxAttempts = 3;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          await throttle();
          const { data } = await axios.get(`${env.nominatimBaseUrl}/search`, {
            params: { q: candidate.queryString, format: "json", limit: 1, countrycodes: "in", addressdetails: 1 },
            headers: { "User-Agent": env.nominatimUserAgent },
            timeout: 8000
          });

          if (!Array.isArray(data) || data.length === 0) {
            logger.warn({ addressString: candidate.queryString }, "Nominatim found no match for this candidate, trying next fallback if any");
            continue candidateLoop;
          }

          const match = data[0];
          const result: GeocodeResult = {
            latitude: parseFloat(match.lat),
            longitude: parseFloat(match.lon),
            confidence: Math.min(candidate.confidence, parseFloat(match.importance ?? "0.4") + (1 - candidate.confidence)),
            source: candidate.source,
            status: "SUCCESS",
            precision: nominatimPrecision(match, candidate.tier),
            components: nominatimComponents(match),
            provider: "nominatim",
            raw: { class: match.class, type: match.type, addresstype: match.addresstype, display_name: match.display_name, importance: match.importance, osm_type: match.osm_type, osm_id: match.osm_id, tier: candidate.tier }
          };
          inMemoryCache.set(key, result);
          return result;
        } catch (err) {
          const status = (err as { response?: { status?: number } })?.response?.status;
          const responseData = (err as { response?: { data?: unknown } })?.response?.data;

          if (typeof responseData === "string" && responseData.includes("Access denied")) {
            logger.error(
              { addressString: candidate.queryString },
              "Nominatim rejected this client's User-Agent (Access denied) — check NOMINATIM_USER_AGENT is a real, non-placeholder identifier, not a rate-limit issue"
            );
            break candidateLoop;
          }

          if (status === 429 && attempt < maxAttempts) {
            const backoffMs = 2000 * attempt;
            logger.warn(
              { addressString: candidate.queryString, attempt, backoffMs },
              "Nominatim returned 429 (rate-limited or temporarily blocked) — backing off and retrying"
            );
            await new Promise((resolve) => setTimeout(resolve, backoffMs));
            continue;
          }

          logger.warn({ err, addressString: candidate.queryString }, "Nominatim geocoding request failed, trying next fallback if any");
          continue candidateLoop;
        }
      }
    }

    return FAILED_RESULT("nominatim");
  }
}

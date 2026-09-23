import { Address, Prisma } from "@prisma/client";
import { GeocodeQuery, GeocodeResult, GeocodingService } from "./GeocodingService";
import { NominatimGeocodingService } from "./NominatimGeocodingService";
import { GoogleGeocodingService } from "./GoogleGeocodingService";
import { NoGeocodingService } from "./NoGeocodingService";
import { env } from "../../config/env";
import { prisma } from "../../config/prisma";
import { AppError } from "../../utils/AppError";
import { learnableKey } from "../addressing/locationLearning";
import { addressKey } from "../addressing/normalize";
import { lookupLearnedLocation } from "../addressLearning.service";
import { AssignResult, RetryGeocodeAllResult, RetryGeocodeAllSummary, assignDeliveryToBeat, retryableExceptions, runPool } from "../assignment.service";

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

/**
 * Re-geocodes one address and re-matches its delivery to a beat - the one place both the single-record retry route
 * and the bulk "Retry Geocode All" call, so there is exactly one implementation of "retry" to keep correct.
 * Updates the SAME Address row (never creates a new one) and never throws on a provider failure: geocodeAddress
 * itself never throws, and a FAILED result still updates the address (geocodingStatus becomes FAILED) and still
 * re-runs assignment, which is what turns a still-bad geocode into a refreshed (not duplicated) exception.
 */
export async function retryAddressGeocode(addressId: string): Promise<{ address: Address; assignResult: AssignResult; deliveryId: string }> {
  const address = await prisma.address.findUniqueOrThrow({ where: { id: addressId } });
  const owningDelivery = await prisma.delivery.findFirst({ where: { addressId } });
  if (!owningDelivery) throw AppError.notFound("Address not found");
  const result = await geocodeAddress(address, owningDelivery.postOfficeId);
  const updated = await prisma.address.update({ where: { id: address.id }, data: addressGeocodeData(result, address) });
  const assignResult = await assignDeliveryToBeat(owningDelivery.id);
  return { address: updated, assignResult, deliveryId: owningDelivery.id };
}

/**
 * Re-geocodes and re-matches every open exception that a location fix could plausibly resolve (see
 * assignment.service.ts's needsGeocodeRetry for exactly which ones), bounded to `concurrency` requests at a time
 * (never hundreds at once) and capped at 500 exceptions per call. A provider failure on one record never aborts the
 * batch - it is counted as `failed` and the rest continue. Reuses `retryAddressGeocode` (the exact function the
 * single-row "Retry Geocode" route calls), so there is one implementation of "retry", not two.
 */
export async function retryGeocodeAllExceptions(postOfficeId?: string, concurrency = 4): Promise<RetryGeocodeAllSummary> {
  const eligible = await retryableExceptions(postOfficeId);

  const results: RetryGeocodeAllResult[] = [];
  await runPool(eligible, concurrency, async (exception) => {
    try {
      await retryAddressGeocode(exception.delivery.addressId);
      const stillOpen = await prisma.assignmentException.findUnique({ where: { id: exception.id }, select: { resolvedAt: true } });
      results.push({
        exceptionId: exception.id,
        deliveryId: exception.deliveryId,
        outcome: !stillOpen || stillOpen.resolvedAt ? "SUCCEEDED_RESOLVED" : "SUCCEEDED_STILL_UNRESOLVED"
      });
    } catch {
      results.push({ exceptionId: exception.id, deliveryId: exception.deliveryId, outcome: "FAILED" });
    }
  });

  return {
    processed: results.length,
    succeeded: results.filter((r) => r.outcome !== "FAILED").length,
    failed: results.filter((r) => r.outcome === "FAILED").length,
    resolved: results.filter((r) => r.outcome === "SUCCEEDED_RESOLVED").length,
    stillUnresolved: results.filter((r) => r.outcome === "SUCCEEDED_STILL_UNRESOLVED").length,
    results
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

import { GeocodingPrecision } from "@prisma/client";
import { normalizeAddress, GENERIC_ADDRESS_WORDS } from "./normalize";

/**
 * Address learning: what a completed delivery teaches the system about WHERE an address is. Pure logic (no database);
 * services/addressLearning.service.ts stores the samples.
 *
 * Safety rules - a phone's GPS at the door is evidence, not truth:
 *   - a sample needs a stated accuracy of MAX_ACCURACY_M or better (a fix that does not say how good it is is rejected);
 *   - it must be within MAX_FROM_GEOCODE_M of an existing usable geocode of the same address (the postman was at the
 *     address, not across the city with a stale fix);
 *   - it must be within OUTLIER_M of the representative point of the samples already accepted;
 *   - the representative point is the MEDIAN of accepted samples, so one bad fix cannot drag it.
 * Only a key with a house/unit number and at least two other words is learnable: "FARID NAGAR" alone names a whole
 * neighbourhood and one point for it would be wrong for every other delivery there.
 */
export const MAX_ACCURACY_M = 50;
export const MAX_FROM_GEOCODE_M = 1000;
export const OUTLIER_M = 150;
/** Accepted samples that agree within AGREE_M make a location trustworthy enough to count as house level. */
export const AGREE_M = 60;
export const HOUSE_LEVEL_SAMPLES = 2;

export interface Point {
  latitude: number;
  longitude: number;
}

export function distanceMeters(a: Point, b: Point): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const median = (xs: number[]) => {
  const s = [...xs].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function representativePoint(points: readonly Point[]): Point | null {
  if (points.length === 0) return null;
  return { latitude: median(points.map((p) => p.latitude)), longitude: median(points.map((p) => p.longitude)) };
}

/** The key an address is learned / looked up under, or null when the address is too vague to name one place. */
export function learnableKey(parts: readonly (string | null | undefined)[]): string | null {
  const n = normalizeAddress(parts);
  const drop = new Set(["BHANDUP", "WEST", ...GENERIC_ADDRESS_WORDS]);
  const tokens = [...new Set(n.tokens.filter((t) => !drop.has(t)))].sort();
  const numbers = tokens.filter((t) => /\d/.test(t));
  const words = tokens.filter((t) => !/\d/.test(t) && t.length > 1);
  return numbers.length >= 1 && words.length >= 2 ? tokens.join(" ") : null;
}

export interface SampleInput extends Point {
  accuracyMeters?: number | null;
}
export type SampleVerdict = { accepted: true } | { accepted: false; reason: string };

export function judgeSample(
  sample: SampleInput,
  context: { geocode?: (Point & { precision: GeocodingPrecision }) | null; accepted: readonly Point[] }
): SampleVerdict {
  if (!Number.isFinite(sample.latitude) || !Number.isFinite(sample.longitude) || Math.abs(sample.latitude) > 90 || Math.abs(sample.longitude) > 180) {
    return { accepted: false, reason: "invalid coordinates" };
  }
  if (sample.accuracyMeters == null) return { accepted: false, reason: "the GPS fix did not state its accuracy" };
  if (sample.accuracyMeters > MAX_ACCURACY_M) return { accepted: false, reason: `GPS accuracy ${Math.round(sample.accuracyMeters)} m is worse than ${MAX_ACCURACY_M} m` };
  const g = context.geocode;
  if (g && (g.precision === "HOUSE" || g.precision === "STREET")) {
    const d = distanceMeters(sample, g);
    if (d > MAX_FROM_GEOCODE_M) return { accepted: false, reason: `${Math.round(d)} m from the geocoded address` };
  }
  const rep = representativePoint(context.accepted);
  if (rep) {
    const d = distanceMeters(sample, rep);
    if (d > OUTLIER_M) return { accepted: false, reason: `${Math.round(d)} m from the location learned so far (outlier)` };
  }
  return { accepted: true };
}

/** What a learned location is worth when it is looked up: two agreeing deliveries are house level, one is street level. */
export function learnedQuality(accepted: readonly Point[]): { precision: GeocodingPrecision; confidence: number } {
  const rep = representativePoint(accepted);
  if (!rep) return { precision: "NONE", confidence: 0 };
  const agreeing = accepted.filter((p) => distanceMeters(p, rep) <= AGREE_M).length;
  if (agreeing >= HOUSE_LEVEL_SAMPLES) return { precision: "HOUSE", confidence: Math.min(0.99, 0.75 + 0.08 * agreeing) };
  return { precision: "STREET", confidence: 0.6 };
}

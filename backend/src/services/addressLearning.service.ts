import { prisma } from "../config/prisma";
import { logger } from "../config/logger";
import { GeocodeQuery, GeocodeResult } from "./geocoding/GeocodingService";
import { Point, judgeSample, learnableKey, learnedQuality, representativePoint } from "./addressing/locationLearning";

/**
 * Address learning store. A delivery completed with a good GPS fix teaches the system where that address is; the next
 * delivery to it reuses the learned location BEFORE any geocoder is asked. See addressing/locationLearning.ts for the
 * rules that keep a wrong GPS fix from being learned.
 */
const partsOf = (a: GeocodeQuery) => [a.addressLine1, a.addressLine2, a.area, a.city, a.state];

export type LearnOutcome =
  | { status: "LEARNED"; sampleCount: number }
  | { status: "REJECTED"; reason: string }
  | { status: "SKIPPED"; reason: string };

export async function learnFromDelivery(
  deliveryId: string,
  fix: { latitude: number; longitude: number; accuracyMeters?: number | null; capturedAt?: Date }
): Promise<LearnOutcome> {
  const delivery = await prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId }, include: { address: true, locationSample: true } });
  if (delivery.status !== "DELIVERED") return { status: "SKIPPED", reason: "the delivery is not completed" };
  if (delivery.locationSample) return { status: "SKIPPED", reason: "already learned from this delivery" };

  const a = delivery.address;
  const key = learnableKey(partsOf(a));
  if (!key) return { status: "SKIPPED", reason: "the address is too vague to name one place (no house / unit number)" };

  const existing = await prisma.addressLocation.findUnique({
    where: { postOfficeId_normalizedKey: { postOfficeId: delivery.postOfficeId, normalizedKey: key } },
    include: { samples: { where: { accepted: true } } }
  });
  const accepted: Point[] = existing?.samples ?? [];
  const geocode = a.latitude != null && a.longitude != null && a.geocodingPrecision ? { latitude: a.latitude, longitude: a.longitude, precision: a.geocodingPrecision } : null;
  const verdict = judgeSample(fix, { geocode, accepted });
  const capturedAt = fix.capturedAt ?? new Date();

  return prisma.$transaction(async (tx): Promise<LearnOutcome> => {
    const location =
      existing ??
      (await tx.addressLocation.create({
        data: { postOfficeId: delivery.postOfficeId, normalizedKey: key, latitude: fix.latitude, longitude: fix.longitude, sampleCount: 0, confidence: 0, beatId: delivery.beatId, lastDeliveredAt: capturedAt }
      }));
    await tx.addressLocationSample.create({
      data: {
        addressLocationId: location.id,
        deliveryId,
        latitude: fix.latitude,
        longitude: fix.longitude,
        accuracyMeters: fix.accuracyMeters ?? null,
        accepted: verdict.accepted,
        note: verdict.accepted ? null : verdict.reason,
        capturedAt
      }
    });
    if (!verdict.accepted) return { status: "REJECTED", reason: verdict.reason };

    const all = [...accepted, { latitude: fix.latitude, longitude: fix.longitude }];
    const rep = representativePoint(all)!;
    const quality = learnedQuality(all);
    await tx.addressLocation.update({
      where: { id: location.id },
      data: { latitude: rep.latitude, longitude: rep.longitude, sampleCount: all.length, confidence: quality.confidence, beatId: delivery.beatId ?? location.beatId, lastDeliveredAt: capturedAt }
    });
    return { status: "LEARNED", sampleCount: all.length };
  });
}

/** A location learned from earlier deliveries to the same address, shaped like a geocoder result; null when none. */
export async function lookupLearnedLocation(postOfficeId: string, query: GeocodeQuery): Promise<GeocodeResult | null> {
  const key = learnableKey(partsOf(query));
  if (!key) return null;
  try {
    const loc = await prisma.addressLocation.findUnique({
      where: { postOfficeId_normalizedKey: { postOfficeId, normalizedKey: key } },
      include: { samples: { where: { accepted: true }, select: { latitude: true, longitude: true } } }
    });
    if (!loc || loc.samples.length === 0) return null;
    const q = learnedQuality(loc.samples);
    return {
      latitude: loc.latitude,
      longitude: loc.longitude,
      confidence: q.confidence,
      source: "learned",
      status: "SUCCESS",
      precision: q.precision,
      provider: "learned",
      raw: { sampleCount: loc.samples.length, beatId: loc.beatId, lastDeliveredAt: loc.lastDeliveredAt }
    };
  } catch (err) {
    logger.warn({ err }, "address learning lookup failed; falling back to the geocoder");
    return null;
  }
}

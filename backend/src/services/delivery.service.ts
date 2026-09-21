import { ParcelPriority, Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { logger } from "../config/logger";
import { addressGeocodeData, geocodeAddress, manualGeocode } from "./geocoding";
import { FAILED_RESULT, GeocodeResult } from "./geocoding/GeocodingService";
import { AssignResult, assignDeliveryToBeat } from "./assignment.service";

export interface NewDeliveryInput {
  postOfficeId: string;
  trackingId: string;
  recipient: { name: string; phone?: string | null; altPhone?: string | null };
  address: {
    addressLine1: string;
    addressLine2?: string | null;
    area?: string | null;
    city: string;
    state: string;
    pincode: string;
  };
  parcelType?: string | null;
  parcelCount?: number;
  /** Real weight in kilograms, when known. Not derived from parcelCount. */
  weightKg?: number | null;
  priority?: ParcelPriority;
  urgency?: string | null;
  serviceTimeMinutes?: number | null;
  importRowId?: string;
}

/** Geocoding outcome as stored on the address (a failure keeps the delivery, with no coordinates). */
export type GeocodeOutcome = GeocodeResult;

export const MANUAL_GEOCODE = manualGeocode;

/**
 * Writes Recipient + Address + Delivery in the caller's transaction. Nothing here
 * talks to the network — geocode first, then call this — so the transaction stays
 * short. An address that could not be located is NOT an exception yet: the beat
 * list may still identify its beat, so assignDeliveryToBeat decides.
 */
export async function createDeliveryRecords(
  tx: Prisma.TransactionClient,
  input: NewDeliveryInput,
  geocode: GeocodeOutcome,
  manual = false
): Promise<{ deliveryId: string; addressId: string }> {
  const located = geocode.status === "SUCCESS";

  const recipient = await tx.recipient.create({
    data: { name: input.recipient.name, phone: input.recipient.phone ?? null, altPhone: input.recipient.altPhone ?? null }
  });

  const address = await tx.address.create({
    data: {
      recipientId: recipient.id,
      addressLine1: input.address.addressLine1,
      addressLine2: input.address.addressLine2 ?? null,
      area: input.address.area ?? null,
      city: input.address.city,
      state: input.address.state,
      pincode: input.address.pincode,
      ...addressGeocodeData(geocode, input.address, { manual }),
      latitude: located ? geocode.latitude : null,
      longitude: located ? geocode.longitude : null
    }
  });

  const delivery = await tx.delivery.create({
    data: {
      trackingId: input.trackingId,
      recipientId: recipient.id,
      addressId: address.id,
      parcelType: input.parcelType ?? null,
      parcelCount: input.parcelCount ?? 1,
      weightKg: input.weightKg ?? null,
      priority: input.priority ?? "NORMAL",
      urgency: input.urgency ?? null,
      serviceTimeMinutes: input.serviceTimeMinutes ?? null,
      postOfficeId: input.postOfficeId,
      importRowId: input.importRowId,
      status: "RECEIVED"
    }
  });

  return { deliveryId: delivery.id, addressId: address.id };
}

/**
 * Create one delivery end to end: geocode (unless coordinates are supplied),
 * persist, then match the beat with PostGIS and assign that beat's postman. The
 * delivery is committed before the assignment step, so a failure there leaves a
 * saved RECEIVED delivery that repairUnassignedDeliveries() picks up — never a
 * lost one.
 */
export async function createAndAssignDelivery(
  input: NewDeliveryInput,
  coordinates?: { latitude: number; longitude: number }
): Promise<{ deliveryId: string; assignment: AssignResult | { status: "ASSIGNMENT_ERROR" } }> {
  const geocode: GeocodeOutcome = coordinates
    ? MANUAL_GEOCODE(coordinates.latitude, coordinates.longitude)
    : await geocodeAddress(input.address, input.postOfficeId).catch((err): GeocodeOutcome => {
        logger.warn({ err }, "geocoding threw; recording as FAILED");
        return FAILED_RESULT("error");
      });

  const { deliveryId } = await prisma.$transaction((tx) => createDeliveryRecords(tx, input, geocode, !!coordinates));

  try {
    return { deliveryId, assignment: await assignDeliveryToBeat(deliveryId) };
  } catch (err) {
    logger.error({ err, deliveryId }, "beat assignment failed after the delivery was saved");
    return { deliveryId, assignment: { status: "ASSIGNMENT_ERROR" } };
  }
}

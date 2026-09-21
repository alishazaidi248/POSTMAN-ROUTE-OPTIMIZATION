import { DeliveryStatus } from "@prisma/client";
import { prisma } from "../config/prisma";
import { AppError } from "../utils/AppError";
import { publishDeliveryEvent, DeliveryEventType } from "./events.service";

/**
 * Explicit allow-list of state transitions (spec §23). Anything not listed
 * here is rejected — no arbitrary status writes.
 */
export const ALLOWED_TRANSITIONS: Record<DeliveryStatus, DeliveryStatus[]> = {
  RECEIVED: ["SORTED", "CANCELLED"],
  SORTED: ["ASSIGNED", "CANCELLED"],
  ASSIGNED: ["OUT_FOR_DELIVERY", "CANCELLED", "RESCHEDULED"],
  OUT_FOR_DELIVERY: [
    "DELIVERED",
    "RECIPIENT_UNAVAILABLE",
    "REJECTED",
    "WRONG_ADDRESS",
    "ADDRESS_NOT_FOUND",
    "FAILED"
  ],
  RECIPIENT_UNAVAILABLE: ["RESCHEDULED", "RETURNED"],
  REJECTED: ["RETURNED"],
  WRONG_ADDRESS: ["RESCHEDULED", "RETURNED"],
  ADDRESS_NOT_FOUND: ["RESCHEDULED", "RETURNED"],
  RESCHEDULED: ["OUT_FOR_DELIVERY", "CANCELLED"],
  RETURNED: [],
  FAILED: ["RESCHEDULED", "RETURNED"],
  CANCELLED: [],
  DELIVERED: []
};

const REOPTIMIZE_TRIGGERS: DeliveryStatus[] = [
  "RECIPIENT_UNAVAILABLE",
  "REJECTED",
  "WRONG_ADDRESS",
  "CANCELLED"
];

export async function transitionDeliveryStatus(params: {
  deliveryId: string;
  toStatus: DeliveryStatus;
  reason?: string;
  changedBy?: string;
}) {
  const delivery = await prisma.delivery.findUniqueOrThrow({ where: { id: params.deliveryId } });
  const allowed = ALLOWED_TRANSITIONS[delivery.status] ?? [];

  if (!allowed.includes(params.toStatus)) {
    throw AppError.badRequest(
      `Invalid delivery status transition: ${delivery.status} -> ${params.toStatus}`
    );
  }

  const updated = await prisma.delivery.update({
    where: { id: params.deliveryId },
    data: { status: params.toStatus }
  });

  await prisma.deliveryStatusHistory.create({
    data: {
      deliveryId: params.deliveryId,
      fromStatus: delivery.status,
      toStatus: params.toStatus,
      reason: params.reason,
      changedBy: params.changedBy
    }
  });

  if (delivery.assignedPostmanId) {
    await prisma.deliveryAttempt.create({
      data: {
        deliveryId: params.deliveryId,
        postmanId: delivery.assignedPostmanId,
        outcome: params.toStatus,
        notes: params.reason
      }
    });
  }

  if (REOPTIMIZE_TRIGGERS.includes(params.toStatus)) {
    await publishDeliveryEvent({ type: params.toStatus as DeliveryEventType, deliveryId: params.deliveryId });
  }

  return updated;
}

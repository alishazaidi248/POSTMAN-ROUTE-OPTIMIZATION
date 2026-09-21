import { logger } from "../config/logger";
import { prisma } from "../config/prisma";
import { DeliveryEvent, DeliveryEventType, deliveryEventBus } from "./events.service";
import { recalculateRouteForPostmanId } from "./routePlanner.service";
import { notifyRouteChanged } from "./postmanNotifications.service";

/**
 * Statuses that take a delivery off a postman's route and may warrant a fresh
 * plan for the remaining stops (publishDeliveryEvent is fired for exactly these
 * from deliveryStatus.service.ts).
 */
export const REOPTIMIZE_EVENT_TYPES: DeliveryEventType[] = [
  "RECIPIENT_UNAVAILABLE",
  "REJECTED",
  "WRONG_ADDRESS",
  "CANCELLED"
];

/**
 * Handles one event. Exported for tests. Never throws — an event handler
 * failing must not affect the status update that triggered it.
 */
export async function handleDeliveryEvent(event: DeliveryEvent): Promise<void> {
  if (!REOPTIMIZE_EVENT_TYPES.includes(event.type)) return;

  try {
    const postmanId =
      event.postmanId ??
      (event.deliveryId
        ? (
            await prisma.delivery.findUnique({
              where: { id: event.deliveryId },
              select: { assignedPostmanId: true }
            })
          )?.assignedPostmanId
        : null);

    if (!postmanId) return;
    await recalculateRouteForPostmanId(postmanId, event.type);
    // A delivery leaving the round changes the remaining order: tell the postman whose route it is.
    await notifyRouteChanged(postmanId, event.type);
    logger.info({ postmanId, trigger: event.type }, "route re-optimized after delivery event");
  } catch (err) {
    logger.error({ err, event }, "route re-optimization after delivery event failed");
  }
}

let registered = false;

/** Call once at startup. Idempotent. */
export function registerRouteEventListeners(): void {
  if (registered) return;
  registered = true;
  deliveryEventBus.on("event", (event: DeliveryEvent) => {
    void handleDeliveryEvent(event);
  });
}

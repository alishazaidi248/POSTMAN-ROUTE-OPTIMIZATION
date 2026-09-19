import { EventEmitter } from "events";
import { logger } from "../config/logger";
import { prisma } from "../config/prisma";

export type DeliveryEventType =
  | "RECIPIENT_UNAVAILABLE" | "REJECTED" | "WRONG_ADDRESS" | "CANCELLED"
  | "NEW_DELIVERY" | "ROAD_OBSTRUCTION" | "ROUTE_DEVIATION"
  | "BATTERY_LOW" | "POSTMAN_REASSIGNED";

export interface DeliveryEvent {
  type: DeliveryEventType;
  deliveryId?: string;
  postmanId?: string;
  routeId?: string;
  payload?: Record<string, unknown>;
}

/**
 * Central bus for events that MAY warrant re-optimization (spec §36). This
 * app only records/publishes events and notifies admins — it never runs an
 * optimization algorithm itself. A future subscriber (the research
 * optimization service, wired through OptimizationService) reacts to these.
 */
class DeliveryEventBus extends EventEmitter {}

export const deliveryEventBus = new DeliveryEventBus();

export async function publishDeliveryEvent(event: DeliveryEvent) {
  logger.info({ event }, "delivery event published");

  if (event.routeId) {
    await prisma.routeEvent.create({
      data: { routeId: event.routeId, eventType: event.type, payload: event.payload as any }
    });
  }

  deliveryEventBus.emit("event", event);
}

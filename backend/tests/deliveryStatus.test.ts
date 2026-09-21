import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeliveryStatus } from "@prisma/client";

const prismaMock = vi.hoisted(() => ({
  delivery: { findUniqueOrThrow: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  deliveryStatusHistory: { create: vi.fn() },
  deliveryAttempt: { create: vi.fn() },
  routeEvent: { create: vi.fn() }
}));

vi.mock("../src/config/prisma", () => ({ prisma: prismaMock }));
vi.mock("../src/config/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

const planner = vi.hoisted(() => ({ recalculateRouteForPostmanId: vi.fn() }));
vi.mock("../src/services/routePlanner.service", () => planner);

import { ALLOWED_TRANSITIONS, transitionDeliveryStatus } from "../src/services/deliveryStatus.service";
import { DeliveryEvent, deliveryEventBus } from "../src/services/events.service";
import { REOPTIMIZE_EVENT_TYPES, handleDeliveryEvent } from "../src/services/routeEvents.listener";
import { AppError } from "../src/utils/AppError";

const ALL_STATUSES = Object.keys(ALLOWED_TRANSITIONS) as DeliveryStatus[];

function deliveryIn(status: DeliveryStatus, assignedPostmanId: string | null = "pm1") {
  prismaMock.delivery.findUniqueOrThrow.mockResolvedValue({ id: "d1", status, assignedPostmanId });
  prismaMock.delivery.update.mockImplementation(async ({ data }: { data: { status: DeliveryStatus } }) => ({
    id: "d1",
    status: data.status
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  deliveryEventBus.removeAllListeners();
});

describe("transitionDeliveryStatus — state machine", () => {
  it("accepts exactly the transitions in the allow-list and rejects every other pair", async () => {
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        vi.clearAllMocks();
        deliveryIn(from);
        const allowed = ALLOWED_TRANSITIONS[from].includes(to);

        const attempt = transitionDeliveryStatus({ deliveryId: "d1", toStatus: to, changedBy: "u1" });

        if (allowed) {
          await expect(attempt, `${from} -> ${to}`).resolves.toMatchObject({ status: to });
        } else {
          await expect(attempt, `${from} -> ${to}`).rejects.toMatchObject({ statusCode: 400 });
          expect(prismaMock.delivery.update, `${from} -> ${to}`).not.toHaveBeenCalled();
        }
      }
    }
  });

  it("does not let a delivery jump from ASSIGNED straight to DELIVERED", async () => {
    deliveryIn("ASSIGNED");
    const err = await transitionDeliveryStatus({ deliveryId: "d1", toStatus: "DELIVERED" }).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.message).toBe("Invalid delivery status transition: ASSIGNED -> DELIVERED");
    expect(prismaMock.delivery.update).not.toHaveBeenCalled();
    expect(prismaMock.deliveryStatusHistory.create).not.toHaveBeenCalled();
  });

  it("treats DELIVERED, RETURNED and CANCELLED as final", () => {
    expect(ALLOWED_TRANSITIONS.DELIVERED).toEqual([]);
    expect(ALLOWED_TRANSITIONS.RETURNED).toEqual([]);
    expect(ALLOWED_TRANSITIONS.CANCELLED).toEqual([]);
  });
});

describe("transitionDeliveryStatus — Mark Delivered", () => {
  it("OUT_FOR_DELIVERY -> DELIVERED updates the delivery, then records history and an attempt", async () => {
    deliveryIn("OUT_FOR_DELIVERY");

    const updated = await transitionDeliveryStatus({
      deliveryId: "d1",
      toStatus: "DELIVERED",
      reason: "Handed to recipient",
      changedBy: "user-1"
    });

    expect(updated.status).toBe("DELIVERED");
    expect(prismaMock.delivery.update).toHaveBeenCalledWith({ where: { id: "d1" }, data: { status: "DELIVERED" } });
    expect(prismaMock.deliveryStatusHistory.create).toHaveBeenCalledWith({
      data: {
        deliveryId: "d1",
        fromStatus: "OUT_FOR_DELIVERY",
        toStatus: "DELIVERED",
        reason: "Handed to recipient",
        changedBy: "user-1"
      }
    });
    expect(prismaMock.deliveryAttempt.create).toHaveBeenCalledWith({
      data: { deliveryId: "d1", postmanId: "pm1", outcome: "DELIVERED", notes: "Handed to recipient" }
    });
  });

  it("does not record a delivery attempt for an unassigned delivery", async () => {
    deliveryIn("SORTED", null);
    await transitionDeliveryStatus({ deliveryId: "d1", toStatus: "ASSIGNED" });
    expect(prismaMock.deliveryStatusHistory.create).toHaveBeenCalled();
    expect(prismaMock.deliveryAttempt.create).not.toHaveBeenCalled();
  });
});

describe("delivery events", () => {
  const collect = () => {
    const seen: DeliveryEvent[] = [];
    deliveryEventBus.on("event", (e: DeliveryEvent) => seen.push(e));
    return seen;
  };

  it("publishes an event for RECIPIENT_UNAVAILABLE, REJECTED, WRONG_ADDRESS and CANCELLED", async () => {
    const cases: [DeliveryStatus, DeliveryStatus][] = [
      ["OUT_FOR_DELIVERY", "RECIPIENT_UNAVAILABLE"],
      ["OUT_FOR_DELIVERY", "REJECTED"],
      ["OUT_FOR_DELIVERY", "WRONG_ADDRESS"],
      ["ASSIGNED", "CANCELLED"]
    ];
    for (const [from, to] of cases) {
      deliveryIn(from);
      const seen = collect();
      await transitionDeliveryStatus({ deliveryId: "d1", toStatus: to });
      expect(seen).toEqual([{ type: to, deliveryId: "d1" }]);
      deliveryEventBus.removeAllListeners();
    }
  });

  it("does not publish an event for DELIVERED", async () => {
    deliveryIn("OUT_FOR_DELIVERY");
    const seen = collect();
    await transitionDeliveryStatus({ deliveryId: "d1", toStatus: "DELIVERED" });
    expect(seen).toEqual([]);
  });
});

describe("route re-optimization listener (was: nothing consumed the events)", () => {
  it("re-plans the assigned postman's route for each of the four events", async () => {
    prismaMock.delivery.findUnique.mockResolvedValue({ assignedPostmanId: "pm9" });

    for (const type of REOPTIMIZE_EVENT_TYPES) {
      planner.recalculateRouteForPostmanId.mockClear();
      await handleDeliveryEvent({ type, deliveryId: "d1" });
      expect(planner.recalculateRouteForPostmanId).toHaveBeenCalledWith("pm9", type);
    }
    expect(REOPTIMIZE_EVENT_TYPES).toEqual(["RECIPIENT_UNAVAILABLE", "REJECTED", "WRONG_ADDRESS", "CANCELLED"]);
  });

  it("uses an explicit postmanId when the event carries one", async () => {
    await handleDeliveryEvent({ type: "REJECTED", postmanId: "pm2" });
    expect(prismaMock.delivery.findUnique).not.toHaveBeenCalled();
    expect(planner.recalculateRouteForPostmanId).toHaveBeenCalledWith("pm2", "REJECTED");
  });

  it("ignores events that do not affect the route and unassigned deliveries", async () => {
    await handleDeliveryEvent({ type: "BATTERY_LOW", deliveryId: "d1" });
    expect(planner.recalculateRouteForPostmanId).not.toHaveBeenCalled();

    prismaMock.delivery.findUnique.mockResolvedValue({ assignedPostmanId: null });
    await handleDeliveryEvent({ type: "REJECTED", deliveryId: "d1" });
    expect(planner.recalculateRouteForPostmanId).not.toHaveBeenCalled();
  });

  it("never throws, so a failed re-plan cannot break the status update that triggered it", async () => {
    prismaMock.delivery.findUnique.mockResolvedValue({ assignedPostmanId: "pm9" });
    planner.recalculateRouteForPostmanId.mockRejectedValue(new Error("optimizer down"));
    await expect(handleDeliveryEvent({ type: "CANCELLED", deliveryId: "d1" })).resolves.toBeUndefined();
  });
});

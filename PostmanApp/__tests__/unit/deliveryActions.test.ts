/* eslint-disable import/first -- jest.mock calls are hoisted above these imports. */
jest.mock("../../src/storage/offlineStorage", () => ({
  offlineStorage: {
    getMutationQueue: jest.fn().mockResolvedValue([]),
    setMutationQueue: jest.fn().mockResolvedValue(undefined),
    getCachedDeliveries: jest.fn(),
    setCachedDeliveries: jest.fn(),
    getCachedRoute: jest.fn(),
    setCachedRoute: jest.fn(),
    clearAll: jest.fn()
  }
}));
jest.mock("../../src/api/deliveryApi", () => ({
  deliveryApi: { updateStatus: jest.fn(), getById: jest.fn(), listMine: jest.fn() }
}));

import { canNavigateTo, primaryActionFor } from "../../src/hooks/useDeliveryActions";
import { ALLOWED_STATUS_TRANSITIONS, DeliveryStatus } from "../../src/types/delivery";

const ALL = Object.keys(ALLOWED_STATUS_TRANSITIONS) as DeliveryStatus[];

describe("primaryActionFor — the UI respects the status state machine", () => {
  it("offers Start Delivery (never Mark Delivered) for an ASSIGNED parcel", () => {
    expect(primaryActionFor("ASSIGNED")).toEqual({ label: "Start Delivery", next: "OUT_FOR_DELIVERY", confirm: false });
    expect(primaryActionFor("RESCHEDULED")).toMatchObject({ next: "OUT_FOR_DELIVERY" });
  });

  it("offers Mark Delivered — with a confirmation, since DELIVERED is final — only from OUT_FOR_DELIVERY", () => {
    expect(primaryActionFor("OUT_FOR_DELIVERY")).toEqual({ label: "Mark Delivered", next: "DELIVERED", confirm: true });
    for (const status of ALL.filter((s) => s !== "OUT_FOR_DELIVERY")) {
      expect(primaryActionFor(status)?.next).not.toBe("DELIVERED");
    }
  });

  it("offers no primary action for finished, failed or not-yet-assigned parcels", () => {
    for (const status of [
      "DELIVERED",
      "RETURNED",
      "CANCELLED",
      "FAILED",
      "REJECTED",
      "RECIPIENT_UNAVAILABLE",
      "WRONG_ADDRESS",
      "ADDRESS_NOT_FOUND",
      "RECEIVED",
      "SORTED"
    ] as DeliveryStatus[]) {
      expect(primaryActionFor(status)).toBeNull();
    }
  });

  it("only ever proposes a transition the backend allow-list accepts", () => {
    for (const status of ALL) {
      const action = primaryActionFor(status);
      if (action) expect(ALLOWED_STATUS_TRANSITIONS[status]).toContain(action.next);
    }
  });

  it("navigates only to parcels still on the round", () => {
    expect(canNavigateTo("ASSIGNED")).toBe(true);
    expect(canNavigateTo("OUT_FOR_DELIVERY")).toBe(true);
    expect(canNavigateTo("RESCHEDULED")).toBe(true);
    expect(canNavigateTo("DELIVERED")).toBe(false);
    expect(canNavigateTo("CANCELLED")).toBe(false);
  });
});

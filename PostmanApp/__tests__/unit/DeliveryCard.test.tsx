import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

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
jest.mock("../../src/utils/navigation", () => ({ openNavigation: jest.fn().mockResolvedValue(true) }));
jest.mock("../../src/utils/alerts", () => ({
  notify: jest.fn(),
  confirmAction: jest.fn().mockResolvedValue(true)
}));

import { DeliveryCard } from "../../src/components/delivery/DeliveryCard";
import { deliveryApi } from "../../src/api/deliveryApi";
import { openNavigation } from "../../src/utils/navigation";
import { confirmAction, notify } from "../../src/utils/alerts";
import { useOfflineStore } from "../../src/store/offlineStore";
import { ApiError } from "../../src/types/api";
import { DeliveryStatus } from "../../src/types/delivery";
import { buildStopViews } from "../../src/utils/routeView";
import { makeDelivery, makeRoute, makeStop } from "../_support/fixtures";

function viewFor(status: DeliveryStatus, sequence = 3, queuedStatus?: DeliveryStatus) {
  const route = makeRoute([makeStop("d1", sequence)]);
  return buildStopViews([makeDelivery("d1", status)], route, queuedStatus ? { d1: queuedStatus } : {})[0];
}

function renderCard(view: ReturnType<typeof viewFor>, expanded: boolean, handlers = { onToggle: jest.fn(), onOpenDetails: jest.fn() }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={client}>
      <DeliveryCard view={view} expanded={expanded} {...handlers} />
    </QueryClientProvider>
  );
  return { ...utils, client, ...handlers };
}

beforeEach(() => {
  jest.clearAllMocks();
  (confirmAction as jest.Mock).mockResolvedValue(true);
  useOfflineStore.setState({ isOnline: true, queue: [], conflicts: [], isSyncing: false });
});

describe("DeliveryCard — collapsed", () => {
  it("shows the stop number, recipient, status, distance from the previous stop and the address", () => {
    renderCard(viewFor("OUT_FOR_DELIVERY"), false);

    expect(screen.getByText("3")).toBeTruthy(); // route position
    expect(screen.getByText("Recipient d1")).toBeTruthy();
    expect(screen.getByText("Out for Delivery")).toBeTruthy();
    expect(screen.getByText("3.6 km · 9m")).toBeTruthy(); // 3 × the fixture's 1200 m / 180 s
    expect(screen.getByText(/d1 Station Road/)).toBeTruthy();
  });

  it("offers Navigate on the card itself, but keeps the status buttons for when it is expanded", () => {
    renderCard(viewFor("OUT_FOR_DELIVERY"), false);
    expect(screen.getByLabelText("Navigate")).toBeTruthy();
    expect(screen.queryByLabelText("Mark Delivered")).toBeNull();
  });

  it("shows the estimated arrival next to the distance", () => {
    renderCard(viewFor("OUT_FOR_DELIVERY"), false);
    expect(screen.getByText(/^Arrives \d/)).toBeTruthy();
  });

  it("does not offer Navigate for a delivery that is already done", () => {
    renderCard(viewFor("DELIVERED"), false);
    expect(screen.queryByLabelText("Navigate")).toBeNull();
  });

  it("expands/collapses when the header is tapped", () => {
    const { onToggle } = renderCard(viewFor("OUT_FOR_DELIVERY"), false);
    fireEvent.press(screen.getByLabelText(/Delivery 3 for Recipient d1/));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("flags the next stop", () => {
    renderCard(viewFor("ASSIGNED", 1), false);
    expect(screen.getByText("NEXT")).toBeTruthy();
  });

  it("shows ✓ instead of a number for a completed delivery", () => {
    renderCard(viewFor("DELIVERED"), false);
    expect(screen.getByText("✓")).toBeTruthy();
  });

  it("says when a status change is still waiting in the offline queue", () => {
    renderCard(viewFor("OUT_FOR_DELIVERY", 3, "DELIVERED"), false);
    expect(screen.getByText("Waiting to sync")).toBeTruthy();
    expect(screen.getByText("Delivered")).toBeTruthy(); // the status the queue will apply
  });
});

describe("DeliveryCard — expanded (only fields the Delivery model actually has)", () => {
  it("shows the address, parcel count/type, priority, tracking id and beat — and no invented weight", () => {
    renderCard(viewFor("OUT_FOR_DELIVERY"), true);

    expect(screen.getByText("d1 Station Road, Bhandup West, Mumbai, Maharashtra, 400078")).toBeTruthy();
    expect(screen.getByText("2 · Speed Post")).toBeTruthy();
    expect(screen.getByText("Phone")).toBeTruthy();
    expect(screen.getByText("NORMAL")).toBeTruthy();
    expect(screen.getByText("TRK-d1")).toBeTruthy();
    expect(screen.getByText("B01")).toBeTruthy();
    expect(screen.queryByText(/kg/i)).toBeNull();
    expect(screen.queryByText(/weight/i)).toBeNull();
  });

  it("opens the full details screen", () => {
    const { onOpenDetails } = renderCard(viewFor("OUT_FOR_DELIVERY"), true);
    fireEvent.press(screen.getByLabelText("Open full details"));
    expect(onOpenDetails).toHaveBeenCalledTimes(1);
  });
});

describe("DeliveryCard — Navigate", () => {
  it("navigates to the delivery's real coordinates and address", async () => {
    renderCard(viewFor("OUT_FOR_DELIVERY"), true);

    fireEvent.press(screen.getByLabelText("Navigate"));

    await waitFor(() => expect(openNavigation).toHaveBeenCalledTimes(1));
    const target = (openNavigation as jest.Mock).mock.calls[0][0];
    expect(target.latitude).toBeCloseTo(19.17, 5); // the route stop's coordinates (19.14 + 3/100)
    expect(target.longitude).toBeCloseTo(72.96, 5);
    expect(target.address.addressLine1).toBe("d1 Station Road");
  });

  it("tells the postman when no maps app could be opened", async () => {
    (openNavigation as jest.Mock).mockResolvedValueOnce(false);
    renderCard(viewFor("OUT_FOR_DELIVERY"), true);
    fireEvent.press(screen.getByLabelText("Navigate"));
    await waitFor(() => expect(notify).toHaveBeenCalledWith("Couldn't open maps", expect.any(String)));
  });

  it("is not offered for a delivery that is already done", () => {
    renderCard(viewFor("DELIVERED"), true);
    expect(screen.queryByLabelText("Navigate")).toBeNull();
    expect(screen.queryByLabelText("Mark Delivered")).toBeNull();
  });
});

describe("DeliveryCard — Mark Delivered goes through the API and respects the state machine", () => {
  it("OUT_FOR_DELIVERY: confirms, then calls POST status via the API (not just the UI)", async () => {
    (deliveryApi.updateStatus as jest.Mock).mockResolvedValue({ id: "d1", status: "DELIVERED" });
    const { client } = renderCard(viewFor("OUT_FOR_DELIVERY"), true);
    const invalidate = jest.spyOn(client, "invalidateQueries");

    fireEvent.press(screen.getByLabelText("Mark Delivered"));

    await waitFor(() => expect(deliveryApi.updateStatus).toHaveBeenCalledWith("d1", "DELIVERED", undefined));
    expect(confirmAction).toHaveBeenCalledTimes(1);
    // The route is re-read so the map/list drop the stop and re-plan.
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["route"] }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["deliveries"] });
  });

  it("does nothing if the postman cancels the confirmation", async () => {
    (confirmAction as jest.Mock).mockResolvedValue(false);
    renderCard(viewFor("OUT_FOR_DELIVERY"), true);

    fireEvent.press(screen.getByLabelText("Mark Delivered"));

    await waitFor(() => expect(confirmAction).toHaveBeenCalled());
    expect(deliveryApi.updateStatus).not.toHaveBeenCalled();
  });

  it("ASSIGNED: offers Start Delivery and NOT Mark Delivered (can't skip a step)", async () => {
    (deliveryApi.updateStatus as jest.Mock).mockResolvedValue({ id: "d1", status: "OUT_FOR_DELIVERY" });
    renderCard(viewFor("ASSIGNED"), true);

    expect(screen.queryByLabelText("Mark Delivered")).toBeNull();
    fireEvent.press(screen.getByLabelText("Start Delivery"));

    await waitFor(() => expect(deliveryApi.updateStatus).toHaveBeenCalledWith("d1", "OUT_FOR_DELIVERY", undefined));
    expect(confirmAction).not.toHaveBeenCalled(); // reversible step: no confirmation
  });

  it("shows the server's reason when it rejects the change, and does not queue it", async () => {
    (deliveryApi.updateStatus as jest.Mock).mockRejectedValue(
      new ApiError("Invalid delivery status transition: DELIVERED -> DELIVERED", 400)
    );
    renderCard(viewFor("OUT_FOR_DELIVERY"), true);

    fireEvent.press(screen.getByLabelText("Mark Delivered"));

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        "Couldn't update status",
        "Invalid delivery status transition: DELIVERED -> DELIVERED"
      )
    );
    expect(useOfflineStore.getState().queue).toHaveLength(0);
  });
});

describe("DeliveryCard — offline", () => {
  it("queues the delivery in the existing offline queue instead of calling the API", async () => {
    useOfflineStore.setState({ isOnline: false });
    renderCard(viewFor("OUT_FOR_DELIVERY"), true);

    fireEvent.press(screen.getByLabelText("Mark Delivered"));

    await waitFor(() => expect(useOfflineStore.getState().queue).toHaveLength(1));
    expect(deliveryApi.updateStatus).not.toHaveBeenCalled();
    expect(useOfflineStore.getState().queue[0]).toMatchObject({
      type: "DELIVERY_STATUS_UPDATE",
      deliveryId: "d1",
      status: "DELIVERED"
    });
    await waitFor(() => expect(notify).toHaveBeenCalledWith("Saved offline", expect.stringMatching(/sync automatically/i)));
  });
});

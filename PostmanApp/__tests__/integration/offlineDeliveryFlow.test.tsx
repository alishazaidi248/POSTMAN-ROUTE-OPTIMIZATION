import React from "react";
import { act, render, renderHook, screen, fireEvent, waitFor } from "@testing-library/react-native";
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

import { deliveryApi } from "../../src/api/deliveryApi";
import { pendingStatusMap, useUpdateDeliveryStatus } from "../../src/hooks/useDeliveries";
import { processQueue } from "../../src/services/syncService";
import { useOfflineStore } from "../../src/store/offlineStore";
import { ConflictBanner } from "../../src/components/common/ConflictBanner";
import { ApiError } from "../../src/types/api";

/** Store changes re-render the mounted hook, so they must happen inside act(). */
const setStore = (partial: Partial<ReturnType<typeof useOfflineStore.getState>>) =>
  act(() => {
    useOfflineStore.setState(partial);
  });

const sync = async (client = new QueryClient()) => {
  let summary!: Awaited<ReturnType<typeof processQueue>>;
  await act(async () => {
    summary = await processQueue(client);
  });
  return summary;
};

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useUpdateDeliveryStatus(), { wrapper });
  return { client, result };
}

beforeEach(() => {
  jest.clearAllMocks();
  useOfflineStore.setState({ isOnline: true, queue: [], conflicts: [], isSyncing: false });
});

describe("useUpdateDeliveryStatus (Mark Delivered path)", () => {
  it("online: goes to the server and refreshes deliveries, stats and the route", async () => {
    (deliveryApi.updateStatus as jest.Mock).mockResolvedValue({ id: "d1", status: "DELIVERED" });
    const { client, result } = setup();
    const invalidate = jest.spyOn(client, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync({ deliveryId: "d1", status: "DELIVERED" });
    });

    expect(deliveryApi.updateStatus).toHaveBeenCalledWith("d1", "DELIVERED", undefined);
    expect(useOfflineStore.getState().queue).toHaveLength(0);
    for (const key of ["deliveries", "deliveryStats", "route"]) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: [key] });
    }
  });

  it("offline: queues the update, never calls the API, and does not refresh the route (nothing changed server-side yet)", async () => {
    const { client, result } = setup();
    await setStore({ isOnline: false });
    const invalidate = jest.spyOn(client, "invalidateQueries");

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.mutateAsync({ deliveryId: "d1", status: "DELIVERED" });
    });

    expect(outcome).toEqual({ queued: true });
    expect(deliveryApi.updateStatus).not.toHaveBeenCalled();
    expect(useOfflineStore.getState().queue).toHaveLength(1);
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ["route"] });
  });

  it("thinks it is online but the network is actually down: falls back to the queue instead of losing the update", async () => {
    (deliveryApi.updateStatus as jest.Mock).mockRejectedValue(new ApiError("Network unavailable", 0, undefined, true));
    const { result } = setup();

    await act(async () => {
      await result.current.mutateAsync({ deliveryId: "d1", status: "DELIVERED" });
    });

    expect(useOfflineStore.getState().queue).toHaveLength(1);
  });

  it("a server rejection (400) is an error for the postman — it is not queued for retry", async () => {
    (deliveryApi.updateStatus as jest.Mock).mockRejectedValue(new ApiError("Invalid delivery status transition", 400));
    const { result } = setup();

    await act(async () => {
      await expect(result.current.mutateAsync({ deliveryId: "d1", status: "DELIVERED" })).rejects.toThrow(
        "Invalid delivery status transition"
      );
    });

    expect(useOfflineStore.getState().queue).toHaveLength(0);
  });

  it("an expired session is surfaced, not queued", async () => {
    (deliveryApi.updateStatus as jest.Mock).mockRejectedValue(new ApiError("Invalid or expired access token", 401));
    const { result } = setup();
    await act(async () => {
      await expect(result.current.mutateAsync({ deliveryId: "d1", status: "DELIVERED" })).rejects.toThrow(/expired/);
    });
    expect(useOfflineStore.getState().queue).toHaveLength(0);
  });
});

describe("offline → reconnect → sync", () => {
  it("replays a queued Mark Delivered oldest-first and then clears the pending state", async () => {
    const { result } = setup();
    await setStore({ isOnline: false });
    await act(async () => {
      await result.current.mutateAsync({ deliveryId: "d1", status: "OUT_FOR_DELIVERY" });
      await new Promise((r) => setTimeout(r, 5));
      await result.current.mutateAsync({ deliveryId: "d1", status: "DELIVERED" });
    });
    expect(pendingStatusMap(useOfflineStore.getState().queue)).toEqual({ d1: "DELIVERED" }); // last one wins for display

    await setStore({ isOnline: true });
    const order: string[] = [];
    (deliveryApi.updateStatus as jest.Mock).mockImplementation(async (id: string, status: string) => {
      order.push(`${id}:${status}`);
      return { id, status };
    });

    const summary = await sync();

    expect(order).toEqual(["d1:OUT_FOR_DELIVERY", "d1:DELIVERED"]);
    expect(summary).toEqual({ synced: 2, conflicted: 0, failed: 0 });
    expect(pendingStatusMap(useOfflineStore.getState().queue)).toEqual({});
  });

  it("when the server rejects the queued change it records a conflict and the banner tells the postman", async () => {
    const { result } = setup();
    await setStore({ isOnline: false });
    await act(async () => {
      await result.current.mutateAsync({ deliveryId: "d1", status: "DELIVERED" });
    });

    await setStore({ isOnline: true });
    (deliveryApi.updateStatus as jest.Mock).mockRejectedValue(new ApiError("Invalid delivery status transition", 400));
    (deliveryApi.getById as jest.Mock).mockResolvedValue({ id: "d1", status: "CANCELLED" });

    await sync();

    const { conflicts } = useOfflineStore.getState();
    expect(conflicts).toEqual([expect.objectContaining({ deliveryId: "d1", attemptedStatus: "DELIVERED", serverStatus: "CANCELLED" })]);

    const onDismiss = jest.fn();
    render(<ConflictBanner conflicts={conflicts} nameByDeliveryId={{ d1: "Rahul Sharma" }} onDismiss={onDismiss} />);
    expect(screen.getByText(/Couldn't apply "Delivered" for Rahul Sharma/)).toBeTruthy();
    expect(screen.getByText("Cancelled")).toBeTruthy();

    fireEvent.press(screen.getByLabelText("Dismiss"));
    await waitFor(() => expect(onDismiss).toHaveBeenCalledWith("d1"));
  });
});

describe("pendingStatusMap", () => {
  it("maps each delivery to its last queued status", () => {
    expect(
      pendingStatusMap([
        { deliveryId: "a", status: "OUT_FOR_DELIVERY" },
        { deliveryId: "b", status: "DELIVERED" },
        { deliveryId: "a", status: "DELIVERED" }
      ])
    ).toEqual({ a: "DELIVERED", b: "DELIVERED" });
    expect(pendingStatusMap([])).toEqual({});
  });
});

describe("ConflictBanner", () => {
  it("renders nothing when there are no conflicts", () => {
    const { toJSON } = render(<ConflictBanner conflicts={[]} nameByDeliveryId={{}} onDismiss={jest.fn()} />);
    expect(toJSON()).toBeNull();
  });
});

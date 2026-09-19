import { QueryClient } from "@tanstack/react-query";

/* eslint-disable import/first -- jest.mock calls are hoisted above these
   imports regardless of source order; grouping them first here is clearer. */
jest.mock("../../src/storage/offlineStorage", () => ({
  offlineStorage: {
    getMutationQueue: jest.fn().mockResolvedValue([]),
    setMutationQueue: jest.fn().mockResolvedValue(undefined),
    getCachedProfile: jest.fn(),
    setCachedProfile: jest.fn(),
    getCachedDeliveries: jest.fn(),
    setCachedDeliveries: jest.fn(),
    getCachedRoute: jest.fn(),
    setCachedRoute: jest.fn(),
    clearAll: jest.fn()
  }
}));

jest.mock("../../src/api/deliveryApi", () => ({
  deliveryApi: {
    updateStatus: jest.fn(),
    getById: jest.fn(),
    listMine: jest.fn()
  }
}));

import { deliveryApi } from "../../src/api/deliveryApi";
import { useOfflineStore } from "../../src/store/offlineStore";
import { processQueue } from "../../src/services/syncService";
import { ApiError } from "../../src/types/api";

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function resetStore() {
  useOfflineStore.setState({ isOnline: true, queue: [], conflicts: [], isSyncing: false });
}

describe("syncService.processQueue", () => {
  beforeEach(() => {
    resetStore();
    jest.clearAllMocks();
  });

  it("syncs a queued mutation successfully and removes it from the queue", async () => {
    await useOfflineStore.getState().enqueue({ type: "DELIVERY_STATUS_UPDATE", deliveryId: "d1", status: "DELIVERED" });
    (deliveryApi.updateStatus as jest.Mock).mockResolvedValueOnce({ id: "d1", status: "DELIVERED" });

    const summary = await processQueue(makeQueryClient());

    expect(summary).toEqual({ synced: 1, conflicted: 0, failed: 0 });
    expect(useOfflineStore.getState().queue).toHaveLength(0);
  });

  it("processes queued mutations in FIFO order", async () => {
    await useOfflineStore.getState().enqueue({ type: "DELIVERY_STATUS_UPDATE", deliveryId: "d1", status: "OUT_FOR_DELIVERY" });
    await new Promise((r) => setTimeout(r, 5));
    await useOfflineStore.getState().enqueue({ type: "DELIVERY_STATUS_UPDATE", deliveryId: "d2", status: "DELIVERED" });

    const calledOrder: string[] = [];
    (deliveryApi.updateStatus as jest.Mock).mockImplementation(async (id: string) => {
      calledOrder.push(id);
      return { id, status: "OK" };
    });

    await processQueue(makeQueryClient());

    expect(calledOrder).toEqual(["d1", "d2"]);
  });

  it("stops draining on a network failure and keeps the mutation queued", async () => {
    await useOfflineStore.getState().enqueue({ type: "DELIVERY_STATUS_UPDATE", deliveryId: "d1", status: "DELIVERED" });
    (deliveryApi.updateStatus as jest.Mock).mockRejectedValueOnce(new ApiError("Network unavailable", 0, undefined, true));

    const summary = await processQueue(makeQueryClient());

    expect(summary).toEqual({ synced: 0, conflicted: 0, failed: 1 });
    expect(useOfflineStore.getState().queue).toHaveLength(1);
    expect(useOfflineStore.getState().queue[0].attempts).toBe(1);
  });

  it("detects a conflict on a rejected transition, drops the mutation, and never overwrites server state", async () => {
    await useOfflineStore.getState().enqueue({ type: "DELIVERY_STATUS_UPDATE", deliveryId: "d1", status: "DELIVERED" });
    (deliveryApi.updateStatus as jest.Mock).mockRejectedValueOnce(new ApiError("Invalid transition", 400));
    (deliveryApi.getById as jest.Mock).mockResolvedValueOnce({ id: "d1", status: "CANCELLED" });

    const summary = await processQueue(makeQueryClient());

    expect(summary).toEqual({ synced: 0, conflicted: 1, failed: 0 });
    expect(useOfflineStore.getState().queue).toHaveLength(0);
    expect(useOfflineStore.getState().conflicts).toEqual([
      expect.objectContaining({ deliveryId: "d1", attemptedStatus: "DELIVERED", serverStatus: "CANCELLED" })
    ]);
  });
});

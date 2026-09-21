import { QueryClient } from "@tanstack/react-query";

/* eslint-disable import/first -- jest.mock calls are hoisted above these imports regardless of source order. */
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
  deliveryApi: { updateStatus: jest.fn(), uploadProof: jest.fn(), getById: jest.fn(), listMine: jest.fn() }
}));

import { deliveryApi } from "../../src/api/deliveryApi";
import { useOfflineStore } from "../../src/store/offlineStore";
import { MAX_PROOF_ATTEMPTS, processQueue } from "../../src/services/syncService";
import { ApiError } from "../../src/types/api";
import { getFreshFix, setLastFix } from "../../src/services/lastFix";

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const api = deliveryApi as unknown as Record<"updateStatus" | "uploadProof" | "getById", jest.Mock>;

beforeEach(() => {
  useOfflineStore.setState({ isOnline: true, queue: [], conflicts: [], isSyncing: false });
  jest.clearAllMocks();
});

describe("a delivery completed offline with a proof photo", () => {
  const queueDelivered = () =>
    useOfflineStore.getState().enqueue({
      type: "DELIVERY_STATUS_UPDATE",
      deliveryId: "d1",
      status: "DELIVERED",
      proofUri: "file:///documents/proof/1.jpg",
      proofCapturedAt: "2026-09-21T10:00:00.000Z",
      latitude: 19.1467,
      longitude: 72.9347,
      accuracyMeters: 8
    });

  it("sends the photo BEFORE the status change (the server refuses DELIVERED without it), then the fix with the status", async () => {
    await queueDelivered();
    const order: string[] = [];
    api.uploadProof.mockImplementation(async () => void order.push("photo"));
    api.updateStatus.mockImplementation(async () => void order.push("status"));

    expect(await processQueue(client())).toEqual({ synced: 1, conflicted: 0, failed: 0 });

    expect(order).toEqual(["photo", "status"]);
    expect(api.uploadProof).toHaveBeenCalledWith("d1", expect.objectContaining({ uri: "file:///documents/proof/1.jpg", capturedAt: "2026-09-21T10:00:00.000Z" }));
    expect(api.updateStatus).toHaveBeenCalledWith("d1", "DELIVERED", undefined, { latitude: 19.1467, longitude: 72.9347, accuracyMeters: 8 });
    expect(useOfflineStore.getState().queue).toHaveLength(0);
  });

  it("keeps the change (and its photo) queued when the network is still down, and does not send the status without the photo", async () => {
    await queueDelivered();
    api.uploadProof.mockRejectedValue(new ApiError("Network unavailable", 0, undefined, true));

    expect(await processQueue(client())).toEqual({ synced: 0, conflicted: 0, failed: 1 });

    expect(api.updateStatus).not.toHaveBeenCalled();
    expect(useOfflineStore.getState().queue).toHaveLength(1);
    expect(useOfflineStore.getState().queue[0].proofUri).toBe("file:///documents/proof/1.jpg");
  });

  it("when the server says the photo is missing, it is reported to the postman in words, never silently dropped", async () => {
    await useOfflineStore.getState().enqueue({ type: "DELIVERY_STATUS_UPDATE", deliveryId: "d1", status: "DELIVERED" });
    api.updateStatus.mockRejectedValue(new ApiError("A photo of the delivery is required to complete it.", 400, { proofRequired: true }));
    api.getById.mockResolvedValue({ id: "d1", status: "OUT_FOR_DELIVERY" });

    expect(await processQueue(client())).toEqual({ synced: 0, conflicted: 1, failed: 0 });

    const [conflict] = useOfflineStore.getState().conflicts;
    expect(conflict).toMatchObject({ deliveryId: "d1", attemptedStatus: "DELIVERED", serverStatus: "OUT_FOR_DELIVERY" });
    expect(conflict.reason).toMatch(/requires a photo/i);
  });

  it("a photo that cannot be sent after many tries becomes a conflict with a reason instead of retrying for ever", async () => {
    await queueDelivered();
    useOfflineStore.setState({ queue: useOfflineStore.getState().queue.map((m) => ({ ...m, attempts: MAX_PROOF_ATTEMPTS - 1 })) });
    api.uploadProof.mockRejectedValue(new ApiError("Network unavailable", 0, undefined, true));

    expect(await processQueue(client())).toEqual({ synced: 0, conflicted: 1, failed: 0 });
    expect(useOfflineStore.getState().conflicts[0].reason).toMatch(/photo could not be sent/i);
    expect(useOfflineStore.getState().queue).toHaveLength(0);
  });
});

describe("the GPS fix that goes with a delivery", () => {
  it("is only used when it is recent", () => {
    setLastFix({ latitude: 19.1, longitude: 72.9, accuracy: 10, timestamp: Date.now() - 10 * 60_000 });
    expect(getFreshFix()).toBeNull();
    setLastFix({ latitude: 19.1, longitude: 72.9, accuracy: 10, timestamp: Date.now() - 5_000 });
    expect(getFreshFix()).toMatchObject({ latitude: 19.1, accuracy: 10 });
    setLastFix(null);
    expect(getFreshFix()).toBeNull();
  });
});

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/* eslint-disable import/first -- jest.mock calls are hoisted above these imports. */
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
jest.mock("../../src/api/postmanApi", () => ({ postmanApi: { getProfile: jest.fn(), getStats: jest.fn() } }));
jest.mock("../../src/services/proofService", () => ({ takeProofPhoto: jest.fn(), discardProofPhoto: jest.fn() }));
jest.mock("../../src/utils/navigation", () => ({ openNavigation: jest.fn().mockResolvedValue(true) }));
jest.mock("../../src/utils/alerts", () => ({ notify: jest.fn(), confirmAction: jest.fn().mockResolvedValue(true) }));

import { DeliveryCard } from "../../src/components/delivery/DeliveryCard";
import { deliveryApi } from "../../src/api/deliveryApi";
import { postmanApi } from "../../src/api/postmanApi";
import { takeProofPhoto } from "../../src/services/proofService";
import { setLastFix } from "../../src/services/lastFix";
import { notify } from "../../src/utils/alerts";
import { useOfflineStore } from "../../src/store/offlineStore";
import { buildStopViews } from "../../src/utils/routeView";
import { makeDelivery, makeRoute, makeStop } from "../_support/fixtures";

const api = deliveryApi as unknown as Record<"updateStatus" | "uploadProof", jest.Mock>;
const PHOTO = { ok: true, photo: { uri: "file:///documents/proof/1.jpg", capturedAt: "2026-09-21T10:00:00.000Z" } };

function renderOutForDelivery(proofMode: "NONE" | "PHOTO") {
  (postmanApi.getProfile as jest.Mock).mockResolvedValue({ postman: {}, beat: null, postOffice: { id: "po", name: "Bhandup West", code: "BW", proofMode }, lastKnownLocation: null });
  const view = buildStopViews([makeDelivery("d1", "OUT_FOR_DELIVERY")], makeRoute([makeStop("d1", 1)]), {})[0];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <DeliveryCard view={view} expanded onToggle={jest.fn()} onOpenDetails={jest.fn()} />
    </QueryClientProvider>
  );
  return client;
}

// the profile arrives asynchronously; the photo requirement is known once it has
const profileLoaded = () => waitFor(() => expect(postmanApi.getProfile).toHaveBeenCalled());

beforeEach(() => {
  jest.clearAllMocks();
  setLastFix(null);
  useOfflineStore.setState({ isOnline: true, queue: [], conflicts: [], isSyncing: false });
  api.updateStatus.mockResolvedValue({ id: "d1", status: "DELIVERED" });
  api.uploadProof.mockResolvedValue(undefined);
});

describe("Mark Delivered where the post office requires a photo", () => {
  it("takes the photo first, sends it, then records DELIVERED", async () => {
    (takeProofPhoto as jest.Mock).mockResolvedValue(PHOTO);
    const order: string[] = [];
    api.uploadProof.mockImplementation(async () => void order.push("photo"));
    api.updateStatus.mockImplementation(async () => void order.push("status"));
    renderOutForDelivery("PHOTO");
    await profileLoaded();
    await waitFor(() => expect(screen.getByLabelText("Mark Delivered")).toBeTruthy());
    // let the profile query settle into the hook
    await new Promise((r) => setTimeout(r, 20));

    fireEvent.press(screen.getByLabelText("Mark Delivered"));

    await waitFor(() => expect(api.updateStatus).toHaveBeenCalled());
    expect(order).toEqual(["photo", "status"]);
    expect(api.uploadProof).toHaveBeenCalledWith("d1", expect.objectContaining({ uri: PHOTO.photo.uri }));
  });

  it("records NOTHING when the postman does not take the photo, and says why", async () => {
    (takeProofPhoto as jest.Mock).mockResolvedValue({ ok: false, reason: "CANCELLED" });
    renderOutForDelivery("PHOTO");
    await profileLoaded();
    await new Promise((r) => setTimeout(r, 20));

    fireEvent.press(screen.getByLabelText("Mark Delivered"));

    await waitFor(() => expect(notify).toHaveBeenCalledWith("Photo needed", expect.stringMatching(/requires a photo/i)));
    expect(api.uploadProof).not.toHaveBeenCalled();
    expect(api.updateStatus).not.toHaveBeenCalled();
  });

  it("offline: the photo and the change are queued together (the photo is not lost), and nothing is sent yet", async () => {
    (takeProofPhoto as jest.Mock).mockResolvedValue(PHOTO);
    useOfflineStore.setState({ isOnline: false });
    renderOutForDelivery("PHOTO");
    await profileLoaded();
    await new Promise((r) => setTimeout(r, 20));

    fireEvent.press(screen.getByLabelText("Mark Delivered"));

    await waitFor(() => expect(useOfflineStore.getState().queue).toHaveLength(1));
    expect(useOfflineStore.getState().queue[0]).toMatchObject({ deliveryId: "d1", status: "DELIVERED", proofUri: PHOTO.photo.uri, proofCapturedAt: PHOTO.photo.capturedAt });
    expect(api.uploadProof).not.toHaveBeenCalled();
    expect(api.updateStatus).not.toHaveBeenCalled();
  });

  it("sends the postman's own fresh GPS fix (not the address's coordinates) with the delivery", async () => {
    (takeProofPhoto as jest.Mock).mockResolvedValue(PHOTO);
    setLastFix({ latitude: 19.1467, longitude: 72.9347, accuracy: 9, timestamp: Date.now() });
    renderOutForDelivery("PHOTO");
    await profileLoaded();
    await new Promise((r) => setTimeout(r, 20));

    fireEvent.press(screen.getByLabelText("Mark Delivered"));

    await waitFor(() => expect(api.updateStatus).toHaveBeenCalled());
    expect(api.updateStatus).toHaveBeenCalledWith("d1", "DELIVERED", undefined, { latitude: 19.1467, longitude: 72.9347, accuracyMeters: 9 });
  });
});

describe("Mark Delivered where no proof is required", () => {
  it("never opens the camera", async () => {
    renderOutForDelivery("NONE");
    await profileLoaded();
    await new Promise((r) => setTimeout(r, 20));

    fireEvent.press(screen.getByLabelText("Mark Delivered"));

    await waitFor(() => expect(api.updateStatus).toHaveBeenCalled());
    expect(takeProofPhoto).not.toHaveBeenCalled();
    expect(api.uploadProof).not.toHaveBeenCalled();
  });
});

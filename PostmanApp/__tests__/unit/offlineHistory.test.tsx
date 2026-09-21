import React from "react";
import { render, renderHook, screen, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/* eslint-disable import/first -- jest.mock calls are hoisted above these imports. */
const mockStore: Record<string, unknown> = {};
jest.mock("../../src/storage/offlineStorage", () => ({
  offlineStorage: {
    getCachedHistory: jest.fn(async (key: string) => mockStore[key] ?? null),
    setCachedHistory: jest.fn(async (key: string, value: unknown) => void (mockStore[key] = value))
  }
}));
jest.mock("../../src/api/deliveryApi", () => ({ deliveryApi: { listHistory: jest.fn() } }));

import { deliveryApi } from "../../src/api/deliveryApi";
import { offlineStorage } from "../../src/storage/offlineStorage";
import { useDeliveryHistory } from "../../src/hooks/useDeliveryHistory";
import { HistorySyncSection } from "../../src/components/delivery/HistorySyncSection";
import { buildSyncItems, syncSummary } from "../../src/utils/syncStatus";
import { ApiError } from "../../src/types/api";
import { makeDelivery } from "../_support/fixtures";

const page = () => ({ total: 1, page: 1, pageSize: 30, summary: { delivered: 1, returned: 0 }, rows: [{ ...makeDelivery("d1", "DELIVERED"), finishedAt: "2026-09-20T10:00:00.000Z" }] });
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>{children}</QueryClientProvider>
);

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(mockStore)) delete mockStore[k];
});

describe("history with no connection", () => {
  it("online: shows the server's page and saves it on the phone", async () => {
    (deliveryApi.listHistory as jest.Mock).mockResolvedValue(page());
    const { result } = renderHook(() => useDeliveryHistory(30, "ALL"), { wrapper });
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    expect(result.current.fromCache).toBe(false);
    expect(offlineStorage.setCachedHistory).toHaveBeenCalledWith("30:ALL", expect.objectContaining({ total: 1 }));
  });

  it("offline: shows the copy last saved for the same period and outcome, marked as saved", async () => {
    mockStore["30:ALL"] = page();
    (deliveryApi.listHistory as jest.Mock).mockRejectedValue(new ApiError("Network unavailable", 0, undefined, true));
    const { result } = renderHook(() => useDeliveryHistory(30, "ALL"), { wrapper });
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    expect(result.current.fromCache).toBe(true);
    expect(result.current.isError).toBe(false);
  });

  it("offline with nothing saved for that filter: an error (the retry state), never an invented empty list", async () => {
    (deliveryApi.listHistory as jest.Mock).mockRejectedValue(new ApiError("Network unavailable", 0, undefined, true));
    const { result } = renderHook(() => useDeliveryHistory(7, "RETURNED"), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.rows).toHaveLength(0);
  });

  it("a server error (not a network one) is never replaced by the saved copy", async () => {
    mockStore["30:ALL"] = page();
    (deliveryApi.listHistory as jest.Mock).mockRejectedValue(new ApiError("Boom", 500));
    const { result } = renderHook(() => useDeliveryHistory(30, "ALL"), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.fromCache).toBe(false);
  });
});

describe("changes that are not on the server yet", () => {
  const queued = (id: string, status: "DELIVERED" | "RETURNED", queuedAt: string, extra = {}) => ({ id: `${id}-1`, type: "DELIVERY_STATUS_UPDATE" as const, deliveryId: id, status, queuedAt, attempts: 0, ...extra });

  it("lists queued changes and conflicts, newest first; a conflict supersedes the queued change for that delivery", () => {
    const items = buildSyncItems(
      [queued("a", "DELIVERED", "2026-09-21T09:00:00.000Z", { proofUri: "file:///p.jpg" }), queued("b", "DELIVERED", "2026-09-21T08:00:00.000Z")],
      [{ deliveryId: "b", attemptedStatus: "DELIVERED", serverStatus: "CANCELLED", detectedAt: "2026-09-21T10:00:00.000Z" }]
    );
    expect(items.map((i) => [i.deliveryId, i.state])).toEqual([["b", "CONFLICT"], ["a", "QUEUED"]]);
    expect(items[1].hasPhoto).toBe(true);
    expect(syncSummary(items)).toBe("1 waiting to sync · 1 could not be applied");
  });

  it("is shown above the list with plain words: Waiting to sync / Conflict, and the reason", () => {
    const items = buildSyncItems(
      [queued("a", "DELIVERED", "2026-09-21T09:00:00.000Z")],
      [{ deliveryId: "b", attemptedStatus: "DELIVERED", serverStatus: "OUT_FOR_DELIVERY", detectedAt: "2026-09-21T10:00:00.000Z", reason: "The delivery photo could not be sent." }]
    );
    render(<HistorySyncSection items={items} isOnline={false} fromCache nameOf={(id) => (id === "a" ? "Aarav Sharma" : undefined)} onOpenSync={jest.fn()} />);
    expect(screen.getByText("Aarav Sharma")).toBeTruthy();
    expect(screen.getByText("Waiting to sync")).toBeTruthy();
    expect(screen.getByText("Conflict")).toBeTruthy();
    expect(screen.getByText(/photo could not be sent/)).toBeTruthy();
    expect(screen.getByText(/You are offline/)).toBeTruthy();
  });

  it("shows nothing when online, current and everything is synced", () => {
    render(<HistorySyncSection items={[]} isOnline fromCache={false} nameOf={() => undefined} onOpenSync={jest.fn()} />);
    expect(screen.queryByTestId("history-sync")).toBeNull();
  });
});

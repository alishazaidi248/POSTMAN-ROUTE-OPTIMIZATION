import React from "react";
import { fireEvent, render as baseRender, screen } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DeliveryHistoryView } from "../../src/screens/deliveries/DeliveryHistoryView";
import { daySummary, dayLabel, groupByDay, isPastFinished, periodStart, startOfToday } from "../../src/utils/history";
import { FinishedDelivery } from "../../src/types/delivery";
import { makeDelivery } from "../_support/fixtures";

// jest.mock calls are hoisted above the imports by babel-jest; variables they read are prefixed `mock`.
const mockNavigate = jest.fn();
jest.mock("@react-navigation/native", () => ({ useNavigation: () => ({ navigate: mockNavigate, getParent: () => ({ navigate: mockNavigate }) }) }));
jest.mock("../../src/storage/offlineStorage", () => ({ offlineStorage: { getMutationQueue: jest.fn().mockResolvedValue([]), setMutationQueue: jest.fn() } }));

// the view reads the offline queue and the phone's cached lists, so it needs a query client
const render = (ui: React.ReactElement) => baseRender(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

const mockHistory = { current: null as unknown };
const mockUseHistory = jest.fn((..._args: unknown[]) => mockHistory.current);
jest.mock("../../src/hooks/useDeliveryHistory", () => ({ useDeliveryHistory: (...args: unknown[]) => mockUseHistory(...args) }));

const NOW = new Date(2026, 8, 21, 12, 0, 0); // 21 Sep 2026, midday (local)
const at = (dayOffset: number, hour: number, minute = 0) => new Date(2026, 8, 21 + dayOffset, hour, minute).toISOString();
const finished = (id: string, status: "DELIVERED" | "RETURNED", finishedAt: string): FinishedDelivery => ({
  ...makeDelivery(id, status, { recipient: { id: `r${id}`, name: `Person ${id}`, phone: null, altPhone: null } }),
  finishedAt
});

type Node = { children?: (Node | string)[] | null } | string | null;
/** All the words on screen, joined. */
function collectText(node: Node | Node[]): string {
  if (node === null || node === undefined) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(collectText).join(" ");
  return (node.children ?? []).map((c) => collectText(c as Node)).join(" ");
}

function hook(over: Record<string, unknown> = {}) {
  const rows = [
    finished("a", "DELIVERED", at(-1, 16, 30)),
    finished("b", "DELIVERED", at(-1, 9, 5)),
    finished("c", "RETURNED", at(-3, 11)),
    finished("d", "DELIVERED", at(-3, 10))
  ];
  return {
    rows,
    total: 4,
    summary: { delivered: 3, returned: 1 },
    isLoading: false,
    isError: false,
    isRefetching: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    fetchNextPage: jest.fn(),
    refetch: jest.fn(),
    ...over
  };
}

describe("history helpers", () => {
  it("startOfToday is local midnight; periodStart counts whole days back from it (null = all time)", () => {
    expect(startOfToday(NOW).getTime()).toBe(new Date(2026, 8, 21).getTime());
    expect(periodStart(7, NOW)?.getTime()).toBe(new Date(2026, 8, 14).getTime());
    expect(periodStart(null, NOW)).toBeNull();
  });

  it("labels days as Today, Yesterday, then the weekday and date", () => {
    expect(dayLabel(new Date(2026, 8, 21, 8), NOW)).toBe("Today");
    expect(dayLabel(new Date(2026, 8, 20, 23, 59), NOW)).toBe("Yesterday");
    expect(dayLabel(new Date(2026, 8, 18, 10), NOW)).not.toMatch(/Today|Yesterday/);
    expect(dayLabel(new Date(2026, 8, 18, 10), NOW)).toMatch(/18/);
  });

  it("groups by local day, newest day and newest delivery first, and counts the outcomes", () => {
    const days = groupByDay([finished("d", "DELIVERED", at(-3, 10)), finished("b", "DELIVERED", at(-1, 9)), finished("a", "DELIVERED", at(-1, 16)), finished("c", "RETURNED", at(-3, 11))], NOW);
    expect(days.map((d) => d.label)).toEqual(["Yesterday", expect.any(String)]);
    expect(days[0].data.map((r) => r.id)).toEqual(["a", "b"]);
    expect(days[1].data.map((r) => r.id)).toEqual(["c", "d"]);
    expect(days[1]).toMatchObject({ delivered: 1, returned: 1 });
    expect(daySummary(days[1])).toBe("1 delivered · 1 returned");
    expect(daySummary({ delivered: 2, returned: 0 })).toBe("2 delivered");
  });

  it("isPastFinished: only finished deliveries from an earlier day leave today's list", () => {
    expect(isPastFinished({ status: "DELIVERED", updatedAt: at(-1, 18) }, NOW)).toBe(true);
    expect(isPastFinished({ status: "RETURNED", updatedAt: at(-2, 8) }, NOW)).toBe(true);
    expect(isPastFinished({ status: "DELIVERED", updatedAt: at(0, 8) }, NOW)).toBe(false);
    expect(isPastFinished({ status: "ASSIGNED", updatedAt: at(-5, 8) }, NOW)).toBe(false);
    expect(isPastFinished({ status: "FAILED", updatedAt: at(-5, 8) }, NOW)).toBe(false);
  });
});

describe("DeliveryHistoryView", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockUseHistory.mockClear();
    mockHistory.current = hook();
  });

  it("shows past deliveries under a heading per day, with the recipient, how it ended and the time", () => {
    render(<DeliveryHistoryView />);
    expect(screen.getByText("Yesterday")).toBeTruthy();
    expect(screen.getByText("2 delivered")).toBeTruthy();
    expect(screen.getByText("Person a")).toBeTruthy();
    expect(screen.getByText("Person c")).toBeTruthy();
    expect(screen.getAllByText("Delivered").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Returned").length).toBeGreaterThan(0);
    expect(screen.getByText("4 past deliveries shown")).toBeTruthy();
  });

  it("shows no internal ids, and no algorithm or route wording", () => {
    render(<DeliveryHistoryView />);
    const texts = collectText(screen.toJSON());
    expect(texts).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(texts).not.toMatch(/DBSCAN|ALNS|2-opt|algorithm/i);
  });

  it("opens the delivery's details when a row is tapped", () => {
    render(<DeliveryHistoryView />);
    fireEvent.press(screen.getByLabelText(/Person a, delivered at/));
    expect(mockNavigate).toHaveBeenCalledWith("DeliveryDetails", { deliveryId: "a" });
  });

  it("asks for the last 30 days, all outcomes, first; the chips change the request", () => {
    render(<DeliveryHistoryView />);
    expect(mockUseHistory).toHaveBeenLastCalledWith(30, "ALL");
    fireEvent.press(screen.getByLabelText("Period: Last 7 days"));
    expect(mockUseHistory).toHaveBeenLastCalledWith(7, "ALL");
    fireEvent.press(screen.getByLabelText("Period: All time"));
    expect(mockUseHistory).toHaveBeenLastCalledWith(null, "ALL");
    fireEvent.press(screen.getByLabelText(/Outcome: Returned/));
    expect(mockUseHistory).toHaveBeenLastCalledWith(null, "RETURNED");
  });

  it("shows the counts on the outcome chips", () => {
    render(<DeliveryHistoryView />);
    expect(screen.getByLabelText("Outcome: All (4)")).toBeTruthy();
    expect(screen.getByLabelText("Outcome: Delivered (3)")).toBeTruthy();
    expect(screen.getByLabelText("Outcome: Returned (1)")).toBeTruthy();
  });

  it("offers Load more while there are more pages, and loads the next page", () => {
    const fetchNextPage = jest.fn();
    mockHistory.current = hook({ hasNextPage: true, fetchNextPage });
    render(<DeliveryHistoryView />);
    fireEvent.press(screen.getByText("Load more"));
    expect(fetchNextPage).toHaveBeenCalled();
  });

  it("says so when there is nothing yet", () => {
    mockHistory.current = hook({ rows: [], total: 0, summary: { delivered: 0, returned: 0 } });
    render(<DeliveryHistoryView />);
    expect(screen.getByText("No past deliveries yet")).toBeTruthy();
  });

  it("shows a plain-language error with a retry when it cannot load", () => {
    const refetch = jest.fn();
    mockHistory.current = hook({ rows: [], isError: true, refetch });
    render(<DeliveryHistoryView />);
    expect(screen.getByText(/could not load your past deliveries/i)).toBeTruthy();
    fireEvent.press(screen.getByText("Try Again"));
    expect(refetch).toHaveBeenCalled();
  });

  it("shows a loading state first", () => {
    mockHistory.current = hook({ rows: [], isLoading: true });
    render(<DeliveryHistoryView />);
    expect(screen.getByLabelText("Loading your past deliveries...")).toBeTruthy();
  });
});

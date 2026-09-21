import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Image } from "react-native";
import { HomeScreen, greeting } from "../../src/screens/home/HomeScreen";
import { AccountScreen } from "../../src/screens/account/AccountScreen";
import { Avatar, initialsOf } from "../../src/components/common/Avatar";
import { resolveAssetUrl } from "../../src/utils/assetUrl";
import { buildStopViews, findNextStop } from "../../src/utils/routeView";
import { makeDelivery, makeRoute, makeStop } from "../_support/fixtures";

// jest.mock calls are hoisted above the imports by babel-jest; variables they read are prefixed `mock`.
const mockNavigate = jest.fn();
jest.mock("@react-navigation/native", () => ({ useNavigation: () => ({ navigate: mockNavigate }) }));
jest.mock("../../src/hooks/useRefreshStaleOnFocus", () => ({ useRefreshStaleOnFocus: jest.fn() }));
jest.mock("../../src/utils/navigation", () => ({ openNavigation: jest.fn().mockResolvedValue(true) }));
jest.mock("../../src/utils/alerts", () => ({ notify: jest.fn(), confirmAction: jest.fn().mockResolvedValue(true) }));
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
jest.mock("../../src/api/deliveryApi", () => ({ deliveryApi: { updateStatus: jest.fn(), getById: jest.fn(), listMine: jest.fn() } }));

const mockData = {
  profile: { current: null as unknown },
  stats: { current: null as unknown },
  map: { current: null as unknown }
};
jest.mock("../../src/hooks/usePostmanProfile", () => ({ usePostmanProfile: () => mockData.profile.current }));
jest.mock("../../src/hooks/useOfflineSync", () => ({
  useOfflineSync: () => ({ isOnline: true, queueLength: 0, conflicts: [], clearConflict: jest.fn(), sync: jest.fn() })
}));
jest.mock("../../src/hooks/useDeliveries", () => ({
  ...jest.requireActual("../../src/hooks/useDeliveries"),
  useDeliveryStats: () => mockData.stats.current
}));
jest.mock("../../src/screens/map/useMapScreenData", () => ({ useMapScreenData: () => mockData.map.current }));

const POSTMAN = {
  id: "pm1",
  employeeId: "PM-BHW-001",
  postOfficeId: "po1",
  name: "Ramesh Kadam",
  phone: "9820011122",
  email: null,
  status: "ACTIVE" as const,
  assignedBeatId: "b1",
  profilePhotoUrl: null as string | null,
  lastActiveAt: null
};
const BEAT = { id: "b1", beatNumber: "B201", name: "Sector 3", centerLatitude: 19.1, centerLongitude: 72.9, status: "ACTIVE" as const };

function profile(photo: string | null = null) {
  mockData.profile.current = {
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
    data: { postman: { ...POSTMAN, profilePhotoUrl: photo }, beat: BEAT, postOffice: { id: "po1", name: "Bhandup West Post Office", code: "BW" }, lastKnownLocation: null }
  };
}

function withData() {
  const route = makeRoute([makeStop("a", 1), makeStop("b", 2)]);
  const views = buildStopViews([makeDelivery("a", "ASSIGNED"), makeDelivery("b", "ASSIGNED")], route);
  mockData.map.current = {
    isLoading: false,
    isRefreshing: false,
    refetch: jest.fn(),
    route,
    next: findNextStop(views),
    total: 2,
    doneCount: 0,
    remaining: 2,
    recipientNameByDeliveryId: { a: "Recipient a", b: "Recipient b" }
  };
  mockData.stats.current = { data: { today: { total: 24, completed: 11, failed: 0, remaining: 13 }, completionRate: 0.46 }, refetch: jest.fn() };
}

const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

beforeEach(() => {
  jest.clearAllMocks();
  profile();
  withData();
});

describe("Avatar", () => {
  it("shows initials when there is no photo: Ramesh Kadam -> RK", () => {
    expect(initialsOf("Ramesh Kadam")).toBe("RK");
    expect(initialsOf("Cher")).toBe("C");
    expect(initialsOf("  ")).toBe("?");
    render(<Avatar name="Ramesh Kadam" photoUrl={null} />);
    expect(screen.getByText("RK")).toBeTruthy();
  });

  it("shows the photo when there is one, and falls back to initials if it cannot be loaded", () => {
    const { UNSAFE_getByType } = render(<Avatar name="Ramesh Kadam" photoUrl="/uploads/profile/x.jpg" />);
    expect(screen.queryByText("RK")).toBeNull();
    const image = UNSAFE_getByType(Image);
    expect(image.props.source.uri).toBe("http://localhost:4000/uploads/profile/x.jpg");
    fireEvent(image, "error");
    expect(screen.getByText("RK")).toBeTruthy();
  });
});

describe("resolveAssetUrl", () => {
  it("makes a server path absolute against the API origin, and leaves full URLs alone", () => {
    expect(resolveAssetUrl("/uploads/profile/a.jpg", "https://api.example.com/api/v1")).toBe("https://api.example.com/uploads/profile/a.jpg");
    expect(resolveAssetUrl("/uploads/profile/a.jpg", "http://10.0.2.2:4000/api/v1/")).toBe("http://10.0.2.2:4000/uploads/profile/a.jpg");
    expect(resolveAssetUrl("https://cdn.example.com/a.jpg", "http://x/api/v1")).toBe("https://cdn.example.com/a.jpg");
    expect(resolveAssetUrl(null)).toBeNull();
    expect(resolveAssetUrl("relative/path.jpg")).toBeNull();
  });
});

describe("greeting", () => {
  it("follows the time of day", () => {
    expect(greeting(new Date(2026, 8, 21, 8))).toBe("Good morning");
    expect(greeting(new Date(2026, 8, 21, 13))).toBe("Good afternoon");
    expect(greeting(new Date(2026, 8, 21, 19))).toBe("Good evening");
  });
});

describe("HomeScreen", () => {
  it("greets the postman by first name and shows their beat", () => {
    wrap(<HomeScreen />);
    expect(screen.getByText(/Good (morning|afternoon|evening), Ramesh/)).toBeTruthy();
    expect(screen.getByText("B201 — Sector 3")).toBeTruthy();
  });

  it("shows today's numbers: total, completed and remaining", () => {
    wrap(<HomeScreen />);
    expect(screen.getByText("24 Deliveries")).toBeTruthy();
    expect(screen.getByText("11")).toBeTruthy();
    expect(screen.getByText("13")).toBeTruthy();
    expect(screen.getByText("Completed")).toBeTruthy();
    expect(screen.getByText("Remaining")).toBeTruthy();
  });

  it("shows the next delivery with its address, distance, arrival time, Navigate and Start Delivery", () => {
    wrap(<HomeScreen />);
    expect(screen.getByText("Recipient a")).toBeTruthy();
    expect(screen.getByText(/a Station Road/)).toBeTruthy();
    expect(screen.getByText("1.2 km · 3m")).toBeTruthy();
    expect(screen.getByText(/^ETA \d/)).toBeTruthy();
    expect(screen.getByLabelText("Navigate")).toBeTruthy();
    expect(screen.getByLabelText("Start Delivery")).toBeTruthy();
  });

  it("opens the route map from 'View Route'", () => {
    wrap(<HomeScreen />);
    fireEvent.press(screen.getByLabelText("View route"));
    expect(mockNavigate).toHaveBeenCalledWith("MapTab", { screen: "MapHome" });
  });

  it("says so when everything is done", () => {
    mockData.map.current = { ...(mockData.map.current as object), next: null, remaining: 0 };
    wrap(<HomeScreen />);
    expect(screen.getByText(/All done for today/)).toBeTruthy();
  });

  it("never shows an algorithm, a route method or a cluster", () => {
    wrap(<HomeScreen />);
    expect(screen.queryByText(/DBSCAN|ALNS|2-opt|nearest neighbo|algorithm|method|cluster/i)).toBeNull();
  });

  it("shows a friendly error with Try Again when the profile cannot be loaded", () => {
    mockData.profile.current = { isLoading: false, isError: true, data: undefined, refetch: jest.fn() };
    wrap(<HomeScreen />);
    expect(screen.getByText(/could not load your details/i)).toBeTruthy();
    expect(screen.getByLabelText("Try Again")).toBeTruthy();
  });
});

describe("AccountScreen", () => {
  it("shows the photo or initials, name, employee id, beat and post office", () => {
    wrap(<AccountScreen />);
    expect(screen.getByText("RK")).toBeTruthy();
    expect(screen.getByText("Ramesh Kadam")).toBeTruthy();
    expect(screen.getByText("PM-BHW-001")).toBeTruthy();
    expect(screen.getByText("B201 — Sector 3")).toBeTruthy();
    expect(screen.getByText("Bhandup West Post Office")).toBeTruthy();
  });

  it("lists Profile, Notifications, Offline Sync and App Information, then Log Out", () => {
    wrap(<AccountScreen />);
    for (const label of ["Profile", "Notifications", "Offline Sync", "App Information", "Log Out"]) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    fireEvent.press(screen.getByLabelText("Offline Sync"));
    expect(mockNavigate).toHaveBeenCalledWith("OfflineSync");
  });

  it("shows the profile picture the server returned", () => {
    profile("/uploads/profile/me.jpg");
    const { UNSAFE_getByType } = wrap(<AccountScreen />);
    expect(UNSAFE_getByType(Image).props.source.uri).toBe("http://localhost:4000/uploads/profile/me.jpg");
    expect(screen.queryByText("RK")).toBeNull();
  });
});

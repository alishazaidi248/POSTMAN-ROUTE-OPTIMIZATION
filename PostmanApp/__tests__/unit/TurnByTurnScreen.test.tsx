import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LocationFix } from "../../src/types/location";
import { makeDelivery } from "../_support/fixtures";
import { TurnByTurnScreen } from "../../src/screens/navigation/TurnByTurnScreen";
import { navigationApi } from "../../src/api/navigationApi";
import { openNavigation } from "../../src/utils/navigation";
import { Directions } from "../../src/types/navigation";

const mockGoBack = jest.fn();
const mockNavigate = jest.fn();
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useRoute: () => ({ params: { deliveryId: "d1" } }),
  useNavigation: () => ({ goBack: mockGoBack, navigate: mockNavigate, canGoBack: () => true })
}));
jest.mock("@react-native-async-storage/async-storage", () => jest.requireActual("@react-native-async-storage/async-storage/jest/async-storage-mock"));
jest.mock("react-native-safe-area-context", () => ({ ...jest.requireActual("react-native-safe-area-context/jest/mock").default }));
jest.mock("@maplibre/maplibre-react-native", () => ({
  Map: "Map", Camera: "Camera", Marker: "Marker", UserLocation: "UserLocation", GeoJSONSource: "GeoJSONSource", Layer: "Layer"
}));
jest.mock("../../src/api/navigationApi", () => ({ navigationApi: { getDirections: jest.fn() } }));
jest.mock("../../src/api/postmanApi", () => ({ postmanApi: { getProfile: jest.fn().mockResolvedValue({ postOffice: { proofMode: "NONE" } }) } }));
jest.mock("../../src/utils/navigation", () => ({ openNavigation: jest.fn().mockResolvedValue(true) }));
jest.mock("../../src/utils/alerts", () => ({ notify: jest.fn(), confirmAction: jest.fn().mockResolvedValue(true) }));
jest.mock("../../src/hooks/useKeepScreenOn", () => ({ useKeepScreenOn: jest.fn() }));
let mockFix: LocationFix | null = null;
jest.mock("../../src/hooks/useLocation", () => ({
  useLocation: () => ({ permission: "GRANTED", fix: mockFix, requestPermission: jest.fn() })
}));
const mockDelivery = makeDelivery("d1", "OUT_FOR_DELIVERY", { lat: 19.1476, lng: 72.93 });
jest.mock("../../src/hooks/useDeliveries", () => ({
  ...jest.requireActual("../../src/hooks/useDeliveries"),
  useDelivery: () => ({ data: mockDelivery, isLoading: false }),
  usePendingStatusOverrides: () => ({})
}));

const A: [number, number] = [72.93, 19.144];
const B: [number, number] = [72.93, 19.1476];
const DIRECTIONS: Directions = {
  mode: "BIKE",
  source: "ROAD",
  provider: "osrm",
  from: { latitude: A[1], longitude: A[0] },
  to: { latitude: B[1], longitude: B[0] },
  distanceMeters: 400,
  durationSeconds: 120,
  geometry: { type: "LineString", coordinates: [A, B] },
  steps: [
    { instruction: "Head north on Subhash Road", maneuverType: "depart", modifier: null, exit: null, streetName: "Subhash Road", distanceMeters: 400, durationSeconds: 120, location: A, geometry: [A, B] },
    { instruction: "Your destination is on the left", maneuverType: "arrive", modifier: "left", exit: null, streetName: "", distanceMeters: 0, durationSeconds: 0, location: B, geometry: [B, B] }
  ],
  warnings: []
};

const renderScreen = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <TurnByTurnScreen />
    </QueryClientProvider>
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockFix = { latitude: A[1], longitude: A[0], accuracy: 8, timestamp: 0 };
  (navigationApi.getDirections as jest.Mock).mockResolvedValue(DIRECTIONS);
});

it("shows the next manoeuvre, how far it is, and what to do until then", async () => {
  renderScreen();
  expect(await screen.findByText("Your destination is on the left")).toBeTruthy();
  expect(screen.getByText("400 m")).toBeTruthy();
  expect(screen.getByText("Now: Head north on Subhash Road")).toBeTruthy();
  expect(screen.getByText(/2 min/)).toBeTruthy();
});

it("keeps Google Maps one tap away", async () => {
  renderScreen();
  await screen.findByText("Your destination is on the left");
  fireEvent.press(screen.getByLabelText("Open in Google Maps"));
  await waitFor(() => expect(openNavigation).toHaveBeenCalledTimes(1));
  expect((openNavigation as jest.Mock).mock.calls[0][0]).toMatchObject({ latitude: B[1], longitude: B[0], label: "Recipient d1" });
});

it("End leaves navigation", async () => {
  renderScreen();
  await screen.findByText("Your destination is on the left");
  fireEvent.press(screen.getByLabelText("End navigation"));
  expect(mockGoBack).toHaveBeenCalled();
});

it("Cycle / Walk switches the directions", async () => {
  renderScreen();
  await screen.findByText("Your destination is on the left");
  fireEvent.press(screen.getByLabelText("Walk"));
  await waitFor(() => expect(navigationApi.getDirections).toHaveBeenLastCalledWith("d1", "FOOT", expect.anything()));
  fireEvent.press(screen.getByLabelText("Cycle"));
});

it("at the door: the delivery's own Mark Delivered, or 'Not here yet' to keep going", async () => {
  mockFix = { latitude: B[1] - 0.0001, longitude: B[0], accuracy: 8, timestamp: 0 };
  renderScreen();
  expect(await screen.findByText("You've arrived")).toBeTruthy();
  expect(screen.getByLabelText("Mark Delivered")).toBeTruthy();
  expect(screen.queryByLabelText("Navigate")).toBeNull();

  fireEvent.press(screen.getByLabelText("Not here yet"));
  expect(screen.queryByText("You've arrived")).toBeNull();
  expect(screen.getByLabelText("End navigation")).toBeTruthy();
});

it("when directions can't be loaded, says why and still offers Google Maps", async () => {
  (navigationApi.getDirections as jest.Mock).mockRejectedValue(new Error("This address is not on the map yet."));
  renderScreen();
  expect(await screen.findByText("This address is not on the map yet.")).toBeTruthy();
  expect(screen.getAllByLabelText("Open in Google Maps").length).toBeGreaterThan(0);
  expect(screen.getByLabelText("Try again")).toBeTruthy();
});

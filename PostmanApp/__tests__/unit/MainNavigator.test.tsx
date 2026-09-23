import React from "react";
import { render } from "@testing-library/react-native";
import { NavigationContainer } from "@react-navigation/native";
import { MainNavigator } from "../../src/navigation/MainNavigator";

/**
 * Reproduces the reported startup crash: Icon -> TabIcon -> MainNavigator, the exact render path a signed-in device
 * hits first (see RootNavigator.test.tsx for why MainNavigator, not Login, is what actually renders first for a
 * device with a cached session). Nothing here existed before - this render path had never been exercised by a test.
 */
jest.mock("react-native-safe-area-context", () => ({ ...jest.requireActual("react-native-safe-area-context/jest/mock").default }));
jest.mock("@react-native-async-storage/async-storage", () => jest.requireActual("@react-native-async-storage/async-storage/jest/async-storage-mock"));
// @maplibre/maplibre-react-native touches a real native TurboModule at import time (not just when rendered), which
// Jest's test environment has no native binary to satisfy - MapScreen is statically imported by MainNavigator
// regardless of which tab is focused, so this needs a stub even though the Map tab itself is never mounted here.
jest.mock("@maplibre/maplibre-react-native", () => ({
  Map: "Map", Camera: "Camera", Marker: "Marker", UserLocation: "UserLocation"
}));
jest.mock("../../src/hooks/usePushRegistration", () => ({ usePushRegistration: jest.fn() }));
jest.mock("../../src/hooks/useRefreshStaleOnFocus", () => ({ useRefreshStaleOnFocus: jest.fn() }));
jest.mock("../../src/hooks/useOfflineSync", () => ({
  useOfflineSync: () => ({ isOnline: true, queueLength: 0, conflicts: [], clearConflict: jest.fn(), sync: jest.fn() })
}));
jest.mock("../../src/hooks/usePostmanProfile", () => ({
  usePostmanProfile: () => ({ isLoading: true, isError: false, data: undefined, refetch: jest.fn() })
}));
jest.mock("../../src/hooks/useDeliveries", () => ({
  ...jest.requireActual("../../src/hooks/useDeliveries"),
  useDeliveryStats: () => ({ isLoading: true, data: undefined })
}));
jest.mock("../../src/screens/map/useMapScreenData", () => ({ useMapScreenData: () => ({ isLoading: true }) }));

it("renders the tab bar - where every Icon/Svg mounts at once - without throwing", () => {
  expect(() => render(<NavigationContainer><MainNavigator /></NavigationContainer>)).not.toThrow();
});

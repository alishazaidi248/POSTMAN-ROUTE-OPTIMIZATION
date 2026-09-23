import React from "react";
import { render } from "@testing-library/react-native";
import { RootNavigator } from "../../src/navigation/RootNavigator";

/**
 * The exact path in the reported crash trace: RootNavigator renders MainNavigator (not Login) when the auth store is
 * already "signedIn" - which is what happens on a real device with a cached session, per authStore.hydrate()'s
 * intentional offline-first restore. This is not an auth-gating bug (see RootNavigator.tsx: loading is checked
 * first, MainNavigator only renders once status is genuinely "signedIn"); it does mean MainNavigator, not Login, is
 * the FIRST place any Icon/Svg ever mounts on such a device - see MainNavigator.test.tsx for that render path.
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
jest.mock("../../src/hooks/useAuth", () => ({
  useAuth: () => ({ status: "signedIn", user: { mustChangePassword: false }, error: null, login: jest.fn(), logout: jest.fn() })
}));

it("a signed-in session renders MainNavigator (not Login) without throwing", () => {
  expect(() => render(<RootNavigator />)).not.toThrow();
});

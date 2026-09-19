import * as Location from "expo-location";
import { LocationFix, LocationPermissionState, TrackingMode } from "../types/location";

// spec §13: different cadence for an active route vs idle, so we're not
// draining battery or hammering the backend when the postman isn't moving
// through deliveries.
const INTERVAL_MS: Record<TrackingMode, number> = {
  ACTIVE_ROUTE: 30_000,
  IDLE: 120_000
};
const DISTANCE_INTERVAL_M: Record<TrackingMode, number> = {
  ACTIVE_ROUTE: 25,
  IDLE: 100
};

export async function getPermissionState(): Promise<LocationPermissionState> {
  const servicesEnabled = await Location.hasServicesEnabledAsync();
  if (!servicesEnabled) return "GPS_DISABLED";

  const { status, canAskAgain } = await Location.getForegroundPermissionsAsync();
  if (status === Location.PermissionStatus.GRANTED) return "GRANTED";
  if (status === Location.PermissionStatus.DENIED && !canAskAgain) return "PERMANENTLY_DENIED";
  return status === Location.PermissionStatus.DENIED ? "DENIED" : "UNKNOWN";
}

export async function requestPermission(): Promise<LocationPermissionState> {
  const { status, canAskAgain } = await Location.requestForegroundPermissionsAsync();
  if (status === Location.PermissionStatus.GRANTED) return "GRANTED";
  return canAskAgain ? "DENIED" : "PERMANENTLY_DENIED";
}

export async function getCurrentFix(): Promise<LocationFix | null> {
  const permission = await getPermissionState();
  if (permission !== "GRANTED") return null;

  try {
    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
      timestamp: position.timestamp
    };
  } catch {
    return null;
  }
}

export function watchPosition(
  mode: TrackingMode,
  onUpdate: (fix: LocationFix) => void
): Promise<Location.LocationSubscription> {
  return Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: INTERVAL_MS[mode],
      distanceInterval: DISTANCE_INTERVAL_M[mode]
    },
    (position) =>
      onUpdate({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        timestamp: position.timestamp
      })
  );
}

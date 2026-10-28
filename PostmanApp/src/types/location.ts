export interface LocationFix {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  timestamp: number;
  /** Direction of travel in degrees from north, when the device knows it (moving). */
  heading?: number | null;
  /** Metres per second, when the device knows it. */
  speed?: number | null;
}

export interface LocationPingRequest {
  latitude: number;
  longitude: number;
  batteryPct?: number;
  isMock?: boolean;
}

export type LocationPermissionState =
  | "UNKNOWN"
  | "GRANTED"
  | "DENIED"
  | "PERMANENTLY_DENIED"
  | "GPS_DISABLED";

/** NAVIGATING: turn-by-turn guidance is on screen - fixes every second, at the cost of battery, only while it is open. */
export type TrackingMode = "ACTIVE_ROUTE" | "IDLE" | "NAVIGATING";

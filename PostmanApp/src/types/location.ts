export interface LocationFix {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  timestamp: number;
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

export type TrackingMode = "ACTIVE_ROUTE" | "IDLE";

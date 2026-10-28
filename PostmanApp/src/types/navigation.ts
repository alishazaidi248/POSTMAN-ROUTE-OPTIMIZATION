import { RouteGeometry } from "./route";

/** How the postman is travelling: decides which paths the directions may use (cycle lanes vs footpaths, one-ways). */
export type TravelMode = "BIKE" | "FOOT";

/** One manoeuvre and the stretch after it, as GET /me/navigation/:deliveryId returns it. */
export interface NavigationStep {
  instruction: string;
  maneuverType: string;
  modifier: string | null;
  exit: number | null;
  streetName: string;
  distanceMeters: number;
  durationSeconds: number;
  /** [longitude, latitude] of the manoeuvre. */
  location: [number, number];
  /** [longitude, latitude] pairs of the stretch, starting at `location`. */
  geometry: [number, number][];
}

export interface Directions {
  mode: TravelMode;
  /** ROAD: along streets. STRAIGHT_LINE: no routing answer - a direct line and a compass heading only. */
  source: "ROAD" | "STRAIGHT_LINE";
  provider: string;
  from: { latitude: number; longitude: number };
  to: { latitude: number; longitude: number };
  distanceMeters: number;
  durationSeconds: number;
  geometry: RouteGeometry;
  steps: NavigationStep[];
  warnings: string[];
}

import axios from "axios";
import { env } from "../../config/env";
import { logger } from "../../config/logger";
import { LatLng, RouteGeometry } from "../optimization/OptimizationService";
import { haversineMeters } from "../optimization/routing";

/**
 * Turn-by-turn directions from where the postman is to one delivery, for the app's own navigation screen.
 * Separate from the route optimizer: that plans the ORDER of the round; this guides one leg of it, street by street,
 * for a bicycle or on foot.
 */

export type TravelMode = "BIKE" | "FOOT";

export interface NavigationStep {
  /** Plain words for the manoeuvre at the START of this step ("Turn left onto LBS Marg"). */
  instruction: string;
  maneuverType: string;
  modifier: string | null;
  /** Roundabout exit number, when there is one. */
  exit: number | null;
  streetName: string;
  /** Length of the stretch AFTER the manoeuvre, up to the next one. */
  distanceMeters: number;
  durationSeconds: number;
  /** Where the manoeuvre happens, [longitude, latitude]. */
  location: [number, number];
  /** The stretch itself, [longitude, latitude] pairs, starting at `location`. */
  geometry: [number, number][];
}

export interface Directions {
  mode: TravelMode;
  /** ROAD: a real path along streets. STRAIGHT_LINE: no routing engine answered; a direct line and a compass heading. */
  source: "ROAD" | "STRAIGHT_LINE";
  provider: string;
  from: LatLng;
  to: LatLng;
  distanceMeters: number;
  durationSeconds: number;
  geometry: RouteGeometry;
  steps: NavigationStep[];
  warnings: string[];
}

type HttpGet = (url: string, timeoutMs: number) => Promise<unknown>;

const defaultHttpGet: HttpGet = async (url, timeoutMs) => {
  // The public OSM routing servers ask callers to identify themselves.
  const response = await axios.get(url, { timeout: timeoutMs, headers: { "User-Agent": env.nominatimUserAgent } });
  return response.data;
};

/** Used only for the straight-line fallback's time estimate. */
const FALLBACK_SPEED_MPS: Record<TravelMode, number> = { BIKE: 14 / 3.6, FOOT: 4.5 / 3.6 };

const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];

export function compassDirection(bearingDegrees: number): string {
  const normalized = ((bearingDegrees % 360) + 360) % 360;
  return COMPASS[Math.round(normalized / 45) % 8];
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}

const TURN_PHRASE: Record<string, string> = {
  uturn: "Make a U-turn",
  "sharp right": "Turn sharp right",
  right: "Turn right",
  "slight right": "Bear right",
  straight: "Continue straight",
  "slight left": "Bear left",
  left: "Turn left",
  "sharp left": "Turn sharp left"
};

const side = (modifier: string | null) => (modifier?.includes("left") ? "left" : modifier?.includes("right") ? "right" : null);

interface ManeuverInput {
  type: string;
  modifier?: string | null;
  exit?: number | null;
  bearingAfter?: number;
  streetName?: string;
}

/**
 * One OSRM manoeuvre in plain words. Many lanes in the beat have no name in OpenStreetMap, so "onto <street>" is only
 * added when there is one - never "onto ''".
 */
export function describeManeuver({ type, modifier = null, exit = null, bearingAfter = 0, streetName = "" }: ManeuverInput): string {
  const onto = streetName ? ` onto ${streetName}` : "";
  const turn = TURN_PHRASE[modifier ?? ""] ?? "Continue";

  switch (type) {
    case "depart":
      return `Head ${compassDirection(bearingAfter)}${streetName ? ` on ${streetName}` : ""}`;
    case "arrive": {
      const s = side(modifier);
      return s ? `Your destination is on the ${s}` : "You have arrived";
    }
    case "roundabout":
    case "rotary":
      return exit ? `At the roundabout, take the ${ordinal(exit)} exit${onto}` : `Go through the roundabout${onto}`;
    case "roundabout turn":
      return `At the roundabout, ${turn.charAt(0).toLowerCase()}${turn.slice(1)}${onto}`;
    case "exit roundabout":
    case "exit rotary":
      return `Exit the roundabout${onto}`;
    case "fork": {
      const s = side(modifier);
      return s ? `Keep ${s} at the fork${onto}` : `Continue at the fork${onto}`;
    }
    case "end of road":
      return `At the end of the road, ${turn.charAt(0).toLowerCase()}${turn.slice(1)}${onto}`;
    case "merge": {
      const s = side(modifier);
      return s ? `Merge ${s}${onto}` : `Merge${onto}`;
    }
    case "new name":
    case "continue":
      if (!modifier || modifier === "straight") return streetName ? `Continue onto ${streetName}` : "Continue straight";
      return `${turn}${onto}`;
    case "turn":
    case "on ramp":
    case "off ramp":
      return `${turn}${onto}`;
    default:
      return streetName ? `Continue onto ${streetName}` : "Continue";
  }
}

interface OsrmStep {
  distance: number;
  duration: number;
  name?: string;
  geometry: { coordinates: [number, number][] };
  maneuver: { type: string; modifier?: string; exit?: number; bearing_after?: number; location: [number, number] };
}

interface OsrmRouteBody {
  code?: string;
  routes?: { distance: number; duration: number; geometry: RouteGeometry; legs: { steps: OsrmStep[] }[] }[];
}

function routeUrlFor(mode: TravelMode, urls: { bike: string; foot: string; fallback: string }): { url: string; warning?: string } {
  const own = mode === "BIKE" ? urls.bike : urls.foot;
  if (own) return { url: own };
  if (urls.fallback) {
    return {
      url: urls.fallback,
      warning: `${mode === "BIKE" ? "Cycling" : "Walking"} directions are not set up on the server, so these follow the road route for vehicles. One-way streets and footpaths may differ.`
    };
  }
  return { url: "" };
}

function straightLine(from: LatLng, to: LatLng, mode: TravelMode, warning: string): Directions {
  const distance = haversineMeters(from, to);
  const toRad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(to.longitude - from.longitude)) * Math.cos(toRad(to.latitude));
  const x =
    Math.cos(toRad(from.latitude)) * Math.sin(toRad(to.latitude)) -
    Math.sin(toRad(from.latitude)) * Math.cos(toRad(to.latitude)) * Math.cos(toRad(to.longitude - from.longitude));
  const bearing = (Math.atan2(y, x) * 180) / Math.PI;
  const start: [number, number] = [from.longitude, from.latitude];
  const end: [number, number] = [to.longitude, to.latitude];
  const duration = distance / FALLBACK_SPEED_MPS[mode];

  return {
    mode,
    source: "STRAIGHT_LINE",
    provider: "estimate",
    from,
    to,
    distanceMeters: distance,
    durationSeconds: duration,
    geometry: { type: "LineString", coordinates: [start, end] },
    steps: [
      {
        instruction: `Head ${compassDirection(bearing)} towards the delivery`,
        maneuverType: "depart",
        modifier: null,
        exit: null,
        streetName: "",
        distanceMeters: distance,
        durationSeconds: duration,
        location: start,
        geometry: [start, end]
      },
      {
        instruction: "You have arrived",
        maneuverType: "arrive",
        modifier: null,
        exit: null,
        streetName: "",
        distanceMeters: 0,
        durationSeconds: 0,
        location: end,
        geometry: [end]
      }
    ],
    warnings: [warning]
  };
}

export async function getDirections(
  from: LatLng,
  to: LatLng,
  mode: TravelMode,
  options: { httpGet?: HttpGet; urls?: { bike: string; foot: string; fallback: string }; timeoutMs?: number } = {}
): Promise<Directions> {
  const urls = options.urls ?? {
    bike: env.navigationBikeRouteUrl,
    foot: env.navigationFootRouteUrl,
    fallback: env.osrmBaseUrl ? `${env.osrmBaseUrl}/route/v1/${env.osrmProfile}` : ""
  };
  const { url: base, warning } = routeUrlFor(mode, urls);
  if (!base) return straightLine(from, to, mode, "Street directions are not available - showing the direct line to the delivery.");

  const url = `${base}/${from.longitude},${from.latitude};${to.longitude},${to.latitude}?overview=full&geometries=geojson&steps=true`;
  try {
    const body = (await (options.httpGet ?? defaultHttpGet)(url, options.timeoutMs ?? env.osrmTimeoutMs)) as OsrmRouteBody;
    const route = body.routes?.[0];
    if (body.code !== "Ok" || !route) throw new Error(`routing engine returned ${body.code ?? "no route"}`);

    const steps: NavigationStep[] = route.legs.flatMap((leg) =>
      leg.steps.map((s) => {
        const streetName = s.name ?? "";
        return {
          instruction: describeManeuver({
            type: s.maneuver.type,
            modifier: s.maneuver.modifier ?? null,
            exit: s.maneuver.exit ?? null,
            bearingAfter: s.maneuver.bearing_after ?? 0,
            streetName
          }),
          maneuverType: s.maneuver.type,
          modifier: s.maneuver.modifier ?? null,
          exit: s.maneuver.exit ?? null,
          streetName,
          distanceMeters: s.distance,
          durationSeconds: s.duration,
          location: s.maneuver.location,
          geometry: s.geometry.coordinates
        };
      })
    );

    return {
      mode,
      source: "ROAD",
      provider: "osrm",
      from,
      to,
      distanceMeters: route.distance,
      durationSeconds: route.duration,
      geometry: route.geometry,
      steps,
      warnings: warning ? [warning] : []
    };
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), mode }, "directions request failed; using a straight line");
    return straightLine(from, to, mode, "Street directions could not be loaded - showing the direct line to the delivery.");
  }
}

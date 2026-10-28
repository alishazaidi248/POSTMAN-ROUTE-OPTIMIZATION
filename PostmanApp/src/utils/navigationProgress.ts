import { Directions, NavigationStep } from "../types/navigation";

/**
 * Where the postman is along their directions, worked out from one GPS fix: the stretch they are on, the next
 * manoeuvre and how far off it is, what is left, whether they have strayed from the route and whether they have
 * arrived. Pure (no React, no device APIs) so every rule here is unit-tested with made-up GPS tracks.
 *
 * Distances use a flat local projection around the start of the route. Over the few kilometres of one leg of a
 * delivery round that is accurate to well under a metre, far below GPS noise.
 */

type LngLat = [number, number];

/** Within this distance of the delivery the postman has arrived (phone GPS in a lane is rarely better than ~10-20 m). */
export const ARRIVAL_RADIUS_M = 30;
/** Off the line by more than this (or 1.5x the fix's own accuracy, up to OFF_ROUTE_MAX_M) counts as off route. */
export const OFF_ROUTE_MIN_M = 35;
export const OFF_ROUTE_MAX_M = 80;
/** Movement along the route between two fixes that is never questioned. */
const FREE_MOVE_M = 30;
/** Beyond that, each metre of jump counts as this many metres of distance from the line. */
const JUMP_PENALTY_PER_M = 0.25;
/** Stretches within this much of the closest one are "the same spot" for the jump rule above. */
const AMBIGUOUS_WITHIN_M = 25;

export interface RouteModel {
  steps: NavigationStep[];
  /** The whole route as one line, built from the steps so step boundaries fall exactly on its vertices. */
  line: LngLat[];
  /** Metres from the start to each vertex of `line`. */
  cumulative: number[];
  /** Metres from the start to where each step's manoeuvre happens. */
  stepStarts: number[];
  totalMeters: number;
  totalSeconds: number;
  destination: LngLat;
  origin: { lng0: number; lat0: number; cosLat0: number };
}

export interface Progress {
  /** Metres travelled along the route (the fix snapped onto it). */
  alongMeters: number;
  /** How far the fix is from the route line. */
  offRouteMeters: number;
  segmentIndex: number;
  /** The stretch the postman is on now. */
  currentStepIndex: number;
  /** The manoeuvre coming up, or null once there is none left. */
  nextStepIndex: number | null;
  distanceToNextManeuverMeters: number;
  remainingMeters: number;
  remainingSeconds: number;
  arrived: boolean;
}

const M_PER_DEG_LAT = 110_540;
const M_PER_DEG_LNG = 111_320;

function toXY(p: LngLat, o: RouteModel["origin"]): [number, number] {
  return [(p[0] - o.lng0) * M_PER_DEG_LNG * o.cosLat0, (p[1] - o.lat0) * M_PER_DEG_LAT];
}

function dist(a: [number, number], b: [number, number]) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

export function buildRouteModel(directions: Directions): RouteModel {
  const firstPoint = directions.steps[0]?.location ?? directions.geometry.coordinates[0] ?? [directions.to.longitude, directions.to.latitude];
  const origin = { lng0: firstPoint[0], lat0: firstPoint[1], cosLat0: Math.cos((firstPoint[1] * Math.PI) / 180) };

  const line: LngLat[] = [];
  const stepStartIndex: number[] = [];
  for (const step of directions.steps) {
    const coords = step.geometry.length > 0 ? step.geometry : [step.location];
    const last = line[line.length - 1];
    const startsAtLast = last && last[0] === coords[0][0] && last[1] === coords[0][1];
    stepStartIndex.push(startsAtLast ? line.length - 1 : line.length);
    for (let i = startsAtLast ? 1 : 0; i < coords.length; i++) {
      const prev = line[line.length - 1];
      if (prev && prev[0] === coords[i][0] && prev[1] === coords[i][1]) continue;
      line.push(coords[i]);
    }
  }
  if (line.length === 0) line.push(...directions.geometry.coordinates);

  const cumulative = [0];
  for (let i = 1; i < line.length; i++) cumulative.push(cumulative[i - 1] + dist(toXY(line[i - 1], origin), toXY(line[i], origin)));
  const totalMeters = cumulative[cumulative.length - 1] ?? 0;

  return {
    steps: directions.steps,
    line,
    cumulative,
    stepStarts: stepStartIndex.map((i) => cumulative[Math.min(i, cumulative.length - 1)] ?? 0),
    totalMeters,
    totalSeconds: directions.durationSeconds,
    destination: [directions.to.longitude, directions.to.latitude],
    origin
  };
}

interface Snap {
  segmentIndex: number;
  along: number;
  distance: number;
}

function snapToSegment(model: RouteModel, p: [number, number], i: number): Snap {
  const a = toXY(model.line[i], model.origin);
  const b = toXY(model.line[i + 1], model.origin);
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  const q: [number, number] = [a[0] + t * dx, a[1] + t * dy];
  return { segmentIndex: i, along: model.cumulative[i] + t * Math.sqrt(len2), distance: dist(p, q) };
}

/**
 * @param previous the last progress, so a fix near a spot where the route passes twice (out and back along the same
 *   lane) stays on the stretch the postman is actually on instead of jumping to the other one.
 */
export function computeProgress(model: RouteModel, fix: { latitude: number; longitude: number }, previous?: Progress | null): Progress {
  const p = toXY([fix.longitude, fix.latitude], model.origin);
  const directToDestination = dist(p, toXY(model.destination, model.origin));

  let snap: Snap = { segmentIndex: 0, along: 0, distance: dist(p, toXY(model.line[0], model.origin)) };
  if (model.line.length >= 2) {
    const snaps: Snap[] = [];
    for (let i = 0; i < model.line.length - 1; i++) snaps.push(snapToSegment(model, p, i));
    // Where the route passes the same spot twice, both passes are about equally close; the postman is on the one
    // nearest (along the route) to where they were a moment ago. Only passes about as close as the closest are
    // weighed like that - a clearly closer stretch always wins, however far along the route it is (a GPS jump).
    const best = snaps.reduce((a, b) => (b.distance < a.distance ? b : a));
    const cost = (s: Snap) =>
      s.distance + (previous ? JUMP_PENALTY_PER_M * Math.max(0, Math.abs(s.along - previous.alongMeters) - FREE_MOVE_M) : 0);
    snap = snaps.filter((s) => s.distance <= best.distance + AMBIGUOUS_WITHIN_M).reduce((a, b) => (cost(b) < cost(a) ? b : a));
  }

  const arrived = directToDestination <= ARRIVAL_RADIUS_M || (model.totalMeters - snap.along <= ARRIVAL_RADIUS_M && snap.distance <= ARRIVAL_RADIUS_M);
  // At the door there is nothing left to do but arrive, wherever the last stretch of a winding route happens to snap.
  const along = arrived ? model.totalMeters : snap.along;
  const remainingMeters = Math.max(0, model.totalMeters - along);

  let currentStepIndex = 0;
  for (let i = 0; i < model.stepStarts.length; i++) {
    const isArrive = model.steps[i]?.maneuverType === "arrive";
    if (!isArrive && model.stepStarts[i] <= along + 0.5) currentStepIndex = i;
  }
  const nextStepIndex = currentStepIndex + 1 < model.steps.length ? currentStepIndex + 1 : null;
  const distanceToNextManeuverMeters = nextStepIndex === null ? 0 : Math.max(0, model.stepStarts[nextStepIndex] - along);

  return {
    alongMeters: along,
    offRouteMeters: snap.distance,
    segmentIndex: snap.segmentIndex,
    currentStepIndex,
    nextStepIndex,
    distanceToNextManeuverMeters,
    remainingMeters,
    remainingSeconds: model.totalMeters > 0 ? (remainingMeters / model.totalMeters) * model.totalSeconds : 0,
    arrived
  };
}

/** How far off the line counts as "off route" for a fix of this accuracy: a vague fix is given more room. */
export function offRouteThreshold(accuracyMeters: number | null | undefined): number {
  const fromAccuracy = (accuracyMeters ?? 0) * 1.5;
  return Math.min(OFF_ROUTE_MAX_M, Math.max(OFF_ROUTE_MIN_M, fromAccuracy));
}

export function isOffRoute(progress: Progress, accuracyMeters: number | null | undefined): boolean {
  return !progress.arrived && progress.offRouteMeters > offRouteThreshold(accuracyMeters);
}

/** "40 m", "120 m", "1.2 km" - rounded the way a person reads a distance at a glance. */
export function formatDistance(meters: number): string {
  const m = Math.max(0, meters);
  if (m < 50) return `${Math.round(m / 5) * 5} m`;
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

/** "under a minute", "7 min", "1 h 5 min". */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return "under a minute";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** An arrow for the manoeuvre, readable at arm's length on a moving bicycle. */
export function maneuverArrow(step: Pick<NavigationStep, "maneuverType" | "modifier"> | null | undefined): string {
  if (!step) return "↑";
  if (step.maneuverType === "arrive") return "◉";
  if (step.maneuverType.includes("roundabout") || step.maneuverType.includes("rotary")) return "⟳";
  switch (step.modifier) {
    case "uturn":
      return "↶";
    case "sharp left":
    case "left":
      return "↰";
    case "sharp right":
    case "right":
      return "↱";
    case "slight left":
      return "↖";
    case "slight right":
      return "↗";
    default:
      return "↑";
  }
}

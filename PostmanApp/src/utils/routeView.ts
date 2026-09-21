import { Delivery, DeliveryStatus } from "../types/delivery";
import { ActiveRouteResponse, GeometrySource, OptimizationStop, StartSource } from "../types/route";
import { findCoordinateProblems } from "./coordinates";
import { formatDistance } from "./distance";
import { formatDurationMinutes } from "./formatting";
import { classifyDeliveryStatus } from "./status";

/**
 * Pure view-model helpers that join the server's route (stop order, legs,
 * geometry) with the postman's delivery list and any offline-queued status
 * changes. Both tabs and both map renderers (native + web) build from these,
 * so the numbering, "next stop" and completed/pending styling can never
 * disagree between screens.
 */

/** Mirrors backend ROUTABLE_STATUSES: deliveries still "to do" on the round. */
export const ROUTABLE_STATUSES: DeliveryStatus[] = ["ASSIGNED", "OUT_FOR_DELIVERY", "RESCHEDULED"];

export function isRoutableStatus(status: DeliveryStatus): boolean {
  return ROUTABLE_STATUSES.includes(status);
}

export type StopState = "NEXT" | "PENDING" | "DONE" | "FAILED";

export interface StopView {
  /** The delivery as the server last reported it. */
  delivery: Delivery;
  /** Status to show: the server status, or the postman's queued (unsynced) change. */
  status: DeliveryStatus;
  /** True while a status change for this delivery is waiting in the offline queue. */
  queued: boolean;
  stop: OptimizationStop | null;
  /** Position on the current route (1-based), or null when not on the route. */
  sequence: number | null;
  state: StopState;
  latitude: number | null;
  longitude: number | null;
  legDistanceMeters: number | null;
  legDurationSeconds: number | null;
  eta: string | null;
}

function usableCoordinates(latitude: unknown, longitude: unknown): { latitude: number; longitude: number } | null {
  const problems = findCoordinateProblems(latitude, longitude).filter((p) => p !== "LIKELY_LAT_LNG_REVERSED");
  if (problems.length > 0) return null;
  return { latitude: Number(latitude), longitude: Number(longitude) };
}

/**
 * Orders deliveries the way the postman will do them:
 *   1. remaining deliveries on the route, in route order
 *   2. remaining deliveries not on the route (e.g. no coordinates)
 *   3. everything finished or failed
 * and marks the first remaining routed stop as NEXT.
 */
export function buildStopViews(
  deliveries: Delivery[],
  route: ActiveRouteResponse | null,
  pendingStatusById: Record<string, DeliveryStatus> = {}
): StopView[] {
  const stopByDelivery = new Map<string, OptimizationStop>();
  for (const stop of route?.solution.stops ?? []) stopByDelivery.set(stop.deliveryId, stop);

  const views: StopView[] = deliveries.map((delivery) => {
    const queuedStatus = pendingStatusById[delivery.id];
    const status = queuedStatus ?? delivery.status;
    const stop = stopByDelivery.get(delivery.id) ?? null;

    const coords = stop
      ? usableCoordinates(stop.latitude, stop.longitude)
      : usableCoordinates(delivery.address.latitude, delivery.address.longitude);

    const bucket = classifyDeliveryStatus(status);
    const state: StopState = bucket === "COMPLETED" ? "DONE" : bucket === "FAILED" ? "FAILED" : "PENDING";

    return {
      delivery,
      status,
      queued: queuedStatus !== undefined,
      stop,
      sequence: stop?.sequence ?? null,
      state,
      latitude: coords?.latitude ?? null,
      longitude: coords?.longitude ?? null,
      legDistanceMeters: stop?.distanceFromPreviousMeters ?? null,
      legDurationSeconds: stop?.travelTimeFromPreviousSeconds ?? null,
      eta: stop?.estimatedArrival || null
    };
  });

  const rank = (v: StopView): number => {
    if (v.state === "PENDING" && v.sequence !== null && isRoutableStatus(v.status)) return 0;
    if (v.state === "PENDING") return 1;
    return 2;
  };

  const ordered = views
    .map((v, index) => ({ v, index }))
    .sort((a, b) => {
      const ra = rank(a.v);
      const rb = rank(b.v);
      if (ra !== rb) return ra - rb;
      if (ra === 0) return (a.v.sequence as number) - (b.v.sequence as number);
      return a.index - b.index;
    })
    .map(({ v }) => v);

  const next = ordered.find((v) => rank(v) === 0);
  if (next) next.state = "NEXT";

  return ordered;
}

export function findNextStop(views: StopView[]): StopView | null {
  return views.find((v) => v.state === "NEXT") ?? null;
}

export function countRemaining(views: StopView[]): number {
  return views.filter((v) => v.state === "NEXT" || (v.state === "PENDING" && isRoutableStatus(v.status))).length;
}

/** "2.4 km · 5 min" for a stop's leg from the previous stop / your start, or null. */
export function legLabel(view: Pick<StopView, "legDistanceMeters" | "legDurationSeconds">): string | null {
  const parts: string[] = [];
  if (view.legDistanceMeters != null) parts.push(formatDistance(view.legDistanceMeters));
  if (view.legDurationSeconds != null) parts.push(formatDurationMinutes(Math.max(1, view.legDurationSeconds / 60)));
  return parts.length > 0 ? parts.join(" · ") : null;
}

// ── Map models ─────────────────────────────────────────────────────────────

export interface MarkerModel {
  deliveryId: string;
  latitude: number;
  longitude: number;
  /** What is printed inside the marker: the stop number, ✓ or ✕. */
  label: string;
  state: StopState;
  selected: boolean;
  title: string;
}

/**
 * One marker per delivery that has a usable coordinate. Pending stops carry
 * their route number; finished ones show ✓ and failed ones ✕ instead.
 */
export function buildMarkerModels(views: StopView[], selectedDeliveryId: string | null): MarkerModel[] {
  const models: MarkerModel[] = [];
  for (const v of views) {
    if (v.latitude === null || v.longitude === null) continue;
    const label = v.state === "DONE" ? "✓" : v.state === "FAILED" ? "✕" : v.sequence !== null ? String(v.sequence) : "•";
    models.push({
      deliveryId: v.delivery.id,
      latitude: v.latitude,
      longitude: v.longitude,
      label,
      state: v.state,
      selected: v.delivery.id === selectedDeliveryId,
      title: v.sequence !== null && v.state !== "DONE" && v.state !== "FAILED"
        ? `Stop ${v.sequence}: ${v.delivery.recipient.name}`
        : v.delivery.recipient.name
    });
  }
  return models;
}

export interface RouteLine {
  /** [longitude, latitude] pairs. */
  coordinates: [number, number][];
  source: GeometrySource;
}

/**
 * The line to draw. Road geometry from the backend when it has one; otherwise
 * a straight guide through start → stops, explicitly labelled STRAIGHT_LINE so
 * the UI can style it differently and never pass it off as a road path.
 */
export function buildRouteLine(route: ActiveRouteResponse | null): RouteLine | null {
  if (!route) return null;
  const { geometry, routing, start, stops } = route.solution;

  const clean = (coords: [number, number][]) =>
    coords.filter(([lng, lat]) => usableCoordinates(lat, lng) !== null);

  if (geometry && geometry.coordinates.length >= 2) {
    const coordinates = clean(geometry.coordinates);
    if (coordinates.length >= 2) return { coordinates, source: routing?.geometrySource ?? "STRAIGHT_LINE" };
  }

  const ordered = [...stops].sort((a, b) => a.sequence - b.sequence);
  const points: [number, number][] = [];
  if (start) points.push([start.longitude, start.latitude]);
  for (const s of ordered) points.push([s.longitude, s.latitude]);
  const coordinates = clean(points);
  return coordinates.length >= 2 ? { coordinates, source: "STRAIGHT_LINE" } : null;
}

export function startLabel(source: StartSource | undefined): string {
  switch (source) {
    case "REQUEST":
      return "Route start (your location)";
    case "POSTMAN_LOCATION":
      return "Route start (last known location)";
    case "POST_OFFICE":
      return "Route start (post office)";
    default:
      return "Route start";
  }
}

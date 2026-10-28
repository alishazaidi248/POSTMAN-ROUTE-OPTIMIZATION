import { haversineDistanceMeters } from "./distance";
import { StopView } from "./routeView";

export interface NearbyStop {
  view: StopView;
  /** Straight-line distance from the postman, or null when either position is unknown. */
  distanceMeters: number | null;
}

export interface NearestFirst {
  /** Still to do: the closest first. Without a GPS fix (or for stops with no map position) the route order is kept. */
  open: NearbyStop[];
  /** Delivered or failed today, in the order they come. */
  finished: StopView[];
  sortedByDistance: boolean;
}

/** Today's deliveries for the Home list: open ones nearest first, finished ones after. */
export function nearestFirst(views: StopView[], from: { latitude: number; longitude: number } | null): NearestFirst {
  const open: NearbyStop[] = [];
  const finished: StopView[] = [];
  for (const view of views) {
    if (view.state === "DONE" || view.state === "FAILED") {
      finished.push(view);
      continue;
    }
    const distanceMeters =
      from && view.latitude !== null && view.longitude !== null
        ? haversineDistanceMeters(from, { latitude: view.latitude, longitude: view.longitude })
        : null;
    open.push({ view, distanceMeters });
  }

  if (from) {
    // Stable: stops without a position keep their route order, after every stop that has one.
    open.sort((a, b) => (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity));
  }
  return { open, finished, sortedByDistance: from !== null };
}

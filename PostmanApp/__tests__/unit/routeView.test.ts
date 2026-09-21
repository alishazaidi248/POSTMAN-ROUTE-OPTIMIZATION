import {
  buildMarkerModels,
  buildRouteLine,
  buildStopViews,
  countRemaining,
  findNextStop,
  isRoutableStatus,
  legLabel,
  startLabel
} from "../../src/utils/routeView";
import { hasRoadGeometry } from "../../src/types/route";
import { makeDelivery, makeRoute, makeStop } from "../_support/fixtures";

describe("buildStopViews — ordering and numbering", () => {
  const a = makeDelivery("a");
  const b = makeDelivery("b");
  const c = makeDelivery("c");
  // Route order is c, a, b — deliberately NOT the list order a, b, c.
  const route = makeRoute([makeStop("c", 1), makeStop("a", 2), makeStop("b", 3)]);

  it("orders remaining deliveries by route sequence, not list/insertion order", () => {
    const views = buildStopViews([a, b, c], route);
    expect(views.map((v) => v.delivery.id)).toEqual(["c", "a", "b"]);
    expect(views.map((v) => v.sequence)).toEqual([1, 2, 3]);
  });

  it("marks exactly the first remaining routed stop as NEXT", () => {
    const views = buildStopViews([a, b, c], route);
    expect(views.map((v) => v.state)).toEqual(["NEXT", "PENDING", "PENDING"]);
    expect(findNextStop(views)?.delivery.id).toBe("c");
    expect(countRemaining(views)).toBe(3);
  });

  it("carries the per-leg distance, duration and ETA from the route", () => {
    const [first] = buildStopViews([a, b, c], route);
    expect(first.legDistanceMeters).toBe(1200);
    expect(first.legDurationSeconds).toBe(180);
    expect(first.eta).toBe("2026-09-20T08:10:00.000Z");
  });

  it("puts finished and failed deliveries after the remaining ones, un-numbered, and never NEXT", () => {
    const done = makeDelivery("done", "DELIVERED");
    const failed = makeDelivery("failed", "RECIPIENT_UNAVAILABLE");
    const views = buildStopViews([done, a, failed, b, c], route);

    expect(views.map((v) => v.delivery.id)).toEqual(["c", "a", "b", "done", "failed"]);
    const byId = Object.fromEntries(views.map((v) => [v.delivery.id, v]));
    expect(byId.done.state).toBe("DONE");
    expect(byId.done.sequence).toBeNull();
    expect(byId.failed.state).toBe("FAILED");
    expect(countRemaining(views)).toBe(3);
  });

  it("keeps a delivery that is not on the route (e.g. no coordinates) among the remaining, after routed ones", () => {
    const unrouted = makeDelivery("u", "ASSIGNED", { lat: null, lng: null });
    const views = buildStopViews([unrouted, a, c], makeRoute([makeStop("c", 1), makeStop("a", 2)]));
    expect(views.map((v) => v.delivery.id)).toEqual(["c", "a", "u"]);
    expect(views[2].sequence).toBeNull();
    expect(views[2].state).toBe("PENDING");
    expect(views[2].latitude).toBeNull();
  });

  it("without a route, shows deliveries in list order with no numbers and no NEXT", () => {
    const views = buildStopViews([a, b], null);
    expect(views.map((v) => v.sequence)).toEqual([null, null]);
    expect(findNextStop(views)).toBeNull();
    expect(views.every((v) => v.state === "PENDING")).toBe(true);
  });

  it("has no NEXT when nothing is left to do", () => {
    const views = buildStopViews([makeDelivery("x", "DELIVERED"), makeDelivery("y", "FAILED")], null);
    expect(findNextStop(views)).toBeNull();
    expect(countRemaining(views)).toBe(0);
  });

  it("rejects unusable coordinates instead of plotting them (null island, out of range)", () => {
    const bad = buildStopViews([makeDelivery("z", "ASSIGNED", { lat: 0, lng: 0 })], null)[0];
    expect(bad.latitude).toBeNull();
    const worse = buildStopViews([makeDelivery("z2", "ASSIGNED", { lat: 95, lng: 10 })], null)[0];
    expect(worse.longitude).toBeNull();
  });
});

describe("buildStopViews — completed deliveries and the route", () => {
  it("advances NEXT when a stop is delivered (the first stop is done → the second becomes NEXT)", () => {
    const route = makeRoute([makeStop("a", 1), makeStop("b", 2), makeStop("c", 3)]);
    const before = buildStopViews([makeDelivery("a"), makeDelivery("b"), makeDelivery("c")], route);
    expect(findNextStop(before)?.delivery.id).toBe("a");

    const after = buildStopViews([makeDelivery("a", "DELIVERED"), makeDelivery("b"), makeDelivery("c")], route);
    expect(findNextStop(after)?.delivery.id).toBe("b");
    expect(after.find((v) => v.delivery.id === "a")?.state).toBe("DONE");
  });

  it("only treats ASSIGNED, OUT_FOR_DELIVERY and RESCHEDULED as still on the round", () => {
    expect(isRoutableStatus("ASSIGNED")).toBe(true);
    expect(isRoutableStatus("OUT_FOR_DELIVERY")).toBe(true);
    expect(isRoutableStatus("RESCHEDULED")).toBe(true);
    for (const s of ["DELIVERED", "RETURNED", "CANCELLED", "FAILED", "RECIPIENT_UNAVAILABLE", "REJECTED"] as const) {
      expect(isRoutableStatus(s)).toBe(false);
    }
  });
});

describe("buildStopViews — offline (queued) status changes", () => {
  const route = makeRoute([makeStop("a", 1), makeStop("b", 2)]);

  it("shows the status the queue will apply, flagged as waiting to sync", () => {
    const views = buildStopViews([makeDelivery("a", "OUT_FOR_DELIVERY"), makeDelivery("b")], route, { a: "DELIVERED" });
    const a = views.find((v) => v.delivery.id === "a")!;
    expect(a.status).toBe("DELIVERED");
    expect(a.delivery.status).toBe("OUT_FOR_DELIVERY"); // server truth is untouched
    expect(a.queued).toBe(true);
    expect(a.state).toBe("DONE");
    expect(findNextStop(views)?.delivery.id).toBe("b");
  });

  it("does not flag deliveries without a queued change", () => {
    const views = buildStopViews([makeDelivery("a"), makeDelivery("b")], route, { a: "OUT_FOR_DELIVERY" });
    expect(views.find((v) => v.delivery.id === "b")?.queued).toBe(false);
  });
});

describe("buildMarkerModels", () => {
  const route = makeRoute([makeStop("a", 1), makeStop("b", 2)]);
  const views = buildStopViews([makeDelivery("a"), makeDelivery("b"), makeDelivery("d", "DELIVERED"), makeDelivery("f", "FAILED")], route);

  it("numbers pending stops with their route position and uses ✓ / ✕ for finished / failed ones", () => {
    const markers = buildMarkerModels(views, null);
    const label = (id: string) => markers.find((m) => m.deliveryId === id)?.label;
    expect(label("a")).toBe("1");
    expect(label("b")).toBe("2");
    expect(label("d")).toBe("✓");
    expect(label("f")).toBe("✕");
  });

  it("gives each marker its state so the map can colour the next stop, pending, done and failed differently", () => {
    const markers = buildMarkerModels(views, null);
    const state = (id: string) => markers.find((m) => m.deliveryId === id)?.state;
    expect(state("a")).toBe("NEXT");
    expect(state("b")).toBe("PENDING");
    expect(state("d")).toBe("DONE");
    expect(state("f")).toBe("FAILED");
  });

  it("highlights only the selected delivery", () => {
    const markers = buildMarkerModels(views, "b");
    expect(markers.filter((m) => m.selected).map((m) => m.deliveryId)).toEqual(["b"]);
  });

  it("skips deliveries with no usable coordinates and uses a dot when there is no route number", () => {
    const withBad = buildStopViews([makeDelivery("g", "ASSIGNED", { lat: null, lng: null }), makeDelivery("h")], null);
    const markers = buildMarkerModels(withBad, null);
    expect(markers.map((m) => m.deliveryId)).toEqual(["h"]);
    expect(markers[0].label).toBe("•");
  });

  it("titles pending stops with their number", () => {
    expect(buildMarkerModels(views, null).find((m) => m.deliveryId === "a")?.title).toBe("Stop 1: Recipient a");
  });
});

describe("buildRouteLine", () => {
  it("uses the server's road geometry and labels it ROAD", () => {
    const route = makeRoute([makeStop("a", 1)]);
    const line = buildRouteLine(route)!;
    expect(line.source).toBe("ROAD");
    expect(line.coordinates).toHaveLength(3);
    expect(hasRoadGeometry(route)).toBe(true);
  });

  it("labels an estimated line STRAIGHT_LINE so it is never presented as a road path", () => {
    const route = makeRoute([makeStop("a", 1)], {
      routing: { mode: "ESTIMATED", provider: "haversine-estimate", geometrySource: "STRAIGHT_LINE", warnings: ["x"] }
    });
    expect(buildRouteLine(route)?.source).toBe("STRAIGHT_LINE");
    expect(hasRoadGeometry(route)).toBe(false);
  });

  it("falls back to a start → stops guide for a route stored without geometry (older backend)", () => {
    const route = makeRoute([makeStop("b", 2), makeStop("a", 1)], { geometry: undefined, routing: undefined });
    const line = buildRouteLine(route)!;
    expect(line.source).toBe("STRAIGHT_LINE");
    // start, then stops in sequence order (a=1 before b=2)
    expect(line.coordinates[0]).toEqual([72.9345, 19.1436]);
    expect(line.coordinates[1][0]).toBeCloseTo(72.94, 6);
    expect(line.coordinates[1][1]).toBeCloseTo(19.15, 6);
    expect(line.coordinates[2][0]).toBeCloseTo(72.95, 6);
    expect(line.coordinates[2][1]).toBeCloseTo(19.16, 6);
  });

  it("drops invalid points and returns null when fewer than two remain", () => {
    const route = makeRoute([], {
      geometry: { type: "LineString", coordinates: [[72.9, 19.1], [0, 0]] },
      start: undefined
    });
    expect(buildRouteLine(route)).toBeNull();
    expect(buildRouteLine(null)).toBeNull();
  });
});

describe("labels", () => {
  it("formats a leg as distance · time", () => {
    expect(legLabel({ legDistanceMeters: 2400, legDurationSeconds: 300 })).toBe("2.4 km · 5m");
    expect(legLabel({ legDistanceMeters: 350, legDurationSeconds: null })).toBe("350 m");
    expect(legLabel({ legDistanceMeters: null, legDurationSeconds: null })).toBeNull();
  });

  it("says where the route starts from", () => {
    expect(startLabel("POST_OFFICE")).toMatch(/post office/i);
    expect(startLabel("REQUEST")).toMatch(/your location/i);
    expect(startLabel("POSTMAN_LOCATION")).toMatch(/last known/i);
  });
});

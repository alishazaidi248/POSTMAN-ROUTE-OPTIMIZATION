import { nearestFirst } from "../../src/utils/nearestFirst";
import { buildStopViews } from "../../src/utils/routeView";
import { makeDelivery, makeRoute, makeStop } from "../_support/fixtures";

// Route order a, b, c; but standing next to c, c is nearest, then b, then a.
const deliveries = [
  makeDelivery("a", "ASSIGNED", { lat: 19.1, lng: 72.9 }),
  makeDelivery("b", "OUT_FOR_DELIVERY", { lat: 19.13, lng: 72.9 }),
  makeDelivery("c", "ASSIGNED", { lat: 19.15, lng: 72.9 }),
  makeDelivery("done", "DELIVERED", { lat: 19.15, lng: 72.9 }),
  makeDelivery("nowhere", "ASSIGNED", { lat: null, lng: null })
];
// A stop's position on the map comes from the route stop, so those carry the coordinates here.
const views = buildStopViews(
  deliveries,
  makeRoute([
    makeStop("a", 1, { latitude: 19.1, longitude: 72.9 }),
    makeStop("b", 2, { latitude: 19.13, longitude: 72.9 }),
    makeStop("c", 3, { latitude: 19.15, longitude: 72.9 })
  ])
);
const ids = (list: { view: { delivery: { id: string } } }[]) => list.map((s) => s.view.delivery.id);

it("puts the closest open delivery first, and so on", () => {
  const r = nearestFirst(views, { latitude: 19.151, longitude: 72.9 });
  expect(r.sortedByDistance).toBe(true);
  expect(ids(r.open)).toEqual(["c", "b", "a", "nowhere"]);
  expect(Math.round(r.open[0].distanceMeters!)).toBe(111);
  expect(r.open[3].distanceMeters).toBeNull();
});

it("keeps finished deliveries out of the to-do list, after it", () => {
  const r = nearestFirst(views, { latitude: 19.151, longitude: 72.9 });
  expect(r.finished.map((v) => v.delivery.id)).toEqual(["done"]);
});

it("without a GPS fix, keeps the route order", () => {
  const r = nearestFirst(views, null);
  expect(r.sortedByDistance).toBe(false);
  expect(ids(r.open)).toEqual(["a", "b", "c", "nowhere"]);
  expect(r.open.every((s) => s.distanceMeters === null)).toBe(true);
});

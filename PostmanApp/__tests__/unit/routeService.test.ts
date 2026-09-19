import { findCurrentAndNext, hasDeviatedFromRoute } from "../../src/services/routeService";
import { OptimizationStop } from "../../src/types/route";

const stops: OptimizationStop[] = [
  { deliveryId: "d1", sequence: 1, latitude: 19.14, longitude: 72.93, estimatedArrival: "2026-09-19T09:00:00Z" },
  { deliveryId: "d2", sequence: 2, latitude: 19.145, longitude: 72.935, estimatedArrival: "2026-09-19T09:15:00Z" },
  { deliveryId: "d3", sequence: 3, latitude: 19.15, longitude: 72.94, estimatedArrival: "2026-09-19T09:30:00Z" }
];

describe("findCurrentAndNext", () => {
  it("returns the first two undelivered stops in sequence order when none are complete", () => {
    const { current, next } = findCurrentAndNext(stops, new Set());
    expect(current?.deliveryId).toBe("d1");
    expect(next?.deliveryId).toBe("d2");
  });

  it("skips completed deliveries regardless of original order", () => {
    const { current, next } = findCurrentAndNext(stops, new Set(["d1"]));
    expect(current?.deliveryId).toBe("d2");
    expect(next?.deliveryId).toBe("d3");
  });

  it("returns nulls when every stop is complete", () => {
    const { current, next } = findCurrentAndNext(stops, new Set(["d1", "d2", "d3"]));
    expect(current).toBeNull();
    expect(next).toBeNull();
  });
});

describe("hasDeviatedFromRoute", () => {
  const expectedStop = stops[0];

  it("is false when the postman is at the expected stop", () => {
    const fix = { latitude: 19.14, longitude: 72.93, accuracy: 10 };
    expect(hasDeviatedFromRoute(fix, expectedStop)).toBe(false);
  });

  it("is true when far away with a trustworthy GPS accuracy", () => {
    const fix = { latitude: 19.2, longitude: 73.0, accuracy: 10 };
    expect(hasDeviatedFromRoute(fix, expectedStop)).toBe(true);
  });
});

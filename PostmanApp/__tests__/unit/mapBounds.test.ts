import { computeBoundsForPoints, toCornerBounds, toFlatBounds } from "../../src/utils/mapBounds";

describe("computeBoundsForPoints", () => {
  it("returns null for an empty delivery list", () => {
    expect(computeBoundsForPoints([])).toBeNull();
  });

  it("pads a single point into a small non-zero-area box (single delivery case)", () => {
    const box = computeBoundsForPoints([[72.93, 19.14]]);
    expect(box).not.toBeNull();
    expect(box!.east).toBeGreaterThan(box!.west);
    expect(box!.north).toBeGreaterThan(box!.south);
    // Centered on the point.
    expect((box!.east + box!.west) / 2).toBeCloseTo(72.93, 5);
    expect((box!.north + box!.south) / 2).toBeCloseTo(19.14, 5);
  });

  it("spans exactly the min/max of multiple delivery points", () => {
    const points: [number, number][] = [
      [72.9, 19.1],
      [72.95, 19.2],
      [72.85, 19.05]
    ];
    const box = computeBoundsForPoints(points);
    expect(box).toEqual({ west: 72.85, east: 72.95, south: 19.05, north: 19.2 });
  });

  it("includes the current-location point when passed alongside delivery points", () => {
    const currentLocation: [number, number] = [73.0, 19.3];
    const deliveryPoint: [number, number] = [72.9, 19.1];
    const box = computeBoundsForPoints([deliveryPoint, currentLocation]);
    expect(box!.east).toBe(73.0);
    expect(box!.north).toBe(19.3);
  });
});

describe("bounds format conversions", () => {
  const box = { west: 72.85, south: 19.05, east: 72.95, north: 19.2 };

  it("toFlatBounds matches MapLibre RN's [west, south, east, north] tuple", () => {
    expect(toFlatBounds(box)).toEqual([72.85, 19.05, 72.95, 19.2]);
  });

  it("toCornerBounds matches maplibre-gl JS's [[west, south], [east, north]] shape", () => {
    expect(toCornerBounds(box)).toEqual([
      [72.85, 19.05],
      [72.95, 19.2]
    ]);
  });
});

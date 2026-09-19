import { formatDistance, haversineDistanceMeters, isMeaningfulDeviation } from "../../src/utils/distance";

describe("haversineDistanceMeters", () => {
  it("returns ~0 for identical points", () => {
    const p = { latitude: 19.1436, longitude: 72.9345 };
    expect(haversineDistanceMeters(p, p)).toBeLessThan(1);
  });

  it("returns a plausible distance for two known Mumbai points", () => {
    const a = { latitude: 19.1436, longitude: 72.9345 };
    const b = { latitude: 19.148, longitude: 72.93 };
    const distance = haversineDistanceMeters(a, b);
    expect(distance).toBeGreaterThan(400);
    expect(distance).toBeLessThan(900);
  });
});

describe("formatDistance", () => {
  it("formats sub-kilometer distances in meters", () => {
    expect(formatDistance(250)).toBe("250 m");
  });

  it("formats kilometer-scale distances with one decimal", () => {
    expect(formatDistance(2450)).toBe("2.5 km");
  });
});

describe("isMeaningfulDeviation", () => {
  const expected = { latitude: 19.1436, longitude: 72.9345 };

  it("is false for a nearby, accurate fix", () => {
    const nearby = { latitude: 19.1437, longitude: 72.9346, accuracy: 10 };
    expect(isMeaningfulDeviation(nearby, expected, 150)).toBe(false);
  });

  it("is true when far from the expected stop with good accuracy", () => {
    const far = { latitude: 19.16, longitude: 72.95, accuracy: 15 };
    expect(isMeaningfulDeviation(far, expected, 150)).toBe(true);
  });

  it("ignores a far reading when GPS accuracy itself is too poor to trust", () => {
    const far = { latitude: 19.16, longitude: 72.95, accuracy: 500 };
    expect(isMeaningfulDeviation(far, expected, 150)).toBe(false);
  });
});

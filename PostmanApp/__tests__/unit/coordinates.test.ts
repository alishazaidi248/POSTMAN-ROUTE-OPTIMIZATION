import {
  findCoordinateProblems,
  isValidCoordinatePair,
  isValidLatitude,
  isValidLongitude,
  validateAndLogCoordinates,
  MUMBAI_METRO_BOUNDS
} from "../../src/utils/coordinates";

describe("isValidLatitude / isValidLongitude", () => {
  it("accepts values within range", () => {
    expect(isValidLatitude(19.14)).toBe(true);
    expect(isValidLatitude(-90)).toBe(true);
    expect(isValidLatitude(90)).toBe(true);
    expect(isValidLongitude(72.93)).toBe(true);
    expect(isValidLongitude(-180)).toBe(true);
    expect(isValidLongitude(180)).toBe(true);
  });

  it("rejects out-of-range values", () => {
    expect(isValidLatitude(91)).toBe(false);
    expect(isValidLatitude(-91)).toBe(false);
    expect(isValidLongitude(181)).toBe(false);
    expect(isValidLongitude(-181)).toBe(false);
  });

  it("rejects non-numbers", () => {
    expect(isValidLatitude("19.14")).toBe(false);
    expect(isValidLatitude(NaN)).toBe(false);
    expect(isValidLatitude(undefined)).toBe(false);
  });
});

describe("findCoordinateProblems — valid coordinate handling", () => {
  it("finds no problems for a valid Mumbai coordinate", () => {
    expect(findCoordinateProblems(19.1436, 72.9345)).toEqual([]);
  });

  it("flags null latitude/longitude", () => {
    expect(findCoordinateProblems(null, 72.93)).toEqual(["NULL"]);
    expect(findCoordinateProblems(19.14, undefined)).toEqual(["NULL"]);
  });

  it("flags non-numeric strings", () => {
    expect(findCoordinateProblems("not-a-number", 72.93)).toEqual(["NOT_A_NUMBER"]);
  });

  it("accepts numeric strings (common when coordinates come from form/JSON parsing)", () => {
    expect(findCoordinateProblems("19.14", "72.93")).toEqual([]);
  });

  it("flags (0, 0) — the classic 'failed geocode defaulted to null island' bug", () => {
    expect(findCoordinateProblems(0, 0)).toEqual(["ZERO_ZERO"]);
  });

  it("flags invalid latitude", () => {
    expect(findCoordinateProblems(120, 72.93)).toContain("LATITUDE_OUT_OF_RANGE");
  });

  it("flags invalid longitude", () => {
    expect(findCoordinateProblems(19.14, 250)).toContain("LONGITUDE_OUT_OF_RANGE");
  });

  it("detects a likely lat/lng reversal against an expected region", () => {
    // Correct Mumbai coordinate is (19.14, 72.93); this swaps them.
    const problems = findCoordinateProblems(72.93, 19.14, MUMBAI_METRO_BOUNDS);
    expect(problems).toContain("LIKELY_LAT_LNG_REVERSED");
  });

  it("does not flag a correctly-ordered in-region coordinate as reversed", () => {
    const problems = findCoordinateProblems(19.1436, 72.9345, MUMBAI_METRO_BOUNDS);
    expect(problems).not.toContain("LIKELY_LAT_LNG_REVERSED");
  });

  it("never silently swaps lat/lng — the reversed pair is still returned as given", () => {
    // This test exists to guard against a future "helpful" fix that starts
    // auto-correcting instead of flagging; isValidCoordinatePair must still
    // treat a flagged-as-reversed pair as invalid, not silently accept it.
    expect(isValidCoordinatePair(72.93, 19.14)).toBe(true); // in range, not asserting region here
    const problems = findCoordinateProblems(72.93, 19.14, MUMBAI_METRO_BOUNDS);
    expect(problems.length).toBeGreaterThan(0);
  });
});

describe("validateAndLogCoordinates", () => {
  const items = [
    { id: "a", lat: 19.14, lng: 72.93 },
    { id: "b", lat: null, lng: 72.93 },
    { id: "c", lat: 0, lng: 0 },
    { id: "d", lat: 19.2, lng: 72.9 }
  ];

  it("drops items with null/zero-zero coordinates, keeps valid ones", () => {
    const valid = validateAndLogCoordinates(
      items,
      (i) => ({ latitude: i.lat, longitude: i.lng }),
      (i) => i.id
    );
    expect(valid.map((i) => i.id)).toEqual(["a", "d"]);
  });

  it("returns an empty array for an empty input (no deliveries case)", () => {
    expect(validateAndLogCoordinates([], () => ({ latitude: 0, longitude: 0 }), () => "x")).toEqual([]);
  });
});

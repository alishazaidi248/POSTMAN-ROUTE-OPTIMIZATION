import { describe, expect, it } from "vitest";
import { googlePrecision, nominatimPrecision, precisionFromSource } from "../src/services/geocoding/precision";
import { judgeSample, learnableKey, learnedQuality, representativePoint, distanceMeters } from "../src/services/addressing/locationLearning";

describe("geocode precision comes from what the provider says the match IS", () => {
  it("Nominatim: a house number or a building is HOUSE, a road is STREET, a suburb is AREA, a postcode is PINCODE", () => {
    expect(nominatimPrecision({ class: "building", type: "yes", addresstype: "building", address: { house_number: "21" } }, "full")).toBe("HOUSE");
    expect(nominatimPrecision({ class: "building", type: "apartments", addresstype: "building" }, "full")).toBe("HOUSE");
    expect(nominatimPrecision({ class: "highway", type: "residential", addresstype: "road" }, "full")).toBe("STREET");
    expect(nominatimPrecision({ class: "boundary", type: "administrative", addresstype: "suburb" }, "full")).toBe("AREA");
    expect(nominatimPrecision({ class: "place", type: "neighbourhood", addresstype: "neighbourhood" }, "full")).toBe("AREA");
    expect(nominatimPrecision({ class: "place", type: "postcode", addresstype: "postcode" }, "full")).toBe("PINCODE");
  });

  it("a fallback query tier caps the precision, whatever the match is called", () => {
    const house = { class: "building", type: "yes", addresstype: "building", address: { house_number: "1" } };
    expect(nominatimPrecision(house, "area")).toBe("AREA");
    expect(nominatimPrecision(house, "pincode")).toBe("PINCODE");
    expect(googlePrecision({ types: ["premise"], geometry: { location_type: "ROOFTOP" } }, "area")).toBe("AREA");
  });

  it("an unknown kind of match is treated as the weak AREA, never as precise", () => {
    expect(nominatimPrecision({}, "full")).toBe("AREA");
    expect(googlePrecision({}, "full")).toBe("AREA");
  });

  it("Google: ROOFTOP premise is HOUSE, interpolated / route is STREET, approximate locality is AREA, postal_code is PINCODE", () => {
    expect(googlePrecision({ types: ["premise"], geometry: { location_type: "ROOFTOP" } }, "full")).toBe("HOUSE");
    expect(googlePrecision({ types: ["street_address"], geometry: { location_type: "RANGE_INTERPOLATED" } }, "full")).toBe("STREET");
    expect(googlePrecision({ types: ["route"], geometry: { location_type: "GEOMETRIC_CENTER" } }, "full")).toBe("STREET");
    expect(googlePrecision({ types: ["sublocality", "political"], geometry: { location_type: "APPROXIMATE" } }, "full")).toBe("AREA");
    expect(googlePrecision({ types: ["postal_code"], geometry: { location_type: "APPROXIMATE" } }, "full")).toBe("PINCODE");
  });

  it("legacy rows are classified from their source tag conservatively", () => {
    expect(precisionFromSource("manual", "MANUAL")).toBe("HOUSE");
    expect(precisionFromSource("nominatim-pincode", "SUCCESS")).toBe("PINCODE");
    expect(precisionFromSource("nominatim-area", "SUCCESS")).toBe("AREA");
    expect(precisionFromSource("nominatim", "SUCCESS")).toBe("STREET"); // a full-address hit, but never assumed to be the house
    expect(precisionFromSource("nominatim", "FAILED")).toBe("NONE");
  });
});

describe("address learning", () => {
  const P = { latitude: 19.1487, longitude: 72.9366 };
  const near = (m: number) => ({ latitude: P.latitude + m / 111_000, longitude: P.longitude });

  it("only an address with a house / unit number and at least two words names one place", () => {
    expect(learnableKey(["21 Farid Nagar", "Bhandup West", "Mumbai"])).toBe("21 FARID NAGAR");
    expect(learnableKey(["Farid Nagar 21", "Bhandup (W)", "Mumbai 400078"])).toBe("21 FARID NAGAR"); // same key, any order
    expect(learnableKey(["Farid Nagar", "Bhandup West"])).toBeNull(); // a whole neighbourhood, not a place
    expect(learnableKey(["21", "Bhandup West"])).toBeNull();
    expect(learnableKey(["21 Farid Nagar"])).not.toBe(learnableKey(["22 Farid Nagar"]));
  });

  it("rejects a fix that does not state its accuracy, or states a poor one", () => {
    expect(judgeSample({ ...P }, { accepted: [] })).toMatchObject({ accepted: false });
    expect(judgeSample({ ...P, accuracyMeters: 120 }, { accepted: [] })).toMatchObject({ accepted: false });
    expect(judgeSample({ ...P, accuracyMeters: 12 }, { accepted: [] })).toEqual({ accepted: true });
  });

  it("rejects a fix far from where the address was geocoded (the postman was not there)", () => {
    const g = { ...P, precision: "STREET" as const };
    expect(judgeSample({ ...near(5000), accuracyMeters: 10 }, { geocode: g, accepted: [] })).toMatchObject({ accepted: false });
    expect(judgeSample({ ...near(200), accuracyMeters: 10 }, { geocode: g, accepted: [] })).toEqual({ accepted: true });
  });

  it("a weak geocode (area / pincode) is not used to judge a GPS fix", () => {
    expect(judgeSample({ ...near(5000), accuracyMeters: 10 }, { geocode: { ...P, precision: "AREA" }, accepted: [] })).toEqual({ accepted: true });
  });

  it("rejects an outlier against what was already learned, and the median resists a bad fix", () => {
    const learned = [near(0), near(10), near(20)];
    expect(judgeSample({ ...near(400), accuracyMeters: 10 }, { accepted: learned })).toMatchObject({ accepted: false });
    const rep = representativePoint([...learned, near(90)])!;
    expect(distanceMeters(rep, near(10))).toBeLessThan(20);
  });

  it("one sample is STREET quality; two agreeing samples are HOUSE quality; disagreeing ones are not", () => {
    expect(learnedQuality([near(0)]).precision).toBe("STREET");
    expect(learnedQuality([near(0), near(20)]).precision).toBe("HOUSE");
    expect(learnedQuality([near(0), near(140)]).precision).toBe("STREET");
    expect(learnedQuality([]).precision).toBe("NONE");
  });
});

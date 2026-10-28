import { describe, expect, it, vi } from "vitest";

vi.mock("../src/config/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { compassDirection, describeManeuver, getDirections } from "../src/services/navigation/directions.service";

const FROM = { latitude: 19.1498, longitude: 72.9268 };
const TO = { latitude: 19.1385, longitude: 72.9405 };
const URLS = { bike: "https://bike.example/route/v1/driving", foot: "https://foot.example/route/v1/driving", fallback: "https://car.example/route/v1/driving" };

const osrmBody = {
  code: "Ok",
  routes: [
    {
      distance: 520,
      duration: 140,
      geometry: { type: "LineString", coordinates: [[72.9268, 19.1498], [72.93, 19.15], [72.9405, 19.1385]] },
      legs: [
        {
          steps: [
            { distance: 300, duration: 80, name: "", geometry: { coordinates: [[72.9268, 19.1498], [72.93, 19.15]] }, maneuver: { type: "depart", bearing_after: 92, location: [72.9268, 19.1498] } },
            { distance: 220, duration: 60, name: "LBS Marg", geometry: { coordinates: [[72.93, 19.15], [72.9405, 19.1385]] }, maneuver: { type: "turn", modifier: "left", location: [72.93, 19.15] } },
            { distance: 0, duration: 0, name: "", geometry: { coordinates: [[72.9405, 19.1385]] }, maneuver: { type: "arrive", modifier: "right", location: [72.9405, 19.1385] } }
          ]
        }
      ]
    }
  ]
};

describe("describeManeuver - plain words for every OSRM manoeuvre", () => {
  it.each([
    [{ type: "depart", bearingAfter: 92 }, "Head east"],
    [{ type: "depart", bearingAfter: 0, streetName: "Station Road" }, "Head north on Station Road"],
    [{ type: "turn", modifier: "left", streetName: "LBS Marg" }, "Turn left onto LBS Marg"],
    [{ type: "turn", modifier: "slight right" }, "Bear right"],
    [{ type: "turn", modifier: "uturn" }, "Make a U-turn"],
    [{ type: "new name", modifier: "straight", streetName: "Tembhipada Road" }, "Continue onto Tembhipada Road"],
    [{ type: "continue", modifier: "straight" }, "Continue straight"],
    [{ type: "roundabout", exit: 2, streetName: "Jangal Mangal Road" }, "At the roundabout, take the 2nd exit onto Jangal Mangal Road"],
    [{ type: "rotary", exit: 3 }, "At the roundabout, take the 3rd exit"],
    [{ type: "fork", modifier: "slight left" }, "Keep left at the fork"],
    [{ type: "end of road", modifier: "right" }, "At the end of the road, turn right"],
    [{ type: "arrive", modifier: "left" }, "Your destination is on the left"],
    [{ type: "arrive" }, "You have arrived"]
  ])("%j -> %s", (input, expected) => {
    expect(describeManeuver(input)).toBe(expected);
  });

  it("never says 'onto' for an unnamed lane", () => {
    expect(describeManeuver({ type: "turn", modifier: "right", streetName: "" })).toBe("Turn right");
  });

  it("names compass directions for any bearing", () => {
    expect([0, 44, 46, 180, 359, -90].map(compassDirection)).toEqual(["north", "north-east", "north-east", "south", "north", "west"]);
  });
});

describe("getDirections", () => {
  it("asks the cycling server for a cycling route, and turns its steps into instructions", async () => {
    const httpGet = vi.fn().mockResolvedValue(osrmBody);
    const d = await getDirections(FROM, TO, "BIKE", { httpGet, urls: URLS });

    expect(httpGet.mock.calls[0][0]).toBe(
      "https://bike.example/route/v1/driving/72.9268,19.1498;72.9405,19.1385?overview=full&geometries=geojson&steps=true"
    );
    expect(d).toMatchObject({ mode: "BIKE", source: "ROAD", provider: "osrm", distanceMeters: 520, durationSeconds: 140, warnings: [] });
    expect(d.steps.map((s) => s.instruction)).toEqual(["Head east", "Turn left onto LBS Marg", "Your destination is on the right"]);
    expect(d.steps[1]).toMatchObject({ maneuverType: "turn", modifier: "left", streetName: "LBS Marg", location: [72.93, 19.15], distanceMeters: 220 });
  });

  it("uses the walking server on foot", async () => {
    const httpGet = vi.fn().mockResolvedValue(osrmBody);
    await getDirections(FROM, TO, "FOOT", { httpGet, urls: URLS });
    expect(httpGet.mock.calls[0][0]).toMatch(/^https:\/\/foot\.example\//);
  });

  it("falls back to the vehicle route, and says so, when no cycling server is configured", async () => {
    const httpGet = vi.fn().mockResolvedValue(osrmBody);
    const d = await getDirections(FROM, TO, "BIKE", { httpGet, urls: { ...URLS, bike: "" } });
    expect(httpGet.mock.calls[0][0]).toMatch(/^https:\/\/car\.example\//);
    expect(d.source).toBe("ROAD");
    expect(d.warnings[0]).toMatch(/Cycling directions are not set up/);
  });

  it("gives a straight line with a compass heading when the routing server fails - never an error", async () => {
    const httpGet = vi.fn().mockRejectedValue(new Error("timeout"));
    const d = await getDirections(FROM, TO, "FOOT", { httpGet, urls: URLS });
    expect(d.source).toBe("STRAIGHT_LINE");
    expect(d.steps[0].instruction).toBe("Head south-east towards the delivery");
    expect(d.steps.at(-1)!.maneuverType).toBe("arrive");
    expect(d.distanceMeters).toBeGreaterThan(1500);
    expect(d.durationSeconds).toBeCloseTo(d.distanceMeters / (4.5 / 3.6), 0);
    expect(d.warnings[0]).toMatch(/could not be loaded/);
  });

  it("treats a non-Ok answer (e.g. NoRoute) as a failure, not a route", async () => {
    const d = await getDirections(FROM, TO, "BIKE", { httpGet: vi.fn().mockResolvedValue({ code: "NoRoute" }), urls: URLS });
    expect(d.source).toBe("STRAIGHT_LINE");
  });

  it("gives a straight line when nothing at all is configured, without calling out", async () => {
    const httpGet = vi.fn();
    const d = await getDirections(FROM, TO, "BIKE", { httpGet, urls: { bike: "", foot: "", fallback: "" } });
    expect(httpGet).not.toHaveBeenCalled();
    expect(d.source).toBe("STRAIGHT_LINE");
    expect(d.warnings[0]).toMatch(/not available/);
  });
});

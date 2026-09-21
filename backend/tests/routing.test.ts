import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/config/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

import {
  ESTIMATE_DETOUR_FACTOR,
  RoutingService,
  TravelPairCache,
  estimateMatrix,
  haversineMeters
} from "../src/services/optimization/routing";

const A = { latitude: 19.14, longitude: 72.93 };
const B = { latitude: 19.15, longitude: 72.94 };
const C = { latitude: 19.16, longitude: 72.95 };

/** A tiny fake OSRM: 100 m per degree-step, symmetric, 10 m/s. */
function fakeOsrm() {
  const calls: string[] = [];
  const httpGet = vi.fn(async (url: string) => {
    calls.push(url);
    const coordPart = url.split("/").pop()!.split("?")[0];
    const pts = coordPart.split(";").map((c) => c.split(",").map(Number) as [number, number]);
    if (url.includes("/table/")) {
      const d = pts.map(([lo1, la1]) =>
        pts.map(([lo2, la2]) => haversineMeters({ latitude: la1, longitude: lo1 }, { latitude: la2, longitude: lo2 }))
      );
      return { code: "Ok", distances: d, durations: d.map((row) => row.map((m) => m / 10)) };
    }
    return {
      code: "Ok",
      routes: [
        {
          distance: 1000 * (pts.length - 1),
          duration: 100 * (pts.length - 1),
          geometry: { type: "LineString", coordinates: pts }
        }
      ]
    };
  });
  return { httpGet, calls };
}

describe("RoutingService — not configured", () => {
  it("returns a straight-line ESTIMATED matrix with an explicit warning", async () => {
    const svc = new RoutingService({ baseUrl: "" });
    const m = await svc.getMatrix([A, B]);

    expect(svc.isConfigured).toBe(false);
    expect(m.mode).toBe("ESTIMATED");
    expect(m.provider).toBe("haversine-estimate");
    expect(m.warnings[0]).toMatch(/not configured/i);
    expect(m.distances[0][1]).toBeCloseTo(haversineMeters(A, B) * ESTIMATE_DETOUR_FACTOR, 6);
    expect(m.durations[0][1]).toBeGreaterThan(0);
    expect(m.durations[0][0]).toBe(0);
  });

  it("never claims road geometry", async () => {
    expect(await new RoutingService({ baseUrl: "" }).getRoadRoute([A, B])).toBeNull();
  });
});

describe("RoutingService — OSRM", () => {
  it("reads road durations and distances from /table and marks the matrix ROAD", async () => {
    const { httpGet, calls } = fakeOsrm();
    const svc = new RoutingService({ baseUrl: "http://osrm.test/", httpGet });

    const m = await svc.getMatrix([A, B, C]);

    expect(m.mode).toBe("ROAD");
    expect(m.provider).toBe("osrm");
    expect(m.warnings).toEqual([]);
    expect(m.distances[0][1]).toBeCloseTo(haversineMeters(A, B), 6);
    expect(m.durations[0][1]).toBeCloseTo(haversineMeters(A, B) / 10, 6);
    expect(calls).toHaveLength(1);
    // OSRM wants lon,lat and the base URL's trailing slash is normalised away.
    expect(calls[0]).toContain("http://osrm.test/table/v1/driving/72.93,19.14;72.94,19.15;72.95,19.16");
  });

  it("caches pairs so re-planning a subset of known points makes no new request", async () => {
    const { httpGet } = fakeOsrm();
    const svc = new RoutingService({ baseUrl: "http://osrm.test", httpGet });

    await svc.getMatrix([A, B, C]);
    expect(httpGet).toHaveBeenCalledTimes(1);

    // Same start, one stop delivered: every remaining pair is already cached.
    const subset = await svc.getMatrix([A, C]);
    expect(httpGet).toHaveBeenCalledTimes(1);
    expect(subset.provider).toBe("osrm-cache");
    expect(subset.mode).toBe("ROAD");

    // A genuinely new point needs one request again.
    await svc.getMatrix([A, B, { latitude: 19.2, longitude: 73 }]);
    expect(httpGet).toHaveBeenCalledTimes(2);
  });

  it("expires cached pairs after the TTL", async () => {
    const { httpGet } = fakeOsrm();
    let now = 1_000;
    const cache = new TravelPairCache(1000, 10, 60_000, () => now);
    const svc = new RoutingService({ baseUrl: "http://osrm.test", httpGet, cache });

    await svc.getMatrix([A, B]);
    now += 30_000;
    await svc.getMatrix([A, B]);
    expect(httpGet).toHaveBeenCalledTimes(1);
    now += 40_000; // 70s > 60s TTL
    await svc.getMatrix([A, B]);
    expect(httpGet).toHaveBeenCalledTimes(2);
  });

  it("falls back to estimates, flagged, when OSRM errors or times out", async () => {
    const httpGet = vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED"));
    const svc = new RoutingService({ baseUrl: "http://osrm.test", httpGet });

    const m = await svc.getMatrix([A, B]);

    expect(m.mode).toBe("ESTIMATED");
    expect(m.warnings[0]).toMatch(/unavailable/i);
    expect(m.warnings[0]).toMatch(/ECONNREFUSED/);
    expect(m.durations[0][1]).toBeGreaterThan(0);
  });

  it("falls back when OSRM answers with a non-Ok code", async () => {
    const httpGet = vi.fn().mockResolvedValue({ code: "InvalidQuery" });
    const svc = new RoutingService({ baseUrl: "http://osrm.test", httpGet });
    expect((await svc.getMatrix([A, B])).mode).toBe("ESTIMATED");
  });

  it("estimates only the legs OSRM could not connect and still reports ROAD", async () => {
    const httpGet = vi.fn().mockResolvedValue({
      code: "Ok",
      durations: [
        [0, 50],
        [null, 0]
      ],
      distances: [
        [0, 500],
        [null, 0]
      ]
    });
    const svc = new RoutingService({ baseUrl: "http://osrm.test", httpGet });

    const m = await svc.getMatrix([A, B]);

    expect(m.mode).toBe("ROAD");
    expect(m.durations[0][1]).toBe(50);
    expect(m.distances[1][0]).toBeCloseTo(haversineMeters(B, A) * ESTIMATE_DETOUR_FACTOR, 6);
    expect(m.warnings[0]).toMatch(/1 leg/);
  });

  it("splits an oversized matrix into requests that each fit the limit (see optimizationProof.test.ts for the values)", async () => {
    const seen: number[] = [];
    const httpGet = vi.fn(async (url: string) => {
      const coords = url.split("/").pop()!.split("?")[0].split(";").length;
      seen.push(coords);
      throw new Error("engine down");
    });
    const svc = new RoutingService({ baseUrl: "http://osrm.test", httpGet, maxTablePoints: 3 });
    const m = await svc.getMatrix([A, B, C, { latitude: 19.17, longitude: 72.96 }]);
    expect(seen.length).toBeGreaterThan(0);
    expect(Math.max(...seen)).toBeLessThanOrEqual(3); // never a request bigger than the limit
    expect(m.mode).toBe("ESTIMATED"); // and if the engine fails, the fallback is flagged
    expect(m.warnings[0]).toMatch(/unavailable/i);
  });

  it("returns a road polyline from /route and caches it", async () => {
    const { httpGet } = fakeOsrm();
    const svc = new RoutingService({ baseUrl: "http://osrm.test", httpGet });

    const route = await svc.getRoadRoute([A, B, C]);
    expect(route?.geometry.type).toBe("LineString");
    expect(route?.geometry.coordinates).toEqual([
      [72.93, 19.14],
      [72.94, 19.15],
      [72.95, 19.16]
    ]);
    expect(route?.distanceMeters).toBe(2000);

    await svc.getRoadRoute([A, B, C]);
    expect(httpGet).toHaveBeenCalledTimes(1);
  });

  it("stitches long routes from several /route requests without duplicating the join", async () => {
    const { httpGet } = fakeOsrm();
    const svc = new RoutingService({ baseUrl: "http://osrm.test", httpGet, maxTablePoints: 3 });
    const pts = [0, 1, 2, 3, 4].map((i) => ({ latitude: 19 + i / 100, longitude: 72 + i / 100 }));

    const route = await svc.getRoadRoute(pts);

    expect(httpGet).toHaveBeenCalledTimes(2); // 5 points, 3 per request, 1 shared
    expect(route?.geometry.coordinates).toHaveLength(5);
    expect(route?.geometry.coordinates[2]).toEqual([72.02, 19.02]);
  });

  it("returns null (not a fake line) when /route fails", async () => {
    const httpGet = vi.fn().mockRejectedValue(new Error("boom"));
    const svc = new RoutingService({ baseUrl: "http://osrm.test", httpGet });
    expect(await svc.getRoadRoute([A, B])).toBeNull();
  });
});

describe("estimateMatrix", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is zero on the diagonal, positive off it, and handles duplicate points", () => {
    const m = estimateMatrix([A, A, B]);
    expect(m.durations[0][0]).toBe(0);
    expect(m.durations[0][1]).toBe(0); // duplicate coordinates
    expect(m.durations[0][2]).toBeGreaterThan(0);
  });
});

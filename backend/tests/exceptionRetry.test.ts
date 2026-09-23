import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

const prismaMock = vi.hoisted(() => ({
  assignmentException: { findMany: vi.fn() }
}));
vi.mock("../src/config/prisma", () => ({ prisma: prismaMock }));
vi.mock("../src/config/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }
}));
vi.mock("pino-http", () => ({ default: () => (_req: unknown, _res: unknown, next: () => void) => next() }));
const geocoding = vi.hoisted(() => ({ retryGeocodeAllExceptions: vi.fn() }));
vi.mock("../src/services/geocoding", async (importOriginal) => ({ ...(await importOriginal<object>()), ...geocoding }));

import { needsGeocodeRetry, retryableExceptions, runPool } from "../src/services/assignment.service";
import { createApp } from "../src/app";
import { env } from "../src/config/env";

// ── needsGeocodeRetry: a pure predicate, table-tested ───────────────────────

describe("needsGeocodeRetry — which open exceptions a re-geocode could plausibly fix", () => {
  const cases: [string, Parameters<typeof needsGeocodeRetry>[0]["reason"], string, "HOUSE" | "STREET" | "AREA" | "PINCODE" | "NONE" | null, boolean][] = [
    ["a failed geocode always qualifies", "GEOCODING_FAILED", "FAILED", "NONE", true],
    ["no beat match with a weak location qualifies", "NO_BEAT_MATCH", "SUCCESS", "AREA", true],
    ["an ambiguous match with only an area-level geocode qualifies (retrying might sharpen it)", "AMBIGUOUS_MATCH", "SUCCESS", "AREA", true],
    ["a multiple-beat match with only a street-level geocode qualifies", "MULTIPLE_BEAT_MATCH", "SUCCESS", "STREET", true],
    ["a multiple-beat match that is ALREADY a confident house-level geocode does not qualify (a genuine overlap, not a geocoding problem)", "MULTIPLE_BEAT_MATCH", "SUCCESS", "HOUSE", false],
    ["an ambiguous match that is already house-level does not qualify", "AMBIGUOUS_MATCH", "SUCCESS", "HOUSE", false],
    ["no postman assigned never qualifies (a beat/postman problem, not a location problem)", "NO_POSTMAN_ASSIGNED", "SUCCESS", "AREA", false],
    ["an inactive postman never qualifies", "INACTIVE_POSTMAN", "FAILED", "NONE", false],
    ["outside the post office never qualifies", "OUTSIDE_POST_OFFICE", "SUCCESS", "PINCODE", false],
    ["invalid coordinates qualify", "INVALID_COORDINATES", "FAILED", null, true],
    ["a pending (never geocoded) address with a qualifying reason qualifies", "WEAK_LOCATION", "PENDING", null, true]
  ];

  it.each(cases)("%s", (_label, reason, geocodingStatus, geocodingPrecision, expected) => {
    expect(needsGeocodeRetry({ reason }, { geocodingStatus, geocodingPrecision })).toBe(expected);
  });
});

// ── retryableExceptions: filtering + scope, against a mocked prisma ─────────

describe("retryableExceptions — loads and filters the candidates for Retry Geocode All", () => {
  beforeEach(() => vi.clearAllMocks());

  const row = (id: string, reason: string, geocodingStatus: string, geocodingPrecision: string | null, postOfficeId = "po1") => ({
    id,
    deliveryId: `d-${id}`,
    reason,
    delivery: { addressId: `a-${id}`, postOfficeId, address: { geocodingStatus, geocodingPrecision } }
  });

  it("keeps only exceptions whose reason and geocode state both qualify", async () => {
    prismaMock.assignmentException.findMany.mockResolvedValue([
      row("1", "GEOCODING_FAILED", "FAILED", null),
      row("2", "MULTIPLE_BEAT_MATCH", "SUCCESS", "HOUSE"), // excluded: already confident
      row("3", "WEAK_LOCATION", "SUCCESS", "AREA")
    ]);
    const result = await retryableExceptions();
    expect(result.map((r) => r.id)).toEqual(["1", "3"]);
  });

  it("scopes the database query itself to the given post office", async () => {
    prismaMock.assignmentException.findMany.mockResolvedValue([]);
    await retryableExceptions("po1");
    expect(prismaMock.assignmentException.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ delivery: { postOfficeId: "po1" } }) })
    );
  });

  it("passes no office filter for a super administrator (undefined postOfficeId)", async () => {
    prismaMock.assignmentException.findMany.mockResolvedValue([]);
    await retryableExceptions(undefined);
    expect(prismaMock.assignmentException.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ delivery: undefined }) })
    );
  });

  it("caps the query at 500 exceptions, so a bulk retry can never process an unbounded number at once", async () => {
    prismaMock.assignmentException.findMany.mockResolvedValue([]);
    await retryableExceptions();
    expect(prismaMock.assignmentException.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 500 }));
  });
});

// ── runPool: bounded concurrency, all items processed ───────────────────────

describe("runPool — bulk work without firing everything simultaneously", () => {
  it("processes every item exactly once", async () => {
    const seen: number[] = [];
    await runPool([1, 2, 3, 4, 5], 2, async (n) => {
      seen.push(n);
    });
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("never runs more than `limit` workers at the same time", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);
    await runPool(items, 3, async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
    });
    expect(maxInFlight).toBeLessThanOrEqual(3);
  });

  it("does nothing for an empty list", async () => {
    const worker = vi.fn();
    await runPool([], 4, worker);
    expect(worker).not.toHaveBeenCalled();
  });
});

// ── route: POST /assignments/exceptions/retry-geocode-all ──────────────────

describe("POST /assignments/exceptions/retry-geocode-all", () => {
  it("is admin/super-admin only, scopes by the caller's post office, and returns the summary as-is", async () => {
    const app = createApp();
    const token = (over: Record<string, unknown> = {}) =>
      jwt.sign({ sub: "admin-1", role: "ADMIN", postOfficeId: "po1", email: "a@postal.local", ...over }, env.jwtAccessSecret, { expiresIn: "15m" });
    const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

    const summary = { processed: 3, succeeded: 2, failed: 1, resolved: 1, stillUnresolved: 1, results: [] };
    geocoding.retryGeocodeAllExceptions.mockResolvedValue(summary);

    const res = await request(app).post("/api/v1/assignments/exceptions/retry-geocode-all").set(bearer(token()));
    expect(res.status).toBe(200);
    expect(res.body).toEqual(summary);
    expect(geocoding.retryGeocodeAllExceptions).toHaveBeenCalledWith("po1");

    const postmanRes = await request(app).post("/api/v1/assignments/exceptions/retry-geocode-all").set(bearer(token({ role: "POSTMAN" })));
    expect(postmanRes.status).toBe(403);

    const noAuthRes = await request(app).post("/api/v1/assignments/exceptions/retry-geocode-all");
    expect(noAuthRes.status).toBe(401);
  });
});

import axios from "axios";
import { env } from "../../config/env";
import { logger } from "../../config/logger";
import { LatLng, RouteGeometry, RoutingMode } from "./OptimizationService";

/**
 * Travel matrix + road geometry for the optimizer.
 *
 * - OSRM (or any OSRM-compatible engine) supplies real road durations and
 *   distances (`/table`) and the road polyline (`/route`).
 * - Every OSRM answer is cached per point PAIR, so re-planning after a stop is
 *   delivered (a subset of already-known points) needs no new matrix request.
 * - If OSRM is not configured, unreachable, times out, or a leg is missing, the
 *   matrix falls back to a straight-line estimate and the result is flagged
 *   `mode: "ESTIMATED"` with a warning — the caller/app must surface that; it
 *   is never presented as a road route.
 */

export interface TravelMatrix {
  /** durations[i][j] = seconds from points[i] to points[j]. */
  durations: number[][];
  /** distances[i][j] = meters from points[i] to points[j]. */
  distances: number[][];
  mode: RoutingMode;
  provider: string;
  warnings: string[];
  /** Routing-engine matrix requests this matrix needed (0 = served from the cache / estimated). */
  requests: number;
}

export interface RoadRoute {
  geometry: RouteGeometry;
  distanceMeters: number;
  durationSeconds: number;
}

export type HttpGet = (url: string, timeoutMs: number) => Promise<unknown>;

const defaultHttpGet: HttpGet = async (url, timeoutMs) => {
  const response = await axios.get(url, { timeout: timeoutMs });
  return response.data;
};

// ── Straight-line estimate (fallback only) ─────────────────────────────────

const EARTH_RADIUS_METERS = 6371000;
/** Road distance is typically ~1.3x the great-circle distance in a city. */
export const ESTIMATE_DETOUR_FACTOR = 1.3;
/** Urban delivery speed used ONLY when road routing is unavailable. */
export const ESTIMATE_SPEED_MPS = 25 / 3.6;

export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function estimateLeg(a: LatLng, b: LatLng): { distance: number; duration: number } {
  const distance = haversineMeters(a, b) * ESTIMATE_DETOUR_FACTOR;
  return { distance, duration: distance / ESTIMATE_SPEED_MPS };
}

export function estimateMatrix(points: readonly LatLng[]): Pick<TravelMatrix, "durations" | "distances"> {
  const n = points.length;
  const durations = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const distances = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const leg = estimateLeg(points[i], points[j]);
      durations[i][j] = leg.duration;
      distances[i][j] = leg.distance;
    }
  }
  return { durations, distances };
}

// ── Cache ──────────────────────────────────────────────────────────────────

/** ~1 m precision: identical stops share a key, GPS jitter beyond that doesn't. */
export function pointKey(p: LatLng): string {
  return `${p.latitude.toFixed(5)},${p.longitude.toFixed(5)}`;
}

interface PairEntry {
  distance: number;
  duration: number;
  at: number;
}

export class TravelPairCache {
  private readonly pairs = new Map<string, PairEntry>();
  private readonly routes = new Map<string, { value: RoadRoute; at: number }>();

  constructor(
    private readonly maxPairs = 50_000,
    private readonly maxRoutes = 200,
    private readonly ttlMs = 6 * 60 * 60 * 1000,
    private readonly clock: () => number = Date.now
  ) {}

  getPair(a: LatLng, b: LatLng): PairEntry | undefined {
    const key = `${pointKey(a)}>${pointKey(b)}`;
    const entry = this.pairs.get(key);
    if (!entry) return undefined;
    if (this.clock() - entry.at > this.ttlMs) {
      this.pairs.delete(key);
      return undefined;
    }
    return entry;
  }

  setPair(a: LatLng, b: LatLng, distance: number, duration: number): void {
    if (this.pairs.size >= this.maxPairs) {
      // Map iterates in insertion order: drop the oldest 10% in one go.
      let toDrop = Math.ceil(this.maxPairs * 0.1);
      for (const key of this.pairs.keys()) {
        this.pairs.delete(key);
        if (--toDrop <= 0) break;
      }
    }
    this.pairs.set(`${pointKey(a)}>${pointKey(b)}`, { distance, duration, at: this.clock() });
  }

  getRoute(points: readonly LatLng[]): RoadRoute | undefined {
    const key = points.map(pointKey).join("|");
    const hit = this.routes.get(key);
    if (!hit) return undefined;
    if (this.clock() - hit.at > this.ttlMs) {
      this.routes.delete(key);
      return undefined;
    }
    return hit.value;
  }

  setRoute(points: readonly LatLng[], value: RoadRoute): void {
    if (this.routes.size >= this.maxRoutes) {
      const oldest = this.routes.keys().next().value;
      if (oldest !== undefined) this.routes.delete(oldest);
    }
    this.routes.set(points.map(pointKey).join("|"), { value, at: this.clock() });
  }

  clear(): void {
    this.pairs.clear();
    this.routes.clear();
  }

  get size(): { pairs: number; routes: number } {
    return { pairs: this.pairs.size, routes: this.routes.size };
  }
}

// ── Service ────────────────────────────────────────────────────────────────

export interface RoutingServiceOptions {
  baseUrl: string;
  profile?: string;
  timeoutMs?: number;
  httpGet?: HttpGet;
  cache?: TravelPairCache;
  /** OSRM's public demo caps a /table request at 100 coordinates. */
  maxTablePoints?: number;
}

interface OsrmTableResponse {
  code?: string;
  durations?: (number | null)[][];
  distances?: (number | null)[][];
}

interface OsrmRouteResponse {
  code?: string;
  routes?: { distance: number; duration: number; geometry: RouteGeometry }[];
}

function coordString(points: readonly LatLng[]): string {
  return points.map((p) => `${p.longitude},${p.latitude}`).join(";");
}

export class RoutingService {
  readonly cache: TravelPairCache;
  private readonly baseUrl: string;
  private readonly profile: string;
  private readonly timeoutMs: number;
  private readonly httpGet: HttpGet;
  private readonly maxTablePoints: number;

  constructor(options: RoutingServiceOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.profile = options.profile ?? "driving";
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.httpGet = options.httpGet ?? defaultHttpGet;
    this.cache = options.cache ?? new TravelPairCache();
    this.maxTablePoints = options.maxTablePoints ?? 100;
  }

  get isConfigured(): boolean {
    return this.baseUrl.length > 0;
  }

  private estimated(points: readonly LatLng[], warning: string): TravelMatrix {
    return { ...estimateMatrix(points), mode: "ESTIMATED", provider: "haversine-estimate", warnings: [warning], requests: 0 };
  }

  /** Full pairwise matrix for points[0..n-1] (index 0 is the route start). */
  async getMatrix(points: readonly LatLng[]): Promise<TravelMatrix> {
    const n = points.length;
    if (n === 0) return { durations: [], distances: [], mode: "ROAD", provider: "none", warnings: [], requests: 0 };

    if (!this.isConfigured) {
      return this.estimated(
        points,
        "Road routing is not configured (OSRM_BASE_URL is empty): distances and times are straight-line estimates."
      );
    }

    // 1. Everything already known? Then no network call at all.
    const cached = this.assembleFromCache(points);
    if (cached) return cached;

    // 2. Ask the routing engine only for what is missing. Usually that is ONE new point
    // (the route start moves with the postman's GPS): then only that point's row and
    // column are requested instead of the whole n x n table.
    let requests = 0;
    try {
      const cover = this.coverMissing(points);
      if (n >= 6 && n <= this.maxTablePoints && cover.length > 0 && cover.length <= 2) {
        for (const k of cover) {
          const row = await this.fetchTable(points, { sources: [k] }); // k -> everyone
          const col = await this.fetchTable(points, { destinations: [k] }); // everyone -> k
          requests += 2;
          for (let j = 0; j < n; j++) this.storePair(points, k, j, row.durations?.[0]?.[j], row.distances?.[0]?.[j]);
          for (let i = 0; i < n; i++) this.storePair(points, i, k, col.durations?.[i]?.[0], col.distances?.[i]?.[0]);
        }
      } else {
        requests += await this.fetchEveryPair(points);
      }

      // Everything the engine could answer is now cached; a pair it could not connect
      // (a point snapped to an isolated road) is estimated for that pair only.
      const { durations, distances, estimatedLegs } = this.assemble(points);
      const warnings: string[] = [];
      if (estimatedLegs > 0) warnings.push(`${estimatedLegs} leg(s) had no road link and use straight-line estimates.`);
      return { durations, distances, mode: "ROAD", provider: "osrm", warnings, requests };
    } catch (err) {
      logger.warn({ err: describeError(err) }, "OSRM matrix request failed; falling back to estimates");
      return this.estimated(
        points,
        `Road routing service unavailable (${describeError(err)}): distances and times are straight-line estimates.`
      );
    }
  }

  /**
   * Fills the cache with every pair. One /table request when the engine accepts that many points; otherwise the
   * matrix is cut into blocks (some rows x some columns) that each fit the engine's limit, so a long round
   * still gets real road times. Returns the number of requests made.
   */
  private async fetchEveryPair(points: readonly LatLng[]): Promise<number> {
    const n = points.length;
    if (n <= this.maxTablePoints) {
      const body = await this.fetchTable(points);
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) this.storePair(points, i, j, body.durations?.[i]?.[j], body.distances?.[i]?.[j]);
      }
      return 1;
    }
    const size = Math.max(1, Math.floor(this.maxTablePoints / 2));
    let requests = 0;
    for (let r0 = 0; r0 < n; r0 += size) {
      const rows = Array.from({ length: Math.min(size, n - r0) }, (_, k) => r0 + k);
      for (let c0 = 0; c0 < n; c0 += size) {
        const cols = Array.from({ length: Math.min(size, n - c0) }, (_, k) => c0 + k);
        // the coordinates of this block: its rows, then any columns that are not already among them
        const used = [...rows, ...cols.filter((c) => !rows.includes(c))];
        if (used.length < 2) continue; // one point against itself: nothing to ask (and the engine refuses a single coordinate)
        const local = new Map(used.map((global, i) => [global, i]));
        const body = await this.fetchTable(
          used.map((g) => points[g]),
          { sources: rows.map((g) => local.get(g) as number), destinations: cols.map((g) => local.get(g) as number) }
        );
        requests += 1;
        rows.forEach((gi, ri) => cols.forEach((gj, ci) => this.storePair(points, gi, gj, body.durations?.[ri]?.[ci], body.distances?.[ri]?.[ci])));
      }
    }
    return requests;
  }

  private async fetchTable(
    points: readonly LatLng[],
    only: { sources?: number[]; destinations?: number[] } = {}
  ): Promise<OsrmTableResponse> {
    const query = ["annotations=duration,distance"];
    if (only.sources) query.push(`sources=${only.sources.join(";")}`);
    if (only.destinations) query.push(`destinations=${only.destinations.join(";")}`);
    const url = `${this.baseUrl}/table/v1/${this.profile}/${coordString(points)}?${query.join("&")}`;
    const body = (await this.httpGet(url, this.timeoutMs)) as OsrmTableResponse;
    if (body.code !== "Ok" || !body.durations || !body.distances) {
      throw new Error(`OSRM table returned code ${body.code ?? "unknown"}`);
    }
    return body;
  }

  private storePair(points: readonly LatLng[], i: number, j: number, duration?: number | null, distance?: number | null): void {
    if (i === j) return;
    if (typeof duration === "number" && typeof distance === "number") {
      this.cache.setPair(points[i], points[j], distance, duration);
    }
  }

  /** The smallest set of points that appear in every uncached pair (greedy). */
  private coverMissing(points: readonly LatLng[]): number[] {
    const n = points.length;
    const missing: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i !== j && !this.cache.getPair(points[i], points[j])) missing.push([i, j]);
      }
    }
    const cover: number[] = [];
    let remaining = missing;
    while (remaining.length > 0 && cover.length <= 2) {
      const counts = new Map<number, number>();
      for (const [i, j] of remaining) {
        counts.set(i, (counts.get(i) ?? 0) + 1);
        counts.set(j, (counts.get(j) ?? 0) + 1);
      }
      const [best] = [...counts.entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0])[0];
      cover.push(best);
      remaining = remaining.filter(([i, j]) => i !== best && j !== best);
    }
    return remaining.length > 0 ? [] : cover;
  }

  /** Builds the matrix from the cache, estimating any pair the engine never answered. */
  private assemble(points: readonly LatLng[]) {
    const n = points.length;
    const durations = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    const distances = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    let estimatedLegs = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const pair = this.cache.getPair(points[i], points[j]);
        if (pair) {
          durations[i][j] = pair.duration;
          distances[i][j] = pair.distance;
        } else {
          const leg = estimateLeg(points[i], points[j]);
          durations[i][j] = leg.duration;
          distances[i][j] = leg.distance;
          estimatedLegs++;
        }
      }
    }
    return { durations, distances, estimatedLegs };
  }

  private assembleFromCache(points: readonly LatLng[]): TravelMatrix | null {
    const n = points.length;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i !== j && !this.cache.getPair(points[i], points[j])) return null;
      }
    }
    const { durations, distances } = this.assemble(points);
    return { durations, distances, mode: "ROAD", provider: "osrm-cache", warnings: [], requests: 0 };
  }

  /**
   * Road polyline through `points` in order. Returns null when no road
   * geometry can be produced (not configured / failure) so the caller can
   * fall back — and say it fell back.
   */
  async getRoadRoute(points: readonly LatLng[]): Promise<RoadRoute | null> {
    if (!this.isConfigured || points.length < 2) return null;

    const cached = this.cache.getRoute(points);
    if (cached) return cached;

    try {
      // OSRM limits waypoints per request; chunk long routes, sharing the
      // boundary waypoint between consecutive chunks.
      const chunks: LatLng[][] = [];
      for (let start = 0; start < points.length - 1; start += this.maxTablePoints - 1) {
        chunks.push(points.slice(start, Math.min(points.length, start + this.maxTablePoints)));
      }

      const coordinates: [number, number][] = [];
      let distanceMeters = 0;
      let durationSeconds = 0;

      for (const [index, chunk] of chunks.entries()) {
        const url =
          `${this.baseUrl}/route/v1/${this.profile}/${coordString(chunk)}` +
          `?overview=full&geometries=geojson&steps=false`;
        const body = (await this.httpGet(url, this.timeoutMs)) as OsrmRouteResponse;
        const route = body.routes?.[0];
        if (body.code !== "Ok" || !route) throw new Error(`OSRM route returned code ${body.code ?? "unknown"}`);

        // Drop the shared boundary coordinate of every chunk after the first.
        coordinates.push(...(index === 0 ? route.geometry.coordinates : route.geometry.coordinates.slice(1)));
        distanceMeters += route.distance;
        durationSeconds += route.duration;
      }

      const result: RoadRoute = {
        geometry: { type: "LineString", coordinates },
        distanceMeters,
        durationSeconds
      };
      this.cache.setRoute(points, result);
      return result;
    } catch (err) {
      logger.warn({ err: describeError(err) }, "OSRM route request failed; no road geometry available");
      return null;
    }
  }
}

function describeError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    return err.code === "ECONNABORTED" ? "request timed out" : (err.message ?? "network error");
  }
  return err instanceof Error ? err.message : "unknown error";
}

let instance: RoutingService | null = null;

export function getRoutingService(): RoutingService {
  if (!instance) {
    instance = new RoutingService({
      baseUrl: env.osrmBaseUrl,
      profile: env.osrmProfile,
      timeoutMs: env.osrmTimeoutMs
    });
  }
  return instance;
}

/** Test seam. Pass null to reset to the env-configured singleton. */
export function setRoutingServiceForTests(service: RoutingService | null): void {
  instance = service;
}

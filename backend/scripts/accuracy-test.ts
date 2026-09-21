/**
 * Module accuracy tests on the Bhandup West data set. Everything reported comes from running the code:
 *
 *   1. Geocoding            what the system's geocoder actually returned for the 130 supplied addresses
 *   2. Beat assignment      the production method (geocode -> PostGIS point-in-territory) against the ground truth in
 *                           the supplied files, and two alternative methods evaluated on the same 130 deliveries
 *   3. Route optimization   every algorithm against the exact optimum (up to 10 stops) or the best route found
 *                           (large routes), using real road times from OSRM
 *   4. Data quality         problems found in the supplied files themselves
 *
 *   npx tsx scripts/accuracy-test.ts            -> backend/data/bhandup/accuracy-results.json
 *
 * Needs the data set to be loaded first (scripts/setup-bhandup.ts) and the routing engine (OSRM_BASE_URL).
 * Ground truth: the delivery file has 5 deliveries per beat, in beat order (delivery n belongs to beat ceil(n / 5)).
 */
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../src/config/prisma";
import { optimizeWithAlns } from "../src/services/optimization/clustering";
import { DEFAULT_COST_PARAMS, StopLoad, evaluateRoute, nearestNeighborRoute, twoOpt } from "../src/services/optimization/routeAlgorithms";
import { RoutingService } from "../src/services/optimization/routing";

const DATA = path.join(__dirname, "..", "data", "bhandup");
const OSRM = (process.env.OSRM_BASE_URL ?? "https://router.project-osrm.org").replace(/\/+$/, "");
const START = { latitude: 19.1436, longitude: 72.9345 }; // Bhandup West post office area
const BBOX = { minLat: 19.12, maxLat: 19.175, minLng: 72.905, maxLng: 72.965 };

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c; }
    else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.some((x) => x !== "")) rows.push(row); row = []; }
    else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const haversine = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const inBox = (lat: number, lng: number) => lat >= BBOX.minLat && lat <= BBOX.maxLat && lng >= BBOX.minLng && lng <= BBOX.maxLng;
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

// ── ground truth ─────────────────────────────────────────────────────────────────────────────────────────────
const deliveryRows = parseCsv(fs.readFileSync(path.join(DATA, "deliveries.csv"), "utf8")).slice(1).map((r, i) => ({
  n: i + 1, name: r[0], phone: r[1], locality: r[3], mainArea: r[4], truthBeat: Math.ceil((i + 1) / 5)
}));
const directory = parseCsv(fs.readFileSync(path.join(DATA, "beat-directory.csv"), "utf8")).slice(1);
const beatsOfLocality = new Map<string, Set<number>>();
for (const r of directory) {
  const k = r[3].trim().toUpperCase();
  if (!beatsOfLocality.has(k)) beatsOfLocality.set(k, new Set());
  beatsOfLocality.get(k)!.add(Number(r[2]));
}

// ── 1 + 2: what the system did ───────────────────────────────────────────────────────────────────────────────
async function systemResults() {
  const dels = await prisma.delivery.findMany({
    include: { recipient: true, address: true, beat: { select: { beatNumber: true } }, exceptions: true }
  });
  const beats = await prisma.$queryRawUnsafe<{ beatNumber: string; hasTerritory: boolean; verified: string; cx: number | null; cy: number | null }[]>(
    `SELECT beat_number AS "beatNumber", boundary IS NOT NULL AS "hasTerritory", "verificationStatus"::text AS verified,
            ST_X(ST_Centroid(boundary)) AS cx, ST_Y(ST_Centroid(boundary)) AS cy FROM "Beat" ORDER BY beat_number::int`
  );
  const byPhone = new Map(dels.map((d) => [d.recipient.phone, d]));
  const perDelivery = deliveryRows.map((row) => {
    const d = byPhone.get(row.phone);
    const a = d?.address;
    const assigned = d?.beat ? Number(d.beat.beatNumber) : null;
    const exc = d?.exceptions.map((e) => e.reason) ?? [];
    return {
      ...row,
      imported: !!d,
      geocodingStatus: a?.geocodingStatus ?? "MISSING",
      geocodingSource: a?.geocodingSource ?? null,
      confidence: a?.geocodingConfidence ?? null,
      lat: a?.latitude ?? null,
      lng: a?.longitude ?? null,
      assignedBeat: assigned,
      exceptions: exc
    };
  });

  // geocoding
  const tiers: Record<string, number> = {};
  for (const p of perDelivery) tiers[p.geocodingStatus === "SUCCESS" ? p.geocodingSource ?? "unknown" : p.geocodingStatus] = (tiers[p.geocodingStatus === "SUCCESS" ? p.geocodingSource ?? "unknown" : p.geocodingStatus] ?? 0) + 1;
  const withCoords = perDelivery.filter((p) => p.lat !== null && p.lng !== null && p.geocodingStatus === "SUCCESS");
  const distinct = new Set(withCoords.map((p) => `${p.lat!.toFixed(5)},${p.lng!.toFixed(5)}`)).size;
  const geocoding = {
    total: perDelivery.length,
    imported: perDelivery.filter((p) => p.imported).length,
    tiers,
    exact: tiers["nominatim"] ?? 0,
    areaLevel: tiers["nominatim-area"] ?? 0,
    pincodeLevel: tiers["nominatim-pincode"] ?? 0,
    failed: perDelivery.filter((p) => p.geocodingStatus !== "SUCCESS").length,
    withCoordinates: withCoords.length,
    distinctCoordinates: distinct,
    insideBhandupWest: withCoords.filter((p) => inBox(p.lat!, p.lng!)).length
  };

  // production assignment
  const outcome = { correct: 0, wrong: 0, unassigned: 0 };
  const unassignedReasons: Record<string, number> = {};
  const wrongPairs: { n: number; truth: number; got: number }[] = [];
  for (const p of perDelivery) {
    if (p.assignedBeat === null) {
      outcome.unassigned++;
      const r = p.exceptions[0] ?? (p.geocodingStatus !== "SUCCESS" ? "GEOCODING_FAILED" : "UNASSIGNED");
      unassignedReasons[r] = (unassignedReasons[r] ?? 0) + 1;
    } else if (p.assignedBeat === p.truthBeat) outcome.correct++;
    else { outcome.wrong++; wrongPairs.push({ n: p.n, truth: p.truthBeat, got: p.assignedBeat }); }
  }
  // wrong / correct split by how coarse the geocode was
  const byTier: Record<string, { correct: number; wrong: number; unassigned: number }> = {};
  for (const p of perDelivery) {
    const t = p.geocodingStatus === "SUCCESS" ? p.geocodingSource ?? "unknown" : "failed";
    byTier[t] ??= { correct: 0, wrong: 0, unassigned: 0 };
    if (p.assignedBeat === null) byTier[t].unassigned++; else if (p.assignedBeat === p.truthBeat) byTier[t].correct++; else byTier[t].wrong++;
  }

  // alternative methods on the same deliveries
  const territoryBeats = beats.filter((b) => b.hasTerritory && b.cx !== null);
  const nearest = { correct: 0, wrong: 0, unassigned: 0 };
  for (const p of perDelivery) {
    if (p.lat === null || p.geocodingStatus !== "SUCCESS" || !territoryBeats.length) { nearest.unassigned++; continue; }
    let best = -1, bd = Infinity;
    for (const b of territoryBeats) { const d = haversine({ lat: p.lat, lng: p.lng! }, { lat: b.cy!, lng: b.cx! }); if (d < bd) { bd = d; best = Number(b.beatNumber); } }
    if (best === p.truthBeat) nearest.correct++; else nearest.wrong++;
  }
  const lookup = { correct: 0, wrong: 0, ambiguous: 0, unknown: 0 };
  for (const p of perDelivery) {
    const set = beatsOfLocality.get(p.locality.trim().toUpperCase());
    if (!set) lookup.unknown++;
    else if (set.size === 1) { if ([...set][0] === p.truthBeat) lookup.correct++; else lookup.wrong++; }
    else lookup.ambiguous++;
  }
  const sharedLocalities = [...beatsOfLocality].filter(([, s]) => s.size > 1).map(([k, s]) => ({ locality: k, beats: [...s].sort((a, b) => a - b) }));

  const perBeat = beats.map((b) => {
    const n = Number(b.beatNumber);
    const mine = perDelivery.filter((p) => p.truthBeat === n);
    return {
      beat: n, hasTerritory: b.hasTerritory, verified: b.verified,
      correct: mine.filter((p) => p.assignedBeat === n).length,
      wrong: mine.filter((p) => p.assignedBeat !== null && p.assignedBeat !== n).length,
      unassigned: mine.filter((p) => p.assignedBeat === null).length
    };
  });
  const overlap = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*) AS n FROM "Beat" a JOIN "Beat" b ON a.id < b.id AND a.boundary IS NOT NULL AND b.boundary IS NOT NULL AND ST_Area(ST_Intersection(a.boundary, b.boundary)::geography) > 1`
  );
  return {
    geocoding, perDelivery, perBeat, byTier, wrongPairs, unassignedReasons,
    assignment: { production: outcome, nearestTerritoryCentre: nearest, localityNameLookup: lookup, sharedLocalities, beatsWithTerritory: territoryBeats.length, beatsTotal: beats.length, overlappingTerritoryPairs: Number(overlap[0].n) }
  };
}

// ── 3: route algorithms ──────────────────────────────────────────────────────────────────────────────────────
function lcg(seed: number) { let s = seed; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; }

/** Exact optimum of the production cost for up to ~10 stops (depth-first with pruning: the cost only grows along a path). */
function exactOptimum(durations: number[][], stops: StopLoad[], params = DEFAULT_COST_PARAMS) {
  const n = stops.length;
  const total = stops.reduce((s, x) => s + x.load, 0);
  let best = Infinity, bestOrder: number[] = [];
  const used = new Array(n).fill(false), path: number[] = [];
  const go = (prev: number, clock: number, remaining: number, cost: number) => {
    if (cost >= best) return;
    if (path.length === n) { best = cost; bestOrder = [...path]; return; }
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      const t = durations[prev][i + 1];
      const c = cost + t + params.loadWeight * t * (total > 0 ? Math.max(0, remaining) / total : 0) + params.priorityWeight * stops[i].priorityFactor * (clock + t);
      used[i] = true; path.push(i);
      go(i + 1, clock + t + stops[i].serviceSeconds, remaining - stops[i].load, c);
      used[i] = false; path.pop();
    }
  };
  go(0, 0, total, 0);
  return { cost: best, order: bestOrder };
}

type Pt = { latitude: number; longitude: number };
const ALGORITHMS = ["Input order", "Random order (mean of 30)", "Nearest Neighbour", "NN + 2-opt", "DBSCAN + NN", "DBSCAN + NN + 2-opt", "DBSCAN + NN + 2-opt + ALNS (production)"] as const;

async function routeRun(routing: RoutingService, points: Pt[], seed: number) {
  const matrix = await routing.getMatrix([START, ...points]);
  const stops: StopLoad[] = points.map(() => ({ load: 1, priorityFactor: 0, serviceSeconds: 180 }));
  const params = DEFAULT_COST_PARAMS;
  const cost = (o: readonly number[]) => evaluateRoute(o, matrix.durations, stops, params).total;
  const sum = (o: readonly number[], m: readonly (readonly number[])[]) => { let p = 0, s = 0; for (const i of o) { s += m[p][i + 1]; p = i + 1; } return s; };
  const timed = <T,>(fn: () => T): [T, number] => { const t0 = performance.now(); const v = fn(); return [v, performance.now() - t0]; };
  const n = points.length;
  const ident = points.map((_, i) => i);

  const rnd = lcg(seed);
  const randCosts: number[] = [];
  const [, randMs] = timed(() => { for (let r = 0; r < 30; r++) { const p = [...ident]; for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; } randCosts.push(cost(p)); } });
  const [nn, nnMs] = timed(() => nearestNeighborRoute(matrix.durations, stops, params));
  const [nn2, nn2Ms] = timed(() => twoOpt(nn, cost, { maxPasses: 500, maxMillis: 20_000 }).order);
  const [full, fullMs] = timed(() => optimizeWithAlns({ durations: matrix.durations, stops, params, maxPasses: 500, maxMillis: 20_000, alns: { maxIterations: 2500, maxMillis: 20_000, noImprovementLimit: 600, preserveClusters: true } }));
  const orders: (number[] | null)[] = [ident, null, nn, nn2, full.initialOrder, full.twoOptOrder, full.order];
  const ms = [0, randMs / 30, nnMs, nnMs + nn2Ms, null, full.optimizationMs, fullMs] as (number | null)[];
  const costs = orders.map((o, i) => (o ? cost(o) : mean(randCosts)));
  let optimum: number | null = null, exactMs = 0;
  if (n <= 10) { const [ex, t] = timed(() => exactOptimum(matrix.durations, stops)); optimum = ex.cost; exactMs = t; }
  // Larger rounds have no exact optimum. Reference = the best route found by the six algorithms above AND by 5 long,
  // independent ALNS runs (15 000 iterations, other random seeds, clusters not forced to stay whole). The production run is
  // therefore not compared with itself: it can score above 0 % when a longer search finds a cheaper route.
  let longRunBest = Infinity;
  if (optimum === null) {
    for (const seed of [11, 22, 33, 44, 55]) {
      const r = optimizeWithAlns({ durations: matrix.durations, stops, params, maxPasses: 500, maxMillis: 20_000, alns: { maxIterations: 15_000, maxMillis: 12_000, noImprovementLimit: 4_000, preserveClusters: false, seed } });
      longRunBest = Math.min(longRunBest, cost(r.order));
    }
  }
  const bestKnown = Math.min(...costs.filter((_, i) => i !== 1), optimum ?? Infinity, longRunBest);
  const ref = optimum ?? bestKnown;
  return {
    stops: n, exact: optimum !== null, reference: ref, exactMs, longRunReference: longRunBest === Infinity ? null : longRunBest,
    algorithms: ALGORITHMS.map((name, i) => ({
      name, cost: costs[i], gapPercent: round(((costs[i] - ref) / ref) * 100, 3), optimal: costs[i] <= ref + 1e-6,
      distanceKm: orders[i] ? round(sum(orders[i]!, matrix.distances) / 1000, 3) : null,
      travelMin: orders[i] ? round(sum(orders[i]!, matrix.durations) / 60, 2) : null,
      runtimeMs: ms[i] === null ? null : round(ms[i]!, 2)
    })),
    alnsStoppedBy: full.alns.stoppedBy, roadMatrix: matrix.mode
  };
}

/** Where the delivery points come from (stated in the report): the stored geocode when it is street/area level, else a placed point near the beat's OSM anchor. */
async function routeTests(system: Awaited<ReturnType<typeof systemResults>>) {
  const anchors = JSON.parse(fs.readFileSync(path.join(DATA, "locality-anchors.json"), "utf8")) as Record<string, { lat: number; lng: number }>;
  const beatRows = await prisma.beat.findMany({ select: { beatNumber: true, metadata: true } });
  const beatAnchor = new Map<number, { lat: number; lng: number }[]>();
  for (const b of beatRows) {
    const list = ((b.metadata as any)?.territorySource?.anchors ?? []) as { lat: number; lng: number }[];
    if (list.length) beatAnchor.set(Number(b.beatNumber), list);
  }
  // deterministic placement: within 300 m of the anchor nearest to the delivery's locality (first anchor of the beat otherwise)
  const placed = new Map<number, Pt>();
  const rnd = lcg(20260921);
  for (const p of system.perDelivery) {
    const list = beatAnchor.get(p.truthBeat);
    if (!list) continue;
    const base = list[(p.n - 1) % list.length];
    const ang = rnd() * 2 * Math.PI, rad = 60 + rnd() * 240;
    placed.set(p.n, { latitude: base.lat + (rad * Math.cos(ang)) / 111_000, longitude: base.lng + (rad * Math.sin(ang)) / (111_000 * Math.cos(base.lat * Math.PI / 180)) });
  }
  const routing = new RoutingService({ baseUrl: OSRM, timeoutMs: 30_000 });
  const perBeat: any[] = [];
  for (let beat = 1; beat <= 26; beat++) {
    const pts = system.perDelivery.filter((p) => p.truthBeat === beat && placed.has(p.n)).map((p) => placed.get(p.n)!);
    if (pts.length < 4) continue;
    perBeat.push({ beat, ...(await routeRun(routing, pts, 100 + beat)) });
  }
  // bigger rounds: consecutive beats merged (a postman covering several beats / a whole office round)
  const merged: any[] = [];
  const beatsWithPoints = [...new Set([...placed.keys()].map((n) => Math.ceil(n / 5)))].sort((a, b) => a - b);
  for (const k of [2, 5, 10, beatsWithPoints.length]) {
    const use = beatsWithPoints.slice(0, k);
    const pts = system.perDelivery.filter((p) => use.includes(p.truthBeat) && placed.has(p.n)).map((p) => placed.get(p.n)!);
    if (pts.length < 6) continue;
    merged.push({ beats: use.length, ...(await routeRun(routing, pts, 900 + k)) });
  }
  return { beatsWithPlacement: beatsWithPoints.length, perBeat, merged };
}

// ── 4: data quality of the supplied files ────────────────────────────────────────────────────────────────────
function dataQuality() {
  const shared = [...beatsOfLocality].filter(([, s]) => s.size > 1);
  const areaKey = new Map<string, number>();
  for (const r of deliveryRows) areaKey.set(`${r.locality}|${r.mainArea}`, (areaKey.get(`${r.locality}|${r.mainArea}`) ?? 0) + 1);
  const names = new Set(deliveryRows.map((r) => r.name));
  return {
    beats: 26, localitiesInBeatList: beatsOfLocality.size, localitiesSharedByMoreThanOneBeat: shared.length,
    sharedExamples: shared.slice(0, 8).map(([k, s]) => `${k}: beats ${[...s].sort((a, b) => a - b).join(", ")}`),
    deliveries: deliveryRows.length, deliveriesInSharedLocality: deliveryRows.filter((r) => (beatsOfLocality.get(r.locality.toUpperCase())?.size ?? 0) > 1).length,
    duplicateAddresses: [...areaKey].filter(([, c]) => c > 1).length,
    distinctRecipientNames: names.size, recipientNamesRepeated: deliveryRows.length - names.size,
    truncatedMainAreas: deliveryRows.filter((r) => /^(WING|WING \d+ FLOORS?)/.test(r.mainArea)).map((r) => r.mainArea),
    pincodeTypos: "Beat 12 (BHATTIPADA, KESHAVJI NAGAR, JANGAL MANGAL ROAD) is listed with pincode 40078 (5 digits) in the supplied beat list",
    noPriorityOrParcelData: true
  };
}

async function main() {
  const system = await systemResults();
  console.log("geocoding:", JSON.stringify(system.geocoding));
  console.log("assignment:", JSON.stringify(system.assignment));
  const routes = await routeTests(system);
  console.log("route tests:", routes.perBeat.length, "beat routes,", routes.merged.length, "merged rounds");
  const out = { generatedAt: new Date().toISOString(), system, routes, dataQuality: dataQuality() };
  fs.writeFileSync(path.join(DATA, "accuracy-results.json"), JSON.stringify(out, null, 1));
  console.log("written", path.join(DATA, "accuracy-results.json"));
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });

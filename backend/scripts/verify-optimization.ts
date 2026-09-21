/**
 * Live proof of the route optimizer against a RUNNING backend and the real routing engine.
 *
 *   npm run route:verify
 *
 * Part A (read-only, the seeded postman Ramesh Kadam):
 *   - the route comes from the single DBSCAN -> NN -> 2-opt -> ALNS pipeline, with measured metrics
 *     (read through the ADMIN endpoint: the postman's response carries neither metrics nor an algorithm name)
 *   - the reported cost is re-computed here from a FRESH routing-engine matrix and the
 *     documented cost function, independently of the backend's code
 *   - a client cannot pick another algorithm (query string / body are ignored)
 *   - the admin sees exactly the same route as the postman
 * Part B (creates TEST-OPT-* deliveries for "Test Postman A" and works them, like a round):
 *   - a new delivery re-runs the full pipeline
 *   - a completed delivery prunes the route (remaining order untouched)
 *   - a failed attempt (recipient unavailable) re-runs the full pipeline without that stop
 *
 * Nothing is reset or deleted. Requires `db:verify -- setup` to have been run once (it creates
 * Test Postman A and Beat 100).
 *
 * API_URL          default http://localhost:4000/api/v1
 * OSRM_BASE_URL    default https://router.project-osrm.org
 */
const API = process.env.API_URL ?? "http://localhost:4000/api/v1";
const OSRM = (process.env.OSRM_BASE_URL ?? "https://router.project-osrm.org").replace(/\/+$/, "");
const ADMIN = { email: process.env.ADMIN_EMAIL ?? "admin.bhandup@postal.local", password: process.env.ADMIN_PASSWORD ?? "ChangeMe123!" };
// The seeded postmen. Whichever of them currently has deliveries is used for the read-only checks
// (an administrator may have moved a beat between postmen since the data was seeded).
const SEEDED_POSTMEN = ["ramesh.kadam@postal.local", "sunita.pawar@postal.local"].map((email) => ({ email, password: process.env.POSTMAN_PASSWORD ?? "ChangeMe123!" }));
const TEST_A = { email: "test.postman.a@postal.local", password: "TestPass123!" };

let failed = 0;
let passed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail !== undefined ? "  -> " + JSON.stringify(detail).slice(0, 400) : ""}`);
  }
}

type Json = any;

async function call(method: string, path: string, opts: { token?: string; body?: unknown } = {}): Promise<{ status: number; data: Json }> {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(API + path, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  const text = await res.text();
  let data: Json = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

async function login(creds: { email: string; password: string }) {
  const r = await call("POST", "/auth/login", { body: creds });
  if (r.status !== 200) throw new Error(`login failed for ${creds.email}: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data as { accessToken: string; user: Json };
}

// ── the documented cost function, written out again (independent of the backend) ────────────
const PRIORITY_FACTOR: Record<string, number> = { LOW: 0, NORMAL: 0, HIGH: 1, URGENT: 3 };
const LOAD_WEIGHT = 0.35;
const PRIORITY_WEIGHT = 0.25;

interface Node {
  lat: number;
  lng: number;
  parcels: number;
  priority: string;
  serviceMinutes: number;
}

async function osrmTable(points: { lat: number; lng: number }[]): Promise<number[][]> {
  const coords = points.map((p) => `${p.lng},${p.lat}`).join(";");
  const res = await fetch(`${OSRM}/table/v1/driving/${coords}?annotations=duration`);
  const body = (await res.json()) as { code: string; durations: number[][] };
  if (body.code !== "Ok") throw new Error(`OSRM said ${body.code}`);
  return body.durations;
}

function referenceCost(d: number[][], order: Node[]) {
  const totalLoad = order.reduce((s, n) => s + n.parcels, 0);
  let remaining = totalLoad;
  let clock = 0;
  let travel = 0;
  let load = 0;
  let priority = 0;
  order.forEach((n, i) => {
    const t = d[i][i + 1]; // matrix rows are [start, ...order]
    travel += t;
    load += LOAD_WEIGHT * t * (remaining / totalLoad);
    clock += t;
    priority += PRIORITY_WEIGHT * (PRIORITY_FACTOR[n.priority] ?? 0) * clock;
    clock += n.serviceMinutes * 60;
    remaining -= n.parcels;
  });
  return { travel, load, priority, total: travel + load + priority };
}

/** JSON with sorted keys: the database's jsonb column does not keep key order, the values are what matter. */
const canon = (value: Json): string => JSON.stringify(value, (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v));

const ids = (route: Json): string[] => route.solution.stops.map((s: Json) => s.deliveryId);

async function partA() {
  console.log("\nA. Ramesh Kadam's real round (read-only)");
  const admin = await login(ADMIN);
  let t = "";
  let first: { status: number; data: Json } = { status: 0, data: null };
  for (const candidate of SEEDED_POSTMEN) {
    const session = await login(candidate);
    first = await call("GET", "/me/route", { token: session.accessToken });
    if (first.data?.solution) {
      t = session.accessToken;
      console.log(`        using ${candidate.email}`);
      break;
    }
  }
  check("GET /me/route returns a route", first.status === 200 && Array.isArray(first.data?.solution?.stops), first.data);
  const route = first.data;
  // The optimizer's diagnostics are for administrators; the postman's copy of the same route has none.
  const adminFull = async (postmanId: string): Promise<Json> => (await call("GET", `/postmen/${postmanId}/route`, { token: admin.accessToken })).data;
  const full = await adminFull(route.solution.postmanId);
  const m = full.solution.metrics;

  check("the postman's route carries no metrics and no algorithm name", !("metrics" in route.solution) && !("algorithm" in route.solution) && !/DBSCAN|ALNS|2OPT|2-opt/i.test(JSON.stringify(route)), Object.keys(route.solution));
  check("the admin's copy is the same route, with diagnostics", full.routeId === route.routeId && JSON.stringify(ids(full)) === JSON.stringify(ids(route)));
  check("the algorithm is DBSCAN_NN_2OPT_ALNS", full.solution.algorithm === "DBSCAN_NN_2OPT_ALNS" && m?.algorithm === "DBSCAN_NN_2OPT_ALNS", full.solution.algorithm);
  check("metrics were measured (input -> DBSCAN+NN -> +2-opt)", m && m.inputOrderCost > 0 && m.dbscanNnCost > 0 && m.totalCost > 0, m);
  check("ALNS ran after 2-opt and never made the route worse", m.alns && m.alns.stoppedBy !== undefined && m.totalCost <= m.twoOptCost + 1e-6 && m.twoOptCost <= m.dbscanNnCost + 1e-6, { nn: m.dbscanNnCost, twoOpt: m.twoOptCost, final: m.totalCost, alns: m.alns?.stoppedBy });
  check("the reported ALNS improvement matches the costs", Math.abs(m.improvementFromAlnsPercent - (m.twoOptCost > 0 ? ((m.twoOptCost - m.totalCost) / m.twoOptCost) * 100 : 0)) < 0.02, [m.improvementFromAlnsPercent, m.twoOptCost, m.totalCost]);
  check("2-opt never made the route worse", m.totalCost <= m.dbscanNnCost + 1e-6, { nn: m.dbscanNnCost, final: m.totalCost });
  check("the optimized route beats the input order", m.totalCost < m.inputOrderCost, { input: m.inputOrderCost, final: m.totalCost });
  check("clusters are reported per stop and contiguous", (() => {
    const seen = new Set<number>();
    let prev = -1;
    for (const s of route.solution.stops) {
      if (s.clusterId !== prev) {
        if (seen.has(s.clusterId)) return false;
        seen.add(s.clusterId);
        prev = s.clusterId;
      }
    }
    return true;
  })());
  check("road travel times were used (ROAD matrix, road geometry)", m.matrixMode === "ROAD" && route.solution.routing?.geometrySource === "ROAD", route.solution.routing);
  check("only routable deliveries are in the route", route.solution.stops.length === m.stops);
  console.log(`        ${route.solution.stops.length} stops, ${m.clusters} cluster(s), eps ${m.dbscanEpsSeconds}s${m.dbscanEpsAuto ? " (derived)" : ""}, ` +
    `cost input ${m.inputOrderCost} -> DBSCAN+NN ${m.dbscanNnCost} -> +2-opt ${m.twoOptCost} -> +ALNS ${m.totalCost}, ${m.optimizationMs} ms, start ${route.solution.start?.source}`);

  // Independent recomputation of the cost from a fresh routing-engine matrix.
  const mine = (await call("GET", "/me/deliveries?pageSize=100", { token: t })).data.rows as Json[];
  const byId = new Map(mine.map((d) => [d.id, d]));
  const order: Node[] = route.solution.stops.map((s: Json) => {
    const d = byId.get(s.deliveryId);
    return { lat: s.latitude, lng: s.longitude, parcels: d?.parcelCount ?? 1, priority: d?.priority ?? "NORMAL", serviceMinutes: s.serviceTimeMinutes ?? 3 };
  });
  const start = route.solution.start;
  const matrix = await osrmTable([{ lat: start.latitude, lng: start.longitude }, ...order]);
  const ref = referenceCost(matrix, order);
  const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(3, b * 0.02); // the routing engine's data may move a little between calls
  check("independent cost (fresh OSRM matrix + documented formula) matches the reported cost", close(m.totalCost, ref.total), { reported: m.totalCost, independent: Math.round(ref.total * 10) / 10 });
  check("  ... travel part", close(m.travelCost, ref.travel), { reported: m.travelCost, independent: Math.round(ref.travel) });
  check("  ... load part", close(m.loadPenalty, ref.load), { reported: m.loadPenalty, independent: Math.round(ref.load * 10) / 10 });
  check("  ... priority part", close(m.priorityPenalty, ref.priority), { reported: m.priorityPenalty, independent: Math.round(ref.priority * 10) / 10 });

  // Nobody can choose another algorithm: whatever the client sends, the route is the one pipeline's route.
  const baseline = await call("GET", "/me/route?refresh=true", { token: t });
  const baselineFull = await adminFull(route.solution.postmanId);
  check("a normal request (no algorithm parameter) works and runs the one pipeline", baseline.status === 200 && baselineFull.solution.algorithm === "DBSCAN_NN_2OPT_ALNS" && baselineFull.routeId === baseline.data.routeId, baselineFull.solution?.algorithm);
  for (const algorithm of ["NN", "2OPT", "ALNS", "DBSCAN", "NN_2OPT", "GENETIC"]) {
    const q = await call("GET", `/me/route?algorithm=${algorithm}&refresh=true`, { token: t });
    const qf = await adminFull(route.solution.postmanId);
    check(`GET /me/route?algorithm=${algorithm} is ignored: same pipeline, same route`,
      q.status === 200 && qf.routeId === q.data.routeId && qf.solution.algorithm === "DBSCAN_NN_2OPT_ALNS" && qf.solution.metrics.alns.stoppedBy !== "NOT_RUN" && JSON.stringify(ids(q.data)) === JSON.stringify(ids(baseline.data)),
      { status: q.status, algorithm: qf.solution?.algorithm, sameOrder: JSON.stringify(ids(q.data)) === JSON.stringify(ids(baseline.data)) });
    const b = await call("POST", "/me/route/reoptimize", { token: t, body: { trigger: "MANUAL", algorithm } });
    const bf = await adminFull(route.solution.postmanId);
    check(`POST /me/route/reoptimize {algorithm: ${algorithm}} is ignored: same pipeline, same route`,
      b.status === 201 && bf.routeId === b.data.routeId && bf.solution.algorithm === "DBSCAN_NN_2OPT_ALNS" && bf.solution.metrics.twoOptStoppedBy !== undefined && JSON.stringify(ids(b.data)) === JSON.stringify(ids(baseline.data)),
      { status: b.status, algorithm: bf.solution?.algorithm });
  }
  const p = await call("POST", "/me/route/reoptimize", { token: t, body: { trigger: "MANUAL" } });
  const again = await call("POST", "/me/route/reoptimize", { token: t, body: { trigger: "MANUAL" } });
  check("recalculating twice gives the same order (deterministic)", JSON.stringify(ids(again.data)) === JSON.stringify(ids(p.data)));

  // Same route for the admin.
  const post = mine[0]?.assignedPostmanId ?? route.solution.postmanId;
  const adminRoute = await call("GET", `/postmen/${post}/route`, { token: admin.accessToken });
  check("admin GET /postmen/:id/route is the postman's route", adminRoute.status === 200 && adminRoute.data.routeId === again.data.routeId, { admin: adminRoute.data?.routeId, postman: again.data.routeId });
  check("admin sees the same stop order, ETAs, legs and road geometry", JSON.stringify(ids(adminRoute.data)) === JSON.stringify(ids(again.data))
    && canon(adminRoute.data.solution.stops) === canon(again.data.solution.stops)
    && canon(adminRoute.data.solution.geometry) === canon(again.data.solution.geometry));
  check("the road geometry starts at the route start and ends at the last stop", (() => {
    const c = again.data.solution.geometry?.coordinates as [number, number][] | undefined;
    const last = again.data.solution.stops[again.data.solution.stops.length - 1];
    const near = (a: number, b: number) => Math.abs(a - b) < 0.002; // OSRM snaps points to the road
    return !!c && c.length > again.data.solution.stops.length && near(c[0][1], again.data.solution.start.latitude) && near(c[c.length - 1][1], last.latitude) && near(c[c.length - 1][0], last.longitude);
  })());

  // Deliveries endpoint order vs route order: the app sorts by the route's sequence.
  const seqs = again.data.solution.stops.map((s: Json) => s.sequence);
  check("stop sequence numbers are 1..n in route order", JSON.stringify(seqs) === JSON.stringify(seqs.map((_: number, i: number) => i + 1)));

  // Security: a postman cannot ask for the admin route endpoint.
  const denied = await call("GET", `/postmen/${post}/route`, { token: t });
  check("a postman cannot use the admin route endpoint (403)", denied.status === 403, denied.status);
}

async function partB() {
  console.log("\nB. A working round for Test Postman A (creates TEST-OPT-* deliveries)");
  const admin = await login(ADMIN);
  const a = await login(TEST_A).catch(() => null);
  if (!a) {
    console.log("  SKIP  Test Postman A does not exist - run `npm run db:verify -- setup` first");
    return;
  }
  const at = admin.accessToken;
  const pt = a.accessToken;
  const stamp = Date.now().toString(36).toUpperCase();

  // Beat 100's polygon is lon 72.95-72.96, lat 19.15-19.16. Two little neighbourhoods.
  const spots: [number, number][] = [
    [19.1585, 72.9515], [19.1588, 72.9520], [19.1582, 72.9512], // north-west
    [19.1512, 72.9588], [19.1516, 72.9592], [19.1509, 72.9585]  // south-east
  ];
  const created: string[] = [];
  for (const [i, [lat, lng]] of spots.entries()) {
    const r = await call("POST", "/deliveries", {
      token: at,
      body: {
        trackingId: `TEST-OPT-${stamp}-${i + 1}`, recipientName: `Opt ${stamp} Recipient ${i + 1}`, phone: "9820099900",
        addressLine1: `${i + 1} Opt Road`, area: "Bhandup West", city: "Mumbai", state: "Maharashtra", pincode: "400078",
        priority: i === 4 ? "URGENT" : "NORMAL", parcelCount: 1 + (i % 3), latitude: lat, longitude: lng
      }
    });
    if (r.status === 201 && r.data.assignedPostman?.name === "Test Postman A") created.push(r.data.id);
  }
  check("6 test deliveries were created and given to Test Postman A by PostGIS", created.length === 6, created.length);

  const r1 = await call("POST", "/me/route/reoptimize", { token: pt, body: { trigger: "MANUAL" } });
  check("route planned for the whole active set", r1.status === 201 && created.every((id) => ids(r1.data).includes(id)), r1.data?.solution?.stops?.length);
  check("full pipeline ran (not a pruned reuse)", r1.data.solution.reusedOrder === false && !("algorithm" in r1.data.solution));

  // G: a new delivery.
  const nd = await call("POST", "/deliveries", {
    token: at,
    body: { trackingId: `TEST-OPT-${stamp}-NEW`, recipientName: `Opt ${stamp} Late Arrival`, addressLine1: "9 Opt Road", area: "Bhandup West", city: "Mumbai", state: "Maharashtra", pincode: "400078", priority: "HIGH", parcelCount: 2, latitude: 19.1550, longitude: 72.9550 }
  });
  const r2 = await call("GET", "/me/route", { token: pt });
  check("G: a new delivery is in the route on the next read", ids(r2.data).includes(nd.data.id), ids(r2.data));
  check("G: adding a delivery re-runs the full pipeline", r2.data.solution.reusedOrder === false && r2.data.routeId !== r1.data.routeId);

  // F: a completed delivery.
  const before = ids(r2.data);
  // Only ever act on this run's own deliveries (Test Postman A also carries TEST001/TEST002 for db:verify).
  const mineIds = new Set<string>([...created, nd.data.id]);
  const first = before.find((id) => mineIds.has(id)) as string;
  const s1 = await call("POST", `/deliveries/${first}/status`, { token: pt, body: { status: "OUT_FOR_DELIVERY" } });
  const s2 = await call("POST", `/deliveries/${first}/status`, { token: pt, body: { status: "DELIVERED" } });
  check("the postman started and delivered the first stop", s1.status === 200 && s2.status === 200, [s1.status, s2.status]);
  const r3 = await call("GET", "/me/route", { token: pt });
  check("F: the delivered stop left the route", !ids(r3.data).includes(first));
  check("F: the remaining stops kept their order (pruned, not reshuffled)", JSON.stringify(ids(r3.data)) === JSON.stringify(before.filter((id) => id !== first)), { before: before.filter((id) => id !== first), after: ids(r3.data) });
  check("F: legs, ETAs and geometry were refreshed", r3.data.solution.reusedOrder === true && r3.data.solution.routing?.geometrySource === "ROAD" && (r3.data.solution.geometry?.coordinates?.length ?? 0) > ids(r3.data).length, r3.data.solution.routing);

  // Failure event -> full re-plan without that stop.
  const victim = ids(r3.data).filter((id) => mineIds.has(id))[1];
  await call("POST", `/deliveries/${victim}/status`, { token: pt, body: { status: "OUT_FOR_DELIVERY" } });
  const f = await call("POST", `/deliveries/${victim}/status`, { token: pt, body: { status: "RECIPIENT_UNAVAILABLE", reason: "not home" } });
  check("the postman reported the recipient unavailable", f.status === 200, f.data);
  await new Promise((r) => setTimeout(r, 1500)); // the event listener re-plans asynchronously
  const r4 = await call("GET", "/me/route", { token: pt });
  check("failure: the failed stop left the route", !ids(r4.data).includes(victim));
  check("failure: the route was re-optimized in full", r4.data.solution.reusedOrder === false && r4.data.routeId !== r3.data.routeId, r4.data.trigger);
  const r4Full = (await call("GET", `/postmen/${r4.data.solution.postmanId}/route`, { token: at })).data;
  check("  ... and is still measured (final cost <= 2-opt cost <= DBSCAN+NN cost)", r4Full.solution.metrics.totalCost <= r4Full.solution.metrics.twoOptCost + 1e-6 && r4Full.solution.metrics.twoOptCost <= r4Full.solution.metrics.dbscanNnCost + 1e-6, r4Full.solution.metrics);

  // Leave Test Postman A's round as it was: cancel what this run created (an admin action,
  // recorded in the history; nothing is deleted).
  for (const id of [...created, nd.data?.id].filter(Boolean) as string[]) {
    await call("POST", `/deliveries/${id}/status`, { token: at, body: { status: "CANCELLED", reason: "route verification cleanup" } });
  }
  const left = ((await call("GET", "/me/deliveries?pageSize=100", { token: pt })).data.rows as Json[]).filter((d) => d.trackingId.startsWith("TEST-OPT-" + stamp) && ["ASSIGNED", "OUT_FOR_DELIVERY", "RESCHEDULED"].includes(d.status));
  check("cleanup: none of this run's deliveries are still on the postman's route", left.length === 0, left.map((d) => d.trackingId));
}

async function main() {
  try {
    await partA();
    await partB();
  } catch (err) {
    failed++;
    console.log("  FAIL  script error:", err instanceof Error ? err.message : err);
  }
  console.log(`\n${failed === 0 ? "ALL PASSED" : "FAILED"}: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main();

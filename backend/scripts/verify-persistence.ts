import { requiredEnv } from "./lib/credentials";

/**
 * End-to-end persistence & synchronisation check against a RUNNING backend.
 *
 *   npm run db:verify -- setup       create the test data through the public API
 *   npm run db:verify -- verify      log in FRESH and check everything is still there
 *   npm run db:verify -- sync        reassign the beat's postman and check the phones follow
 *   npm run db:verify -- isolation   check a second post office cannot see or touch the first
 *
 * `verify` is meant to be run again after: a browser refresh (nothing to do here - it is a
 * new session every time), a BACKEND RESTART, and a log out / log in. It only ever reads.
 * It never resets or drops anything; it creates records named TEST-* / "Test ..." and reuses
 * them on re-runs.
 *
 * API_URL defaults to http://localhost:4000/api/v1
 * ADMIN_EMAIL defaults to the seeded Bhandup West admin; ADMIN_PASSWORD and SUPER_PASSWORD have no default (a signed-in account must have chosen its own password first).
 */
const API = process.env.API_URL ?? "http://localhost:4000/api/v1";
const ADMIN = { email: process.env.ADMIN_EMAIL ?? "admin.bhandup@postal.local", password: requiredEnv("ADMIN_PASSWORD", "the administrator's password") };
const SUPER = { email: process.env.SUPER_EMAIL ?? "superadmin@postal.local", password: requiredEnv("SUPER_PASSWORD", "the super administrator's password") };

// A polygon that overlaps neither seeded beat (B01 / B02).
const TEST_POLYGON = {
  type: "Polygon" as const,
  coordinates: [[[72.95, 19.15], [72.96, 19.15], [72.96, 19.16], [72.95, 19.16], [72.95, 19.15]]]
};
const INSIDE = { latitude: 19.155, longitude: 72.955 };

const POSTMAN_A = { employeeId: "TEST-PM-A", name: "Test Postman A", phone: "9820000101", email: "test.postman.a@postal.local", password: "TestPass123!" };
const POSTMAN_B = { employeeId: "TEST-PM-B", name: "Test Postman B", phone: "9820000102", email: "test.postman.b@postal.local", password: "TestPass123!" };
const BEAT = { beatNumber: "100", name: "Test Beat" };

// ── tiny harness ───────────────────────────────────────────────────────────
let failed = 0;
let passed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail !== undefined ? "  -> " + JSON.stringify(detail).slice(0, 300) : ""}`);
  }
}

async function call(method: string, path: string, opts: { token?: string; body?: unknown; form?: FormData } = {}) {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(API + path, {
    method,
    headers,
    body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined)
  });
  const text = await res.text();
  let data: any = null;
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
  return r.data as { accessToken: string; refreshToken: string; user: any };
}

const samePolygon = (a: any, b: any) =>
  a?.type === "Polygon" &&
  a.coordinates[0].length === b.coordinates[0].length &&
  a.coordinates[0].every((p: number[], i: number) => Math.abs(p[0] - b.coordinates[0][i][0]) < 1e-9 && Math.abs(p[1] - b.coordinates[0][i][1]) < 1e-9);

// ── setup ──────────────────────────────────────────────────────────────────
async function findPostman(token: string, employeeId: string) {
  const r = await call("GET", "/postmen", { token });
  return (r.data as any[]).find((p) => p.employeeId === employeeId);
}

async function ensurePostman(token: string, office: string, def: typeof POSTMAN_A) {
  let p = await findPostman(token, def.employeeId);
  if (!p) {
    const r = await call("POST", "/postmen", { token, body: { employeeId: def.employeeId, name: def.name, phone: def.phone, postOfficeId: office } });
    check(`create ${def.name}`, r.status === 201, r.data);
    p = r.data;
  }
  if (!p.account) {
    const r = await call("POST", `/postmen/${p.id}/account`, { token, body: { email: def.email, password: def.password } });
    check(`create login for ${def.name}`, r.status === 201, r.data);
  }
  return p;
}

async function setup() {
  console.log("SETUP: create the test data through the API (admin)");
  const admin = await login(ADMIN);
  const token = admin.accessToken;
  const office = admin.user.postOfficeId as string;

  const a = await ensurePostman(token, office, POSTMAN_A);
  await ensurePostman(token, office, POSTMAN_B);

  // Beat 100 + its polygon + Postman A - ONE request, one transaction.
  const beats = (await call("GET", "/beats", { token })).data as any[];
  let beat = beats.find((b) => b.beatNumber === BEAT.beatNumber);
  if (!beat) {
    const r = await call("POST", "/beats", { token, body: { ...BEAT, boundary: TEST_POLYGON, postmanId: a.id } });
    check("create Beat 100 with polygon and Postman A (one request)", r.status === 201, r.data);
    check("the response is the STORED record (has the boundary read back from PostGIS)", samePolygon(r.data.boundary, TEST_POLYGON), r.data.boundary);
    check("the response already shows the assigned postman", r.data.assignedPostmanName === POSTMAN_A.name, r.data.assignedPostmanName);
    beat = r.data;
  } else {
    console.log("  (Beat 100 already exists - reusing)");
  }

  // A delivery created directly: coordinates inside the polygon.
  const d1 = (await call("GET", "/deliveries?q=TEST001", { token })).data.rows.find((x: any) => x.trackingId === "TEST001");
  if (!d1) {
    const r = await call("POST", "/deliveries", {
      token,
      body: {
        trackingId: "TEST001", recipientName: "Test Recipient One", phone: "9820099901",
        addressLine1: "1 Test Road", area: "Bhandup West", city: "Mumbai", state: "Maharashtra", pincode: "400078",
        priority: "URGENT", parcelCount: 2, ...INSIDE
      }
    });
    check("create delivery TEST001 (POST /deliveries)", r.status === 201, r.data);
    check("TEST001 was matched to Beat 100 by PostGIS and given to Postman A", r.data.beat?.beatNumber === "100" && r.data.assignedPostman?.name === POSTMAN_A.name && r.data.status === "ASSIGNED", { beat: r.data.beat, pm: r.data.assignedPostman, st: r.data.status });
  } else {
    console.log("  (TEST001 already exists - reusing)");
  }

  // A delivery through the IMPORT flow: upload -> preview -> confirm -> (fix location) -> assigned.
  let d2 = (await call("GET", "/deliveries?q=TEST002", { token })).data.rows.find((x: any) => x.trackingId === "TEST002");
  if (!d2) {
    const csv =
      "name,phone,address,city,state,pincode,tracking_id,priority\n" +
      'Test Recipient Two,9820099902,"2 Test Lane, Bhandup West",Mumbai,Maharashtra,400078,TEST002,HIGH\n';
    const form = new FormData();
    form.append("file", new Blob([csv], { type: "text/csv" }), "test-import.csv");
    const up = await call("POST", "/imports/upload", { token, form });
    check("import: upload returns a PREVIEW (nothing is a delivery yet)", up.status === 201 && up.data.import.status === "PREVIEW_READY", up.data);
    const importId = up.data.import.id;
    check("import: the row validated as VALID", up.data.import.validRows === 1, up.data.import);
    const before = (await call("GET", "/deliveries?q=TEST002", { token })).data.rows;
    check("import: no delivery exists before the admin confirms", before.length === 0);

    const conf = await call("POST", `/imports/${importId}/confirm`, { token });
    check("import: confirm -> CONFIRMED", conf.status === 200 && conf.data.status === "CONFIRMED", conf.data);
    d2 = (await call("GET", "/deliveries?q=TEST002", { token })).data.rows.find((x: any) => x.trackingId === "TEST002");
    check("import: delivery TEST002 now exists in PostgreSQL (read back through GET /deliveries)", !!d2);
    // The address is fake; whatever the geocoder made of it, pin it inside Beat 100 by hand.
    const fix = await call("POST", `/geocoding/manual/${d2.addressId}`, { token, body: INSIDE });
    check("import: manual coordinates accepted", fix.status === 200, fix.data);
  } else {
    console.log("  (TEST002 already exists - reusing)");
  }
  console.log(`\nSETUP done. ${passed} passed, ${failed} failed.`);
}

// ── verify ─────────────────────────────────────────────────────────────────
async function verify() {
  console.log("VERIFY: a FRESH login, then read everything back from the database");

  // --- admin
  const admin = await login(ADMIN);
  const token = admin.accessToken;
  const me = await call("GET", "/auth/me", { token });
  check("admin: GET /auth/me identifies the admin", me.status === 200 && me.data.role === "ADMIN", me.data);

  const dash = await call("GET", "/dashboard/summary", { token });
  check("admin: GET /dashboard/summary works", dash.status === 200 && dash.data.cards.total >= 2, dash.data?.cards);

  const beats = (await call("GET", "/beats", { token })).data as any[];
  const beat = beats.find((b) => b.beatNumber === BEAT.beatNumber);
  check("admin: Beat 100 exists", !!beat, beats.map((b) => b.beatNumber));
  check("admin: its polygon still exists (rebuilt from PostGIS)", samePolygon(beat?.boundary, TEST_POLYGON), beat?.boundary);
  check("admin: it still shows Postman A", beat?.assignedPostmanName === POSTMAN_A.name, beat?.assignedPostmanName);
  check("admin: it counts its deliveries", beat?.deliveryCount >= 2, beat?.deliveryCount);

  const mapBeats = (await call("GET", "/maps/beats", { token })).data.features as any[];
  const mapBeat = mapBeats.find((f) => f.properties.beatNumber === BEAT.beatNumber);
  check("admin: the Map's GeoJSON returns the stored polygon", samePolygon(mapBeat?.geometry, TEST_POLYGON));

  const postmen = (await call("GET", "/postmen", { token })).data as any[];
  const pa = postmen.find((p) => p.employeeId === POSTMAN_A.employeeId);
  check("admin: Postman A exists with Beat 100 and a login", pa?.beat?.beatNumber === "100" && pa?.account?.email === POSTMAN_A.email, pa);

  const list = (await call("GET", "/deliveries?q=TEST00", { token })).data.rows as any[];
  for (const t of ["TEST001", "TEST002"]) {
    const d = list.find((x) => x.trackingId === t);
    check(`admin: ${t} exists`, !!d);
    check(`admin: ${t} has beat 100, Postman A, status ASSIGNED, and a priority`, d?.beat?.beatNumber === "100" && d?.assignedPostman?.name === POSTMAN_A.name && d?.status === "ASSIGNED" && !!d?.priority, d && { beat: d.beat, pm: d.assignedPostman, st: d.status, pr: d.priority });
  }
  check("admin: TEST001 kept priority URGENT", list.find((x) => x.trackingId === "TEST001")?.priority === "URGENT");
  check("admin: TEST001 kept its address", list.find((x) => x.trackingId === "TEST001")?.address?.addressLine1 === "1 Test Road");
  const imports = (await call("GET", "/imports", { token })).data as any[];
  check("admin: the import history still lists the CSV import", imports.some((i) => i.originalFilename === "test-import.csv" && i.status === "CONFIRMED"));
  check("admin: GET /assignments/exceptions works", (await call("GET", "/assignments/exceptions", { token })).status === 200);
  check("admin: GET /vehicles works", (await call("GET", "/vehicles", { token })).status === 200);

  // --- postman A, "from another device": a brand-new session
  const pm = await login({ email: POSTMAN_A.email, password: POSTMAN_A.password });
  const pt = pm.accessToken;
  const pme = await call("GET", "/auth/me", { token: pt });
  check("postman A: GET /auth/me -> POSTMAN linked to a profile", pme.data.role === "POSTMAN" && !!pme.data.postmanId, pme.data);
  const profile = await call("GET", "/me/profile", { token: pt });
  check("postman A: GET /me/profile -> name, employee id, phone", profile.data.postman?.name === POSTMAN_A.name && profile.data.postman?.employeeId === POSTMAN_A.employeeId && !!profile.data.postman?.phone, profile.data.postman);
  check("postman A: GET /me/profile -> assigned Beat 100 (Test Beat)", profile.data.beat?.beatNumber === "100" && profile.data.beat?.name === "Test Beat", profile.data.beat);
  const mine = await call("GET", "/me/deliveries", { token: pt });
  // (route-verification runs add TEST-OPT-* deliveries to this postman; only TEST001/TEST002 belong to this check)
  const mineIds = (mine.data.rows as any[]).map((d) => d.trackingId).filter((t: string) => /^TEST00\d$/.test(t)).sort();
  check("postman A: GET /me/deliveries -> exactly TEST001 and TEST002", JSON.stringify(mineIds) === JSON.stringify(["TEST001", "TEST002"]), mineIds);
  const t1 = (mine.data.rows as any[]).find((d) => d.trackingId === "TEST001");
  check("postman A: TEST001 carries recipient, address, priority and status from the server", t1?.recipient?.name === "Test Recipient One" && t1?.address?.addressLine1 === "1 Test Road" && t1?.priority === "URGENT" && t1?.status === "ASSIGNED", t1 && { r: t1.recipient?.name, p: t1.priority, s: t1.status });
  const stats = await call("GET", "/me/stats", { token: pt });
  check("postman A: GET /me/stats", stats.status === 200 && stats.data.today.remaining >= 2, stats.data);
  const route = await call("GET", "/me/route", { token: pt });
  const stopIds = (route.data.solution?.stops ?? []).length;
  check("postman A: GET /me/route -> a route with both stops", route.status === 200 && stopIds === 2, route.data.solution?.stops?.length ?? route.data);

  // --- isolation as postman A
  check("postman A: cannot list the office's deliveries (403)", (await call("GET", "/deliveries", { token: pt })).status === 403);
  check("postman A: cannot list postmen or beats (403)", (await call("GET", "/postmen", { token: pt })).status === 403 && (await call("GET", "/beats", { token: pt })).status === 403);
  const others = (await call("GET", "/deliveries?pageSize=100", { token })).data.rows.find((d: any) => d.assignedPostman && d.assignedPostman.name !== POSTMAN_A.name);
  if (others) {
    check("postman A: another postman's delivery is not found (404)", (await call("GET", `/deliveries/${others.id}`, { token: pt })).status === 404);
    check("postman A: cannot change another postman's delivery (404)", (await call("POST", `/deliveries/${others.id}/status`, { token: pt, body: { status: "OUT_FOR_DELIVERY" } })).status === 404);
  }
  const spoof = await call("GET", `/me/deliveries?postmanId=${others?.assignedPostmanId ?? "x"}`, { token: pt });
  check("postman A: naming another postman in the request changes nothing", (spoof.data.rows as any[]).every((d) => d.assignedPostmanId === pa.id), (spoof.data.rows as any[]).map((d) => d.assignedPostmanId));

  console.log(`\nVERIFY done. ${passed} passed, ${failed} failed.`);
}

// ── sync: admin changes something, the postmen's phones follow ─────────────
async function sync() {
  console.log("SYNC: change the beat's postman as the admin; both postmen re-read from the server");
  const admin = await login(ADMIN);
  const token = admin.accessToken;
  const beat = ((await call("GET", "/beats", { token })).data as any[]).find((b) => b.beatNumber === BEAT.beatNumber);
  const pa = await findPostman(token, POSTMAN_A.employeeId);
  const pb = await findPostman(token, POSTMAN_B.employeeId);
  const sessA = await login({ email: POSTMAN_A.email, password: POSTMAN_A.password });
  const sessB = await login({ email: POSTMAN_B.email, password: POSTMAN_B.password });
  const ids = async (t: string) => ((await call("GET", "/me/deliveries", { token: t })).data.rows as any[]).map((d) => d.trackingId as string).filter((t) => /^TEST00\d$/.test(t)).sort();

  // Start from a known state: Postman A covers the beat.
  await call("POST", `/beats/${beat.id}/assign-postman`, { token, body: { postmanId: pa.id } });
  check("before: A has TEST001 + TEST002, B has none", JSON.stringify(await ids(sessA.accessToken)) === '["TEST001","TEST002"]' && (await ids(sessB.accessToken)).length === 0);

  // Beat 100: A -> B
  const r = await call("POST", `/beats/${beat.id}/assign-postman`, { token, body: { postmanId: pb.id } });
  check("admin: assign Beat 100 to Postman B", r.status === 201 && r.data.assignedPostmanName === POSTMAN_B.name, r.data);
  check("A: /me/deliveries no longer contains Beat 100's parcels", (await ids(sessA.accessToken)).length === 0, await ids(sessA.accessToken));
  check("B: /me/deliveries now has TEST001 + TEST002", JSON.stringify(await ids(sessB.accessToken)) === '["TEST001","TEST002"]', await ids(sessB.accessToken));
  check("A: /me/profile no longer has a beat", (await call("GET", "/me/profile", { token: sessA.accessToken })).data.beat === null);
  check("B: /me/profile now has Beat 100", (await call("GET", "/me/profile", { token: sessB.accessToken })).data.beat?.beatNumber === "100");
  check("A: /me/route is empty", (await call("GET", "/me/route", { token: sessA.accessToken })).data.route === null);
  const rb = await call("GET", "/me/route", { token: sessB.accessToken });
  check("B: /me/route now contains both stops", (rb.data.solution?.stops ?? []).length === 2);

  // Clearing the beat's postman releases the parcels to the admin's queue.
  await call("POST", `/beats/${beat.id}/assign-postman`, { token, body: { postmanId: null } });
  check("clear: B has no deliveries", (await ids(sessB.accessToken)).length === 0);
  const exc = (await call("GET", "/assignments/exceptions", { token })).data as any[];
  check("clear: the parcels appear as NO_POSTMAN_ASSIGNED exceptions for the admin", exc.filter((e) => ["TEST001", "TEST002"].includes(e.delivery.trackingId) && e.reason === "NO_POSTMAN_ASSIGNED").length === 2, exc.length);

  // Back to Postman A: exceptions close by themselves.
  await call("POST", `/beats/${beat.id}/assign-postman`, { token, body: { postmanId: pa.id } });
  check("restore: A has TEST001 + TEST002 again", JSON.stringify(await ids(sessA.accessToken)) === '["TEST001","TEST002"]');
  const exc2 = (await call("GET", "/assignments/exceptions", { token })).data as any[];
  check("restore: the NO_POSTMAN_ASSIGNED exceptions closed themselves", exc2.filter((e) => ["TEST001", "TEST002"].includes(e.delivery.trackingId)).length === 0, exc2.length);

  // Status flows through the same rules.
  const d1 = (await ids(sessA.accessToken)).includes("TEST001") && ((await call("GET", "/me/deliveries", { token: sessA.accessToken })).data.rows as any[]).find((d) => d.trackingId === "TEST001");
  const bad = await call("POST", `/deliveries/${d1.id}/status`, { token: sessA.accessToken, body: { status: "DELIVERED" } });
  check("postman A: ASSIGNED -> DELIVERED is refused by the server", bad.status === 400, bad.data);

  // Deactivating a postman disables the login too.
  await call("POST", `/postmen/${pb.id}/deactivate`, { token });
  check("deactivated postman B can no longer read /me/profile", (await call("GET", "/me/profile", { token: sessB.accessToken })).status === 401);
  const relog = await call("POST", "/auth/login", { body: { email: POSTMAN_B.email, password: POSTMAN_B.password } });
  check("deactivated postman B can no longer log in", relog.status === 401, relog.status);
  await call("POST", `/postmen/${pb.id}/activate`, { token });
  check("reactivated postman B can log in again", (await call("POST", "/auth/login", { body: { email: POSTMAN_B.email, password: POSTMAN_B.password } })).status === 200);

  console.log(`\nSYNC done. ${passed} passed, ${failed} failed.`);
}

// ── isolation between post offices ─────────────────────────────────────────
async function isolation() {
  console.log("ISOLATION: an admin of a second post office must not see or touch the first");
  const sup = await login(SUPER);
  const admin1 = await login(ADMIN);

  const offices = (await call("GET", "/post-offices", { token: sup.accessToken })).data as any[];
  let office2 = offices.find((o) => o.code === "TEST-PO-2");
  if (!office2) {
    const r = await call("POST", "/post-offices", {
      token: sup.accessToken,
      body: { code: "TEST-PO-2", name: "Test Post Office 2", addressLine: "Test", city: "Mumbai", state: "Maharashtra", pincode: "400001", latitude: 18.94, longitude: 72.83 }
    });
    check("super admin creates a second post office", r.status === 201, r.data);
    office2 = r.data;
  }
  const users = (await call("GET", "/users", { token: sup.accessToken })).data as any[];
  if (!users.some((u) => u.email === "test.admin2@postal.local")) {
    const r = await call("POST", "/users", { token: sup.accessToken, body: { name: "Test Admin 2", email: "test.admin2@postal.local", password: "TestPass123!", role: "ADMIN", postOfficeId: office2.id } });
    check("super admin creates the second office's admin", r.status === 201, r.data);
  }
  const admin2 = await login({ email: "test.admin2@postal.local", password: "TestPass123!" });
  const t2 = admin2.accessToken;

  const beat1 = ((await call("GET", "/beats", { token: admin1.accessToken })).data as any[]).find((b) => b.beatNumber === BEAT.beatNumber);
  const d1 = (await call("GET", "/deliveries?q=TEST001", { token: admin1.accessToken })).data.rows[0];
  const pa = await findPostman(admin1.accessToken, POSTMAN_A.employeeId);

  check("admin 2: sees none of office 1's beats", ((await call("GET", "/beats", { token: t2 })).data as any[]).every((b) => b.postOfficeId === office2.id));
  check("admin 2: sees none of office 1's deliveries", (await call("GET", "/deliveries?pageSize=100", { token: t2 })).data.rows.length === 0);
  check("admin 2: sees none of office 1's postmen", ((await call("GET", "/postmen", { token: t2 })).data as any[]).every((p) => p.postOffice.id === office2.id));
  check("admin 2: GET office 1's beat by id -> 404", (await call("GET", `/beats/${beat1.id}`, { token: t2 })).status === 404);
  check("admin 2: GET office 1's delivery by id -> 404", (await call("GET", `/deliveries/${d1.id}`, { token: t2 })).status === 404);
  check("admin 2: GET office 1's postman by id -> 404", (await call("GET", `/postmen/${pa.id}`, { token: t2 })).status === 404);
  check("admin 2: GET office 1's post office record -> 404", (await call("GET", `/post-offices/${admin1.user.postOfficeId}`, { token: t2 })).status === 404);
  check("admin 2: cannot reassign office 1's delivery", (await call("POST", `/deliveries/${d1.id}/reassign`, { token: t2, body: { postmanId: pa.id, reason: "attack" } })).status === 404);
  check("admin 2: cannot change office 1's delivery status", (await call("POST", `/deliveries/${d1.id}/status`, { token: t2, body: { status: "CANCELLED" } })).status === 404);
  check("admin 2: cannot assign office 1's postman to a beat", (await call("POST", `/beats/${beat1.id}/assign-postman`, { token: t2, body: { postmanId: pa.id } })).status === 404);
  check("admin 2: cannot create a beat in office 1", (await call("POST", "/beats", { token: t2, body: { ...BEAT, beatNumber: "X1", postOfficeId: admin1.user.postOfficeId, boundary: TEST_POLYGON } })).status === 403);
  check("admin 2: cannot create a postman in office 1", (await call("POST", "/postmen", { token: t2, body: { employeeId: "EVIL", name: "x", phone: "9999999999", postOfficeId: admin1.user.postOfficeId } })).status === 403);
  check("admin 2: cannot change office 1's postman", (await call("PUT", `/postmen/${pa.id}`, { token: t2, body: { name: "hacked" } })).status === 404);
  const audit = (await call("GET", "/audit-logs?pageSize=200", { token: t2 })).data.rows as any[];
  check("admin 2: the audit log shows nothing done in office 1", audit.every((a) => !a.user || a.user.email === "test.admin2@postal.local"), audit.length);
  check("admin 2: dashboard counts only office 2 (no office 1 deliveries)", (await call("GET", "/dashboard/summary", { token: t2 })).data.cards.total === 0);
  const cross = await call("POST", "/postmen", { token: sup.accessToken, body: { employeeId: "TEST-PM-X", name: "Cross", phone: "9820000199", postOfficeId: office2.id } });
  if (cross.status === 201) {
    check("super admin: cannot link a postman of office 2 to a beat of office 1", (await call("POST", `/beats/${beat1.id}/assign-postman`, { token: sup.accessToken, body: { postmanId: cross.data.id } })).status === 400);
  }

  console.log(`\nISOLATION done. ${passed} passed, ${failed} failed.`);
}

async function main() {
  const phase = process.argv[2] ?? "verify";
  const phases: Record<string, () => Promise<void>> = { setup, verify, sync, isolation };
  if (!phases[phase]) {
    console.error(`Unknown phase "${phase}". Use: setup | verify | sync | isolation`);
    process.exit(2);
  }
  await phases[phase]();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("ERROR", err);
  process.exit(2);
});

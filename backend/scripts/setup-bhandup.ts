/**
 * Sets the system up with the Bhandup West data set in backend/data/bhandup/ (see build_data.py there).
 *
 *   npx tsx scripts/setup-bhandup.ts init        an EMPTY database: the post office and the administrator (ADMIN_PASSWORD)
 *   npx tsx scripts/setup-bhandup.ts wipe        remove ALL operational data (deliveries, beats, postmen, their
 *                                                logins, imports, routes, audit trail, uploads). Keeps the schema,
 *                                                the post offices and the ADMIN / SUPER_ADMIN logins.
 *   npx tsx scripts/setup-bhandup.ts beats       26 beats + their locality directory through the beat-import API
 *                                                (inferred territories stay unverified), then 26 postmen with logins
 *   npx tsx scripts/setup-bhandup.ts deliveries  the 130 deliveries through the real import (geocoding + PostGIS
 *                                                beat matching), exactly as an administrator would run it
 *
 * The backend must be running (API_URL, default http://localhost:4000/api/v1) for `beats`.
 * Take a database backup (pg_dump) before `wipe`: it is not reversible.
 */
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../src/config/prisma";
import { confirmImport, createImportWithPreview } from "../src/services/imports/import.service";
import { randomPassword, requiredEnv } from "./lib/credentials";

const API = process.env.API_URL ?? "http://localhost:4000/api/v1";
const DATA = path.join(__dirname, "..", "data", "bhandup");
const ADMIN = { email: process.env.ADMIN_EMAIL ?? "admin.bhandup@postal.local", get password() { return requiredEnv("ADMIN_PASSWORD", "the administrator's password"); } };
/** Margin added around a beat's anchors' bounding box, and the half-side of the square used when a beat has only one anchor. */
const TERRITORY_MARGIN_M = 150;
const TERRITORY_MIN_HALF_SIDE_M = 180;

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────────────────
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

async function call(method: string, p: string, token?: string, body?: unknown, form?: FormData) {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(API + p, { method, headers, body: form ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status} ${typeof data === "string" ? data : JSON.stringify(data).slice(0, 300)}`);
  return data;
}
async function officeOfAdmin() {
  const admin = await prisma.user.findFirstOrThrow({ where: { email: ADMIN.email }, select: { postOfficeId: true } });
  return prisma.postOffice.findUniqueOrThrow({ where: { id: admin.postOfficeId! } });
}
async function login() {
  const r = await call("POST", "/auth/login", undefined, ADMIN);
  return r.accessToken as string;
}

// ── wipe ─────────────────────────────────────────────────────────────────────────────────────────────────────
async function wipe() {
  const before = await counts();
  console.log("before:", JSON.stringify(before));
  const order = [
    "DeliveryStatusHistory", "DeliveryAttempt", "DeliveryAssignmentHistory", "AssignmentException", "RouteStop", "RouteEvent",
    "Route", "OptimizationResult", "OptimizationRequest", "Delivery", "DeliveryImportRow", "DeliveryImport", "BeatImport",
    "Address", "Recipient", "PostmanLocationHistory", "PostmanBeatAssignment", "Notification", "AuditLog", "RefreshToken",
    "VehicleBatteryLog", "Vehicle"
  ];
  await prisma.$transaction(async (tx) => {
    for (const t of order) await tx.$executeRawUnsafe(`DELETE FROM "${t}"`);
    await tx.$executeRawUnsafe(`DELETE FROM "User" WHERE role = 'POSTMAN'`);
    await tx.$executeRawUnsafe(`UPDATE "User" SET "postmanId" = NULL`);
    await tx.$executeRawUnsafe(`DELETE FROM "Postman"`);
    await tx.$executeRawUnsafe(`DELETE FROM "Beat"`);
    // Leftovers of the earlier isolation tests: a second post office and its administrator.
    await tx.$executeRawUnsafe(`DELETE FROM "User" WHERE email = 'test.admin2@postal.local'`);
    await tx.$executeRawUnsafe(`DELETE FROM "PostOffice" WHERE code = 'TEST-PO-2'`);
  });
  // Uploaded files that belonged to the removed rows (profile photos, held import files).
  for (const dir of ["profile", "tmp", "rejected"]) {
    const d = path.join(__dirname, "..", "uploads", dir);
    if (fs.existsSync(d)) for (const f of fs.readdirSync(d)) if (f !== ".gitkeep") fs.rmSync(path.join(d, f), { recursive: true, force: true });
  }
  console.log("after: ", JSON.stringify(await counts()));
}
async function counts() {
  const out: Record<string, number> = {};
  for (const t of ["User", "PostOffice", "Beat", "Postman", "Delivery", "Address", "Recipient", "AuditLog", "DeliveryImport", "OptimizationRequest"]) {
    out[t] = Number((await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${t}"`))[0].n);
  }
  return out;
}

// ── beats + postmen ──────────────────────────────────────────────────────────────────────────────────────────
type Anchor = { lat: number; lng: number; osmName: string; osm: string };

/** Which OSM anchors describe a beat: a locality that contains the anchor's key, plus a few landmarks named in the supplied lists. */
const LANDMARK_BEATS: Record<string, number[]> = {
  "RUNWAL FOREST": [1], "BHANDUP STATION": [3], "BHANDUP POLICE STATION": [6, 25], "KANJUR STATION ROAD": [23],
  "FORTIS HOSPITAL": [24], "RUNWAL GREEN": [24], "NAVAL / NCH": [22]
};

function beatAnchors(beat: number, localities: string[], anchors: Record<string, Anchor>): { key: string; a: Anchor }[] {
  const found = new Map<string, Anchor>();
  for (const [key, a] of Object.entries(anchors)) {
    if (LANDMARK_BEATS[key]) { if (LANDMARK_BEATS[key].includes(beat)) found.set(key, a); continue; }
    if (localities.some((l) => l.toUpperCase().startsWith(key) || l.toUpperCase().includes(key))) found.set(key, a);
  }
  return [...found].map(([key, a]) => ({ key, a }));
}

/**
 * An axis-aligned rectangle (never a circle) around the beat's anchors: the bounding box of the points,
 * expanded by a margin. A single anchor - the common case, since only a few landmarks are matched per
 * beat - gets a small square around it instead of a degenerate point. Plain geometry, no PostGIS round trip.
 */
function territoryWkt(points: { lat: number; lng: number }[]): string {
  const lat0 = points[0].lat;
  const mLat = (m: number) => m / 111_320;
  const mLng = (m: number, lat: number) => m / (111_320 * Math.cos((lat * Math.PI) / 180));

  let minLat: number, maxLat: number, minLng: number, maxLng: number;
  if (points.length === 1) {
    const dLat = mLat(TERRITORY_MIN_HALF_SIDE_M);
    const dLng = mLng(TERRITORY_MIN_HALF_SIDE_M, lat0);
    minLat = lat0 - dLat; maxLat = lat0 + dLat;
    minLng = points[0].lng - dLng; maxLng = points[0].lng + dLng;
  } else {
    const dLat = mLat(TERRITORY_MARGIN_M);
    const dLng = mLng(TERRITORY_MARGIN_M, lat0);
    minLat = Math.min(...points.map((p) => p.lat)) - dLat;
    maxLat = Math.max(...points.map((p) => p.lat)) + dLat;
    minLng = Math.min(...points.map((p) => p.lng)) - dLng;
    maxLng = Math.max(...points.map((p) => p.lng)) + dLng;
  }
  const ring: [number, number][] = [[minLng, minLat], [maxLng, minLat], [maxLng, maxLat], [minLng, maxLat], [minLng, minLat]];
  return `POLYGON((${ring.map(([lng, lat]) => `${lng} ${lat}`).join(", ")}))`;
}

async function beats() {
  const po = await officeOfAdmin();
  const anchors: Record<string, Anchor> = JSON.parse(fs.readFileSync(path.join(DATA, "locality-anchors.json"), "utf8"));
  const dir = parseCsv(fs.readFileSync(path.join(DATA, "beat-directory.csv"), "utf8")).slice(1);
  const byBeat = new Map<number, Set<string>>();
  for (const r of dir) {
    const n = Number(r[2]);
    if (!byBeat.has(n)) byBeat.set(n, new Set());
    byBeat.get(n)!.add(r[3]);
  }

  // 1. the beat-import file, one row per (beat, locality, main area) - the structured beat list. The territory (WKT; empty =
  //    none known) is given once per beat, on its first row.
  const lines = ["Beat No,Beat Name,Post Office,Locality,Main Area,Pincode,Boundary"];
  const plan: { beat: number; localities: string[]; anchors: { key: string; a: Anchor }[] }[] = [];
  const wktOf = new Map<number, string>();
  for (const n of [...byBeat.keys()].sort((a, b) => a - b)) {
    const localities = [...byBeat.get(n)!];
    const an = beatAnchors(n, localities, anchors);
    plan.push({ beat: n, localities, anchors: an });
    wktOf.set(n, an.length ? territoryWkt(an.map((x) => x.a)) : "");
  }
  const written = new Set<number>();
  for (const r of dir) {
    const n = Number(r[2]);
    const boundary = written.has(n) ? "" : wktOf.get(n) ?? "";
    written.add(n);
    const name = `Beat ${n} - ${[...byBeat.get(n)!][0]}`;
    lines.push([String(n), name, po.name, r[3], r[4] ?? "", r[5] ?? "", boundary].map(csvCell).join(","));
  }
  const importFile = path.join(DATA, "beats-import-generated.csv");
  fs.writeFileSync(importFile, lines.join("\n"));
  console.log(`beat file written: ${plan.length} beats, ${dir.length} locality rows, ${plan.filter((p) => p.anchors.length).length} with an inferred territory`);

  const token = await login();
  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(importFile)], { type: "text/csv" }), "beats-import-generated.csv");
  const held = await call("POST", "/beats/import", token, undefined, form);
  const importId = held.import?.id ?? held.id;
  const confirmed = await call("POST", `/beats/import/${importId}/confirm`, token, {});
  console.log("beat import:", JSON.stringify(confirmed).slice(0, 300));

  // 2. keep how each territory was inferred with the beat. They stay PENDING_VERIFICATION: an OpenStreetMap-anchor hull is a
  //    starting point for an administrator to check on the map, not a surveyed boundary, so nothing here verifies it.
  const all = await prisma.beat.findMany({ where: { postOfficeId: po.id }, select: { id: true, beatNumber: true } });
  for (const b of all) {
    const p = plan.find((x) => String(x.beat) === b.beatNumber)!;
    await prisma.beat.update({
      where: { id: b.id },
      data: {
        metadata: {
          setNo: 1,
          localities: p.localities,
          territorySource: p.anchors.length
            ? { method: `bounding rectangle around ${p.anchors.length} OpenStreetMap anchor(s) - inferred, not surveyed`, anchors: p.anchors.map((x) => ({ key: x.key, osm: x.a.osm, name: x.a.osmName, lat: x.a.lat, lng: x.a.lng })) }
            : { method: "none - no OpenStreetMap anchor found for any locality of this beat" }
        }
      }
    });
  }
  const pending = await prisma.beat.count({ where: { postOfficeId: po.id, verificationStatus: "PENDING_VERIFICATION" } });
  console.log(`${all.length} beats created (${await prisma.beatLocality.count({ where: { postOfficeId: po.id } })} locality records), ${pending} with an inferred territory awaiting verification, ${all.length - pending} need a territory drawn`);

  // 3. one postman per beat, with a login, assigned to the beat
  const first = ["Ramesh", "Sunil", "Anil", "Prakash", "Deepak", "Sanjay", "Vijay", "Mahesh", "Ganesh", "Suresh", "Dinesh", "Manoj", "Ashok",
    "Rajesh", "Santosh", "Nitin", "Umesh", "Pravin", "Sachin", "Yogesh", "Amit", "Kiran", "Naresh", "Balaji", "Harish", "Jitendra"];
  const last = ["Kadam", "Pawar", "Sawant", "Gaikwad", "More", "Shinde", "Jadhav", "Bhosale", "Kamble", "Salvi", "Mane", "Chavan", "Dalvi",
    "Naik", "Patil", "Rane", "Sutar", "Tambe", "Wagh", "Yadav", "Ghadge", "Bane", "Dhuri", "Gawde", "Khot", "Lad"];
  const pmByBeat: string[] = [];
  const credentials: string[] = [];
  for (const b of all.sort((a, c) => Number(a.beatNumber) - Number(c.beatNumber))) {
    const i = Number(b.beatNumber);
    const nn = String(i).padStart(2, "0");
    const created = await call("POST", "/postmen", token, {
      employeeId: `BW-PM-${nn}`, name: `${first[i - 1]} ${last[i - 1]}`, phone: `97000000${nn}`, email: `beat${nn}.postman@postal.local`, address: "Bhandup West, Mumbai 400078"
    });
    // A random temporary password per postman; the postman must choose their own at first sign-in.
    const temporary = randomPassword();
    credentials.push(`beat${nn}.postman@postal.local  ${temporary}`);
    await call("POST", `/postmen/${created.id}/account`, token, { email: `beat${nn}.postman@postal.local`, password: temporary });
    await call("POST", `/postmen/${created.id}/assign-beat`, token, { beatId: b.id });
    pmByBeat.push(`Beat ${nn}: ${first[i - 1]} ${last[i - 1]}  beat${nn}.postman@postal.local`);
  }
  const credentialsFile = path.join(DATA, "credentials.local.txt");
  fs.writeFileSync(credentialsFile, `Temporary passwords (each postman must change theirs at first sign-in). Local file, never commit.\n${credentials.join("\n")}\n`, { mode: 0o600 });
  console.log("postmen created:\n  " + pmByBeat.join("\n  ") + `\n  (temporary passwords written to ${credentialsFile})`);
}

// ── deliveries: the real import pipeline ──────────────────────────────────────────────────────────────────────
async function deliveries() {
  process.env.NOMINATIM_USER_AGENT ??= "postal-admin-research/1.0 (set NOMINATIM_USER_AGENT or OSM_CONTACT to your contact)";
  const po = await officeOfAdmin();
  const admin = await prisma.user.findFirstOrThrow({ where: { email: ADMIN.email } });
  const file = path.join(DATA, "deliveries.csv");
  const stored = `bhandup-${Date.now()}.csv`;
  const dest = path.join(__dirname, "..", "uploads", "tmp", stored);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);
  const preview = await createImportWithPreview({
    postOfficeId: po.id, uploadedById: admin.id, originalFilename: "deliveries.csv", storedFilename: stored, fileType: "CSV", filePath: dest
  });
  console.log("preview:", JSON.stringify({ id: preview.import.id, mapping: (preview as any).mapping ?? (preview.import as any).columnMapping, total: (preview.import as any).totalRows }).slice(0, 500));
  const t0 = Date.now();
  const result = await confirmImport(preview.import.id, admin.id);
  console.log(`confirmed in ${Math.round((Date.now() - t0) / 1000)} s:`, JSON.stringify(result).slice(0, 400));
}

// ── init: a brand-new database gets the post office and the administrator (nothing is deleted) ──────────────────
async function init() {
  const existing = await prisma.postOffice.count();
  if (existing > 0) throw new Error("This database already has a post office; init only prepares an EMPTY database.");
  const argon2 = (await import("argon2")).default;
  const office = await prisma.postOffice.create({
    data: { code: "MUM-BHW-400078", name: "Bhandup West Post Office", addressLine: "Bhandup West, near LBS Marg", city: "Mumbai", state: "Maharashtra", pincode: "400078", latitude: 19.1436, longitude: 72.9345 }
  });
  await prisma.user.create({
    data: { email: ADMIN.email, name: "Bhandup West Admin", role: "ADMIN", postOfficeId: office.id, passwordHash: await argon2.hash(ADMIN.password, { type: argon2.argon2id }) }
  });
  console.log(`initialised: ${office.name}, administrator ${ADMIN.email} (password from ADMIN_PASSWORD)`);
}

async function main() {
  const cmd = process.argv[2];
  if (cmd === "wipe") await wipe();
  else if (cmd === "init") await init();
  else if (cmd === "beats") await beats();
  else if (cmd === "deliveries") await deliveries();
  else console.log("usage: setup-bhandup.ts init | wipe | beats | deliveries");
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });

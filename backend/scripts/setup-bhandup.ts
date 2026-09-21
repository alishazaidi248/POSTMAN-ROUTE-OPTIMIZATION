/**
 * Sets the system up with the Bhandup West data set in backend/data/bhandup/ (see build_data.py there).
 *
 *   npx tsx scripts/setup-bhandup.ts wipe        remove ALL operational data (deliveries, beats, postmen, their
 *                                                logins, imports, routes, audit trail, uploads). Keeps the schema,
 *                                                the post offices and the ADMIN / SUPER_ADMIN logins.
 *   npx tsx scripts/setup-bhandup.ts beats       26 beats through the beat-import API (territory from OpenStreetMap
 *                                                anchors, verified), then 26 postmen with logins, one per beat
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

const API = process.env.API_URL ?? "http://localhost:4000/api/v1";
const DATA = path.join(__dirname, "..", "data", "bhandup");
const ADMIN = { email: process.env.ADMIN_EMAIL ?? "admin.bhandup@postal.local", password: process.env.ADMIN_PASSWORD ?? "ChangeMe123!" };
const POSTMAN_PASSWORD = "ChangeMe123!";
const TERRITORY_RADIUS_M = 350;

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

async function territoryWkt(points: { lat: number; lng: number }[]): Promise<string> {
  const values = points.map((p) => `(${p.lng}, ${p.lat})`).join(",");
  const rows = await prisma.$queryRawUnsafe<{ wkt: string }[]>(
    `SELECT ST_AsText(ST_Multi(ST_Buffer(ST_ConvexHull(ST_Collect(ST_SetSRID(ST_MakePoint(x, y), 4326)))::geography, ${TERRITORY_RADIUS_M})::geometry)) AS wkt
     FROM (VALUES ${values}) AS t(x, y)`
  );
  // a Polygon (not a MultiPolygon) is what the beat table stores
  return rows[0].wkt.replace(/^MULTIPOLYGON\(\((.*)\)\)$/s, "POLYGON($1)");
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

  // 1. the beat-import file: Beat No, Beat Name, Post Office, Boundary (WKT; empty = no territory known)
  const lines = ["Beat No,Beat Name,Post Office,Boundary"];
  const plan: { beat: number; localities: string[]; anchors: { key: string; a: Anchor }[] }[] = [];
  for (const n of [...byBeat.keys()].sort((a, b) => a - b)) {
    const localities = [...byBeat.get(n)!];
    const an = beatAnchors(n, localities, anchors);
    plan.push({ beat: n, localities, anchors: an });
    const wkt = an.length ? await territoryWkt(an.map((x) => x.a)) : "";
    const name = `Beat ${n} - ${localities[0]}`;
    lines.push([String(n), name, po.name, wkt].map(csvCell).join(","));
  }
  const importFile = path.join(DATA, "beats-import-generated.csv");
  fs.writeFileSync(importFile, lines.join("\n"));
  console.log(`beat file written: ${plan.length} beats, ${plan.filter((p) => p.anchors.length).length} with a territory`);

  const token = await login();
  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(importFile)], { type: "text/csv" }), "beats-import-generated.csv");
  const held = await call("POST", "/beats/import", token, undefined, form);
  const importId = held.import?.id ?? held.id;
  const confirmed = await call("POST", `/beats/import/${importId}/confirm`, token, {});
  console.log("beat import:", JSON.stringify(confirmed).slice(0, 300));

  // 2. verify the beats that have a territory (an audited administrator action), and keep the directory with the beat
  const all = await prisma.beat.findMany({ where: { postOfficeId: po.id }, select: { id: true, beatNumber: true } });
  let verified = 0;
  for (const b of all) {
    const p = plan.find((x) => String(x.beat) === b.beatNumber)!;
    await prisma.beat.update({
      where: { id: b.id },
      data: {
        metadata: {
          setNo: 1,
          localities: p.localities,
          territorySource: p.anchors.length
            ? { method: `convex hull of ${p.anchors.length} OpenStreetMap anchor(s), buffered ${TERRITORY_RADIUS_M} m`, anchors: p.anchors.map((x) => ({ key: x.key, osm: x.a.osm, name: x.a.osmName, lat: x.a.lat, lng: x.a.lng })) }
            : { method: "none - no OpenStreetMap anchor found for any locality of this beat" }
        }
      }
    });
    if (p.anchors.length) { await call("POST", `/beats/${b.id}/verify`, token, {}); verified++; }
  }
  console.log(`${all.length} beats created, ${verified} verified, ${all.length - verified} need a territory drawn`);

  // 3. one postman per beat, with a login, assigned to the beat
  const first = ["Ramesh", "Sunil", "Anil", "Prakash", "Deepak", "Sanjay", "Vijay", "Mahesh", "Ganesh", "Suresh", "Dinesh", "Manoj", "Ashok",
    "Rajesh", "Santosh", "Nitin", "Umesh", "Pravin", "Sachin", "Yogesh", "Amit", "Kiran", "Naresh", "Balaji", "Harish", "Jitendra"];
  const last = ["Kadam", "Pawar", "Sawant", "Gaikwad", "More", "Shinde", "Jadhav", "Bhosale", "Kamble", "Salvi", "Mane", "Chavan", "Dalvi",
    "Naik", "Patil", "Rane", "Sutar", "Tambe", "Wagh", "Yadav", "Ghadge", "Bane", "Dhuri", "Gawde", "Khot", "Lad"];
  const pmByBeat: string[] = [];
  for (const b of all.sort((a, c) => Number(a.beatNumber) - Number(c.beatNumber))) {
    const i = Number(b.beatNumber);
    const nn = String(i).padStart(2, "0");
    const created = await call("POST", "/postmen", token, {
      employeeId: `BW-PM-${nn}`, name: `${first[i - 1]} ${last[i - 1]}`, phone: `97000000${nn}`, email: `beat${nn}.postman@postal.local`, address: "Bhandup West, Mumbai 400078"
    });
    await call("POST", `/postmen/${created.id}/account`, token, { email: `beat${nn}.postman@postal.local`, password: POSTMAN_PASSWORD });
    await call("POST", `/postmen/${created.id}/assign-beat`, token, { beatId: b.id });
    pmByBeat.push(`Beat ${nn}: ${first[i - 1]} ${last[i - 1]}  beat${nn}.postman@postal.local`);
  }
  console.log("postmen created:\n  " + pmByBeat.join("\n  ") + `\n  (password for all: ${POSTMAN_PASSWORD})`);
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

async function main() {
  const cmd = process.argv[2];
  if (cmd === "wipe") await wipe();
  else if (cmd === "beats") await beats();
  else if (cmd === "deliveries") await deliveries();
  else console.log("usage: setup-bhandup.ts wipe | beats | deliveries");
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });

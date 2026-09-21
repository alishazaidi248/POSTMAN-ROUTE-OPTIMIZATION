/**
 * Validates the address -> beat matcher against the ground truth of the Bhandup West data set (130 deliveries, the beat
 * list) and picks / checks the confidence thresholds. Nothing here touches the database or the network.
 *
 *   npx tsx scripts/validate-matcher.ts            evaluates the current thresholds and prints a sweep
 *
 * Ground truth: the delivery file has 5 deliveries per beat, in beat order (delivery n belongs to beat ceil(n / 5)).
 *
 * Three views of the same 130 deliveries, from strict to lenient:
 *   LOCALITY-ONLY  the directory knows which localities a beat has, and no main areas at all
 *   HOLD-OUT       every main area EXCEPT the delivery's own is in the directory (its row keeps only the locality).
 *                  This is the fair test: the matcher never sees the answer for the row it is judging.
 *   IN-SAMPLE      the full directory including the delivery's own main area (an upper bound, partly a lookup of the answer)
 */
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_THRESHOLDS, DirectoryEntry, Thresholds, classify, scoreEntries } from "../src/services/addressing/beatMatcher";

const DATA = path.join(__dirname, "..", "data", "bhandup");

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

export interface Case { n: number; truth: number; parts: string[]; locality: string; mainArea: string }
export function loadCases(): Case[] {
  return parseCsv(fs.readFileSync(path.join(DATA, "deliveries.csv"), "utf8")).slice(1).map((r, i) => ({
    n: i + 1, truth: Math.ceil((i + 1) / 5), locality: r[3], mainArea: r[4],
    // as the import maps them: addressLine1 = address, area = locality, city, state, pincode
    parts: [r[5], r[3], r[6], r[7], r[8]]
  }));
}
export function loadDirectory(): DirectoryEntry[] {
  return parseCsv(fs.readFileSync(path.join(DATA, "beat-directory.csv"), "utf8")).slice(1).map((r) => ({
    beatId: `beat-${r[2]}`, beatNumber: r[2], locality: r[3], mainArea: r[4] || null, pincode: r[5] === "400078" ? r[5] : null
  }));
}

type View = "LOCALITY-ONLY" | "HOLD-OUT" | "IN-SAMPLE";
export function directoryFor(view: View, full: DirectoryEntry[], c: Case): DirectoryEntry[] {
  if (view === "IN-SAMPLE") return full;
  if (view === "LOCALITY-ONLY") return dedupe(full.map((e) => ({ ...e, mainArea: null })));
  return dedupe(full.map((e) => (e.beatNumber === String(c.truth) && e.locality === c.locality && e.mainArea === c.mainArea ? { ...e, mainArea: null } : e)));
}
const dedupe = (rows: DirectoryEntry[]) => {
  const seen = new Set<string>();
  return rows.filter((e) => { const k = `${e.beatNumber}|${e.locality}|${e.mainArea ?? ""}`; if (seen.has(k)) return false; seen.add(k); return true; });
};

export interface Outcome { auto: number; autoCorrect: number; autoWrong: number; review: number; reviewSuggestionCorrect: number; ambiguous: number; ambiguousContainsTruth: number; low: number; none: number }
export function evaluate(view: View, thresholds: Thresholds, cases = loadCases(), full = loadDirectory()): Outcome & { wrongCases: number[] } {
  const o: Outcome & { wrongCases: number[] } = { auto: 0, autoCorrect: 0, autoWrong: 0, review: 0, reviewSuggestionCorrect: 0, ambiguous: 0, ambiguousContainsTruth: 0, low: 0, none: 0, wrongCases: [] };
  for (const c of cases) {
    const m = classify(scoreEntries({ parts: c.parts, localityField: c.locality, postOfficeName: "Bhandup West Post Office", postOfficePincode: "400078" }, directoryFor(view, full, c)), thresholds);
    const truthBeat = String(c.truth);
    if (m.level === "HIGH") { o.auto++; if (m.best!.beatNumber === truthBeat) o.autoCorrect++; else { o.autoWrong++; o.wrongCases.push(c.n); } }
    else if (m.level === "MEDIUM") { o.review++; if (m.best!.beatNumber === truthBeat) o.reviewSuggestionCorrect++; }
    else if (m.level === "AMBIGUOUS") { o.ambiguous++; if (m.contenders.some((x) => x.beatNumber === truthBeat)) o.ambiguousContainsTruth++; }
    else if (m.level === "LOW") o.low++;
    else o.none++;
  }
  return o;
}

function main() {
  const cases = loadCases();
  const full = loadDirectory();
  console.log(`${cases.length} deliveries, ${full.length} directory rows, thresholds ${JSON.stringify(DEFAULT_THRESHOLDS)}\n`);
  for (const view of ["LOCALITY-ONLY", "HOLD-OUT", "IN-SAMPLE"] as View[]) {
    const o = evaluate(view, DEFAULT_THRESHOLDS, cases, full);
    console.log(`${view.padEnd(14)} auto ${o.auto} (correct ${o.autoCorrect}, WRONG ${o.autoWrong}) | review ${o.review} (suggestion right ${o.reviewSuggestionCorrect}) | ambiguous ${o.ambiguous} (truth among contenders ${o.ambiguousContainsTruth}) | low ${o.low} | none ${o.none}${o.wrongCases.length ? "  wrong: " + o.wrongCases.join(",") : ""}`);
  }
  console.log("\nSweep on HOLD-OUT (high, medium, margin) -> auto correct / auto wrong / needs a person:");
  const rows: { t: Thresholds; o: Outcome }[] = [];
  for (const high of [50, 55, 60, 65, 70, 80]) for (const medium of [35, 45, 55]) for (const margin of [5, 10, 15, 20, 30]) {
    if (medium > high) continue;
    rows.push({ t: { high, medium, margin }, o: evaluate("HOLD-OUT", { high, medium, margin }, cases, full) });
  }
  rows.sort((a, b) => a.o.autoWrong - b.o.autoWrong || b.o.autoCorrect - a.o.autoCorrect);
  for (const r of rows.slice(0, 8)) console.log(`  ${JSON.stringify(r.t)} -> ${r.o.autoCorrect} / ${r.o.autoWrong} / ${130 - r.o.auto}`);
  const worst = rows.filter((r) => r.o.autoWrong > 0).slice(-3);
  console.log("  ... settings that make wrong automatic assignments:", worst.map((r) => `${JSON.stringify(r.t)} wrong ${r.o.autoWrong}`).join("; ") || "none in the sweep");

  // The same numbers, for the accuracy report (scripts/make_accuracy_report.py)
  const views = Object.fromEntries((["LOCALITY-ONLY", "HOLD-OUT", "IN-SAMPLE"] as View[]).map((v) => [v, evaluate(v, DEFAULT_THRESHOLDS, cases, full)]));
  const sweepRows = rows.map((r) => ({ ...r.t, autoCorrect: r.o.autoCorrect, autoWrong: r.o.autoWrong }));
  fs.writeFileSync(
    path.join(DATA, "matcher-validation.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), thresholds: DEFAULT_THRESHOLDS, deliveries: cases.length, directoryRows: full.length, views, sweep: { settings: sweepRows.length, anyWrong: sweepRows.some((r) => r.autoWrong > 0), maxCorrect: Math.max(...sweepRows.map((r) => r.autoCorrect)), minCorrect: Math.min(...sweepRows.map((r) => r.autoCorrect)) } }, null, 2)
  );
}

if (require.main === module) main();

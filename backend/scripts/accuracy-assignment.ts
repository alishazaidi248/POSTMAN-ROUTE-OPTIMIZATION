/**
 * Address -> beat accuracy on the SAME 130 Bhandup West deliveries as before (backend/data/bhandup/deliveries.csv - not
 * changed), read back from the database after the real import (scripts/setup-bhandup.ts). Everything reported is counted
 * from what the system stored; nothing is estimated.
 *
 *   DATABASE_URL=... npx tsx scripts/accuracy-assignment.ts   ->  backend/data/bhandup/assignment-results.json
 *
 * Ground truth: the delivery file has 5 deliveries per beat, in beat order (delivery n belongs to beat ceil(n / 5)).
 *
 * What this number is and is not: the 130 addresses come from the supplied test file, whose beat directory (201 rows) lists
 * every delivery's own main area, so a NAME match here is close to a lookup of the answer key (scripts/validate-matcher.ts
 * measures the same matcher with each delivery's own directory row held out, which is the fair test). The coordinates the
 * geocoder returned are for OpenStreetMap anchors near the named places, not the true position of the houses, so nothing
 * here is a measurement of house-level location accuracy.
 */
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../src/config/prisma";

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

const count = <K extends string>(items: K[]) => items.reduce<Record<string, number>>((m, k) => ((m[k] = (m[k] ?? 0) + 1), m), {});
const pct = (a: number, b: number) => (b === 0 ? 0 : Math.round((a / b) * 1000) / 10);

async function main() {
  const truthRows = parseCsv(fs.readFileSync(path.join(DATA, "deliveries.csv"), "utf8")).slice(1).map((r, i) => ({ n: i + 1, phone: r[1], locality: r[3], truth: Math.ceil((i + 1) / 5) }));
  const deliveries = await prisma.delivery.findMany({
    include: { recipient: true, address: true, beat: { select: { beatNumber: true } }, exceptions: { where: { resolvedAt: null }, include: { suggestedBeat: { select: { beatNumber: true } } } } }
  });
  const byPhone = new Map(deliveries.map((d) => [d.recipient.phone, d]));

  const rows = truthRows.map(({ phone, ...t }) => {
    // the phone is only the join key to the delivery; it is not written to the results (no personal data in the output file)
    const d = byPhone.get(phone);
    const assigned = d?.beat ? Number(d.beat.beatNumber) : null;
    const open = d?.exceptions.filter((e) => e.reason !== "NO_POSTMAN_ASSIGNED") ?? [];
    const ev = (open[0]?.evidence ?? null) as { contenders?: string[] } | null;
    return {
      ...t,
      imported: !!d,
      assigned,
      correct: assigned === t.truth,
      method: d?.assignmentMethod ?? null,
      confidence: d?.assignmentConfidence ?? null,
      precision: d?.address.geocodingPrecision ?? "MISSING",
      source: d?.address.geocodingSource ?? null,
      exception: open[0]?.reason ?? null,
      suggested: open[0]?.suggestedBeat ? Number(open[0].suggestedBeat.beatNumber) : null,
      contenders: ev?.contenders?.map(Number) ?? null
    };
  });

  const assigned = rows.filter((r) => r.assigned !== null);
  const correct = assigned.filter((r) => r.correct);
  const incorrect = assigned.filter((r) => !r.correct);
  const unassigned = rows.filter((r) => r.assigned === null);
  const inException = unassigned.filter((r) => r.exception);
  const methods = count(assigned.map((r) => r.method ?? "UNKNOWN"));
  const correctByMethod: Record<string, number> = {};
  for (const r of correct) correctByMethod[r.method ?? "UNKNOWN"] = (correctByMethod[r.method ?? "UNKNOWN"] ?? 0) + 1;
  const truthReachable = inException.filter((r) => r.suggested === r.truth || (r.contenders ?? []).includes(r.truth));

  const summary = {
    generatedAt: new Date().toISOString(),
    dataset: "backend/data/bhandup/deliveries.csv (unchanged: 130 deliveries, 26 beats, 5 per beat)",
    total: rows.length,
    imported: rows.filter((r) => r.imported).length,
    correct: correct.length,
    incorrect: incorrect.length,
    unassigned: unassigned.length,
    exceptions: inException.length,
    /** correct / all 130: a delivery sent to an administrator counts as not (yet) correct */
    accuracyOfAll: pct(correct.length, rows.length),
    /** correct / the ones the system assigned by itself */
    accuracyOfAssigned: pct(correct.length, assigned.length),
    assignedAutomatically: assigned.length,
    methods: { NAME: methods.NAME ?? 0, NAME_AND_TERRITORY: methods.NAME_AND_TERRITORY ?? 0, TERRITORY: methods.TERRITORY ?? 0, MANUAL: methods.MANUAL ?? 0, other: methods.UNKNOWN ?? 0 },
    correctByMethod,
    exceptionReasons: count(inException.map((r) => r.exception as string)),
    exceptionsWithTheRightBeatSuggestedOrAmongContenders: truthReachable.length,
    exceptionsWithSomeSuggestion: inException.filter((r) => r.suggested !== null).length,
    geocodePrecision: count(rows.map((r) => r.precision)),
    wrong: incorrect.map((r) => ({ n: r.n, truth: r.truth, got: r.assigned, method: r.method, confidence: r.confidence, locality: r.locality }))
  };

  fs.writeFileSync(path.join(DATA, "assignment-results.json"), JSON.stringify({ summary, rows }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main().finally(() => prisma.$disconnect());

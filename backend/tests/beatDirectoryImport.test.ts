import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  postOffice: { findMany: vi.fn() },
  beat: { findMany: vi.fn() },
  beatLocality: { findMany: vi.fn() },
  $queryRaw: vi.fn()
}));
vi.mock("../src/config/prisma", () => ({ prisma: prismaMock }));

import { RawRow, checkBeatList, suggestBeatMapping } from "../src/services/beats/beatListImport";

const OFFICE = { id: "po1", name: "Bhandup West Post Office", code: "BW01" };
const rows = (...cells: Record<string, string>[]): RawRow[] => cells.map((c, i) => ({ rowNumber: i + 2, cells: c }));
const MAPPING = { beatNumber: "Beat No", name: null, postOffice: "Post Office", territory: null, latitude: null, longitude: null, locality: "Locality", mainArea: "Main Area", pincode: "Pincode" };
const scope = { scopeOfficeId: "po1", defaultOfficeId: "po1" };
const line = (beat: string, locality: string, area = "", extra: Record<string, string> = {}) => ({ "Beat No": beat, "Post Office": "Bhandup West Post Office", Locality: locality, "Main Area": area, Pincode: "400078", ...extra });

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.postOffice.findMany.mockResolvedValue([OFFICE]);
  prismaMock.beat.findMany.mockResolvedValue([]);
  prismaMock.beatLocality.findMany.mockResolvedValue([]);
});

describe("beat directory import: several rows per beat", () => {
  it("recognises locality / main area / pincode columns, and never takes 'Locality' for the beat name", () => {
    expect(suggestBeatMapping(["Beat No", "Locality", "Main Area", "Pincode", "Post Office"])).toMatchObject({
      beatNumber: "Beat No", locality: "Locality", mainArea: "Main Area", pincode: "Pincode", postOffice: "Post Office", name: null
    });
    expect(suggestBeatMapping(["Locality", "Beat Name", "Beat Number"])).toMatchObject({ locality: "Locality", name: "Beat Name", beatNumber: "Beat Number" });
  });

  it("the rows of one beat number are ONE beat with several localities (not duplicates)", async () => {
    const { check, importable } = await checkBeatList(
      { rows: rows(line("20", "Farid Nagar", "Afjal Chawl"), line("20", "Farid Nagar", "Sham Kung Chawl"), line("20", "Kokan Nagar"), line("21", "Tanaji Wadi")) },
      MAPPING, scope
    );
    expect(importable).toHaveLength(2);
    expect(importable[0]).toMatchObject({ beatNumber: "20", existingBeatId: null });
    expect(importable[0].localities.map((l) => [l.locality, l.mainArea])).toEqual([["Farid Nagar", "Afjal Chawl"], ["Farid Nagar", "Sham Kung Chawl"], ["Kokan Nagar", null]]);
    expect(check.summary).toMatchObject({ structured: true, totalRows: 4, newBeats: 2, existingBeats: 0, localityRecords: 4, duplicates: 0, duplicateLocalityRows: 0, errors: 0 });
    expect(check.rows.map((r) => r.action)).toEqual(["NEW_BEAT", "ADD_LOCALITY", "ADD_LOCALITY", "NEW_BEAT"]);
  });

  it("a repeated (beat, locality, main area) is reported and adds nothing - never silently dropped", async () => {
    const { check, importable } = await checkBeatList(
      { rows: rows(line("20", "Farid Nagar", "Afjal Chawl"), line("20", "FARID  NAGAR", "afjal chawl")) },
      MAPPING, scope
    );
    expect(importable[0].localities).toHaveLength(1);
    expect(check.summary.duplicateLocalityRows).toBe(1);
    expect(check.rows[1]).toMatchObject({ status: "WARNING", action: "SKIPPED" });
    expect(check.rows[1].messages.join(" ")).toMatch(/Repeats row 2/);
  });

  it("spelling variants of one locality are the same locality", async () => {
    const { check } = await checkBeatList({ rows: rows(line("4", "Dattaram Nivas"), line("4", "Dattaram Niwas")) }, MAPPING, scope);
    expect(check.summary.duplicateLocalityRows).toBe(1);
  });

  it("the same locality under two DIFFERENT beats is legitimate (it is what makes an address ambiguous)", async () => {
    const { check } = await checkBeatList({ rows: rows(line("2", "Village Road"), line("5", "Village Road")) }, MAPPING, scope);
    expect(check.summary).toMatchObject({ newBeats: 2, localityRecords: 2, duplicateLocalityRows: 0, errors: 0 });
  });

  it("an existing beat only receives the localities it does not have yet", async () => {
    prismaMock.beat.findMany.mockResolvedValue([{ id: "beat-20", postOfficeId: "po1", beatNumber: "20" }]);
    prismaMock.beatLocality.findMany.mockResolvedValue([{ beatId: "beat-20", normalizedLocality: "FARID NAGAR", normalizedMainArea: "" }]);
    const { check, importable } = await checkBeatList({ rows: rows(line("20", "Farid Nagar"), line("20", "Kokan Nagar")) }, MAPPING, scope);
    expect(importable).toHaveLength(1);
    expect(importable[0]).toMatchObject({ existingBeatId: "beat-20" });
    expect(importable[0].localities.map((l) => l.locality)).toEqual(["Kokan Nagar"]);
    expect(check.summary).toMatchObject({ newBeats: 0, existingBeats: 1, localityRecords: 1, duplicateLocalityRows: 1 });
  });

  it("counts, and refuses, rows with a missing beat number or an unknown post office", async () => {
    const { check, importable } = await checkBeatList(
      { rows: rows(line("", "Farid Nagar"), line("7", "Kokan Nagar", "", { "Post Office": "Mulund Post Office" }), line("8", "Tanaji Wadi")) },
      MAPPING, scope
    );
    expect(check.summary).toMatchObject({ missingBeatNumbers: 1, unknownPostOffices: 1, errors: 2, newBeats: 1 });
    expect(importable.map((b) => b.beatNumber)).toEqual(["8"]);
    expect(check.rows[0].status).toBe("ERROR");
    expect(check.rows[1].messages.join(" ")).toMatch(/not recognised/);
  });

  it("a main area without its locality is an error, and an invalid pincode is ignored with a warning", async () => {
    const { check } = await checkBeatList({ rows: rows(line("9", "", "Afjal Chawl"), line("9", "Kokan Nagar", "", { Pincode: "40007" })) }, MAPPING, scope);
    expect(check.rows[0]).toMatchObject({ status: "ERROR" });
    expect(check.rows[1]).toMatchObject({ status: "WARNING" });
    expect(check.rows[1].messages.join(" ")).toMatch(/pincode/);
  });

  it("without a locality column a repeated beat number is still a duplicate error (the old, one-row-per-beat list)", async () => {
    const plain = { ...MAPPING, locality: null, mainArea: null, pincode: null, name: "Beat Name" };
    const { check } = await checkBeatList({ rows: rows({ "Beat No": "5", "Beat Name": "A" }, { "Beat No": "5", "Beat Name": "B" }) }, plain, scope);
    expect(check.summary).toMatchObject({ structured: false, duplicates: 2, errors: 2 });
  });

  it("reports beats that end up with no locality", async () => {
    const { check } = await checkBeatList({ rows: rows(line("30", ""), line("31", "Kokan Nagar")) }, MAPPING, scope);
    expect(check.summary.beatsWithoutLocality).toBe(1);
  });

  it("every file row is accounted for: importing + skipped + errors = total", async () => {
    const { check } = await checkBeatList(
      { rows: rows(line("20", "Farid Nagar"), line("20", "Farid Nagar"), line("", "X Nagar"), line("21", "Kokan Nagar")) },
      MAPPING, scope
    );
    const contributing = check.rows.filter((r) => r.action !== "SKIPPED").length;
    const skipped = check.rows.filter((r) => r.action === "SKIPPED").length;
    expect(contributing + skipped).toBe(check.summary.totalRows);
    expect(check.rows.filter((r) => r.action === "SKIPPED" && r.messages.length === 0)).toHaveLength(0); // no row is skipped without a reason
  });
});

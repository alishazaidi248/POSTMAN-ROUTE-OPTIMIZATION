import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import ExcelJS from "exceljs";

const prismaMock = vi.hoisted(() => ({
  postOffice: { findMany: vi.fn() },
  beat: { findMany: vi.fn() },
  $queryRaw: vi.fn()
}));
vi.mock("../src/config/prisma", () => ({ prisma: prismaMock }));

import {
  RawRow,
  checkBeatList,
  errorReportCsv,
  readBeatListFile,
  suggestBeatMapping
} from "../src/services/beats/beatListImport";
import { parseTerritoryCell } from "../src/services/beats/territory";

const OFFICE = { id: "po1", name: "Bhandup West Post Office", code: "BW01" };
const OTHER = { id: "po2", name: "Mulund Post Office", code: "ML01" };

const square = JSON.stringify({ type: "Polygon", coordinates: [[[72.9, 19.1], [72.904, 19.1], [72.904, 19.104], [72.9, 19.104], [72.9, 19.1]]] });
const rows = (...cells: Record<string, string>[]): RawRow[] => cells.map((c, i) => ({ rowNumber: i + 2, cells: c }));

const MAPPING = { beatNumber: "Beat No", name: "Beat Name", postOffice: "Post Office", territory: "Boundary", latitude: null, longitude: null };

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.postOffice.findMany.mockResolvedValue([OFFICE, OTHER]);
  prismaMock.beat.findMany.mockResolvedValue([{ postOfficeId: "po1", beatNumber: "B01" }]);
  // PostGIS says every polygon handed to it is valid
  prismaMock.$queryRaw.mockResolvedValue([{ valid: true, reason: "Valid Geometry", area: 200000, lat: 19.102, lng: 72.902 }]);
});

const scope = { scopeOfficeId: "po1", defaultOfficeId: "po1" };

describe("suggestBeatMapping", () => {
  it("recognises the usual column names, whatever the capitalisation and punctuation", () => {
    expect(suggestBeatMapping(["Sr No", "Beat No.", "Beat Name", "Post Office", "Boundary", "Remarks"])).toEqual({
      beatNumber: "Beat No.",
      name: "Beat Name",
      postOffice: "Post Office",
      territory: "Boundary",
      latitude: null,
      longitude: null
    });
    expect(suggestBeatMapping(["BEAT_NUMBER", "SECTOR", "OFFICE", "LAT", "LNG"])).toMatchObject({
      beatNumber: "BEAT_NUMBER",
      name: "SECTOR",
      postOffice: "OFFICE",
      latitude: "LAT",
      longitude: "LNG"
    });
  });

  it("does not take the beat NAME column for the beat NUMBER", () => {
    const m = suggestBeatMapping(["Beat Name", "Beat Code"]);
    expect(m.beatNumber).toBe("Beat Code");
    expect(m.name).toBe("Beat Name");
  });

  it("leaves a field empty when nothing matches, instead of guessing", () => {
    expect(suggestBeatMapping(["Identifier", "Label"]).beatNumber).toBeNull();
  });
});

describe("parseTerritoryCell", () => {
  it("reads GeoJSON, a GeoJSON Feature and WKT", () => {
    expect(parseTerritoryCell(square)?.type).toBe("Polygon");
    expect(parseTerritoryCell(JSON.stringify({ type: "Feature", properties: {}, geometry: JSON.parse(square) }))?.type).toBe("Polygon");
    const wkt = parseTerritoryCell("POLYGON((72.9 19.1, 72.904 19.1, 72.904 19.104, 72.9 19.104, 72.9 19.1))");
    expect(wkt?.coordinates[0]).toHaveLength(5);
    expect(wkt?.coordinates[0][1]).toEqual([72.904, 19.1]);
  });

  it("returns null for an empty cell and explains a broken one in plain words", () => {
    expect(parseTerritoryCell("  ")).toBeNull();
    expect(() => parseTerritoryCell("not a shape")).toThrow(/not recognised/);
    expect(() => parseTerritoryCell('{"type":"Polygon","coordinates":[[[1,1],[2,2]]]}')).toThrow(/incomplete/);
    expect(() => parseTerritoryCell("{oops")).toThrow(/not readable/);
  });
});

describe("checkBeatList", () => {
  it("accepts good rows, and says which have a territory", async () => {
    const { check, importable } = await checkBeatList(
      { rows: rows({ "Beat No": "B201", "Beat Name": "Sector 3", "Post Office": OFFICE.name, Boundary: square }, { "Beat No": "B202", "Beat Name": "Sector 4", "Post Office": OFFICE.name, Boundary: "" }) },
      MAPPING,
      scope
    );
    expect(check.summary).toMatchObject({ totalRows: 2, importable: 2, ready: 1, warnings: 1, errors: 0, missingTerritory: 1 });
    expect(check.rows[0]).toMatchObject({ status: "READY", territoryState: "PRESENT", postOfficeId: "po1" });
    expect(check.rows[1]).toMatchObject({ status: "WARNING", territoryState: "MISSING" });
    expect(check.rows[1].messages.join(" ")).toMatch(/draw the territory/i);
    expect(importable.map((b) => b.beatNumber)).toEqual(["B201", "B202"]);
    expect(importable[0].territory?.type).toBe("Polygon");
    expect(importable[0].centerLatitude).toBeCloseTo(19.102, 5);
    expect(importable[1].territory).toBeNull();
  });

  it("refuses rows with no beat number, duplicates in the file, and beats that already exist", async () => {
    const { check, importable } = await checkBeatList(
      {
        rows: rows(
          { "Beat No": "B300", "Beat Name": "A", "Post Office": OFFICE.name },
          { "Beat No": "b300", "Beat Name": "A again", "Post Office": OFFICE.name },
          { "Beat No": "", "Beat Name": "No number", "Post Office": OFFICE.name },
          { "Beat No": "B01", "Beat Name": "Exists", "Post Office": OFFICE.name },
          { "Beat No": "B301", "Beat Name": "Fine", "Post Office": OFFICE.name }
        )
      },
      MAPPING,
      scope
    );
    const by = (n: number) => check.rows[n];
    expect(by(0).status).toBe("ERROR");
    expect(by(0).messages.join(" ")).toMatch(/more than once.*rows 2, 3/);
    expect(by(1).status).toBe("ERROR");
    expect(by(2).messages.join(" ")).toMatch(/beat number is missing/i);
    expect(by(3).messages.join(" ")).toMatch(/already exists/);
    expect(by(4).status).toBe("WARNING");
    expect(check.summary.duplicates).toBe(3);
    expect(check.summary.errors).toBe(4);
    expect(importable.map((b) => b.beatNumber)).toEqual(["B301"]);
  });

  it("refuses an unknown post office, and another office's beats for an administrator of one office", async () => {
    const { check } = await checkBeatList(
      { rows: rows({ "Beat No": "X1", "Beat Name": "A", "Post Office": "Nowhere Post Office" }, { "Beat No": "X2", "Beat Name": "B", "Post Office": OTHER.name }) },
      MAPPING,
      scope
    );
    expect(check.rows[0].messages.join(" ")).toMatch(/was not recognised/);
    expect(check.rows[1].messages.join(" ")).toMatch(/not your post office/);
    expect(check.summary.importable).toBe(0);
  });

  it("a super administrator (no single office) may import into any recognised office", async () => {
    const { check, importable } = await checkBeatList(
      { rows: rows({ "Beat No": "X2", "Beat Name": "B", "Post Office": OTHER.name }) },
      MAPPING,
      { scopeOfficeId: undefined, defaultOfficeId: "po1" }
    );
    expect(check.summary.importable).toBe(1);
    expect(importable[0].postOfficeId).toBe("po2");
  });

  it("without a post office column, every beat goes to the administrator's own office", async () => {
    const { importable } = await checkBeatList({ rows: rows({ "Beat No": "N1", "Beat Name": "A" }) }, { ...MAPPING, postOffice: null }, scope);
    expect(importable[0].postOfficeId).toBe("po1");
  });

  it("a territory that cannot be read, or that PostGIS rejects, is an error - never silently imported", async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([{ valid: false, reason: "Self-intersection", area: 5, lat: 0, lng: 0 }]);
    const { check, importable } = await checkBeatList(
      { rows: rows({ "Beat No": "T1", "Beat Name": "Bowtie", "Post Office": OFFICE.name, Boundary: square }, { "Beat No": "T2", "Beat Name": "Junk", "Post Office": OFFICE.name, Boundary: "??" }) },
      MAPPING,
      scope
    );
    expect(check.rows[0]).toMatchObject({ status: "ERROR", territoryState: "INVALID" });
    expect(check.rows[0].messages.join(" ")).toMatch(/not valid \(Self-intersection\)/);
    expect(check.rows[1]).toMatchObject({ status: "ERROR", territoryState: "INVALID" });
    expect(check.summary.invalidTerritory).toBe(2);
    expect(importable).toHaveLength(0);
  });

  it("reports a file with no beat-number column as a file problem and imports nothing", async () => {
    const { check, importable } = await checkBeatList({ rows: rows({ Identifier: "A1", Label: "x" }) }, { ...MAPPING, beatNumber: null }, scope);
    expect(check.fileProblems.join(" ")).toMatch(/beat number/i);
    expect(importable).toEqual([]);
  });

  it("uses centre coordinates when there is no territory, and ignores bad ones with a warning", async () => {
    const { check, importable } = await checkBeatList(
      { rows: rows({ "Beat No": "C1", "Beat Name": "A", "Post Office": OFFICE.name, Lat: "19.15", Lng: "72.95" }, { "Beat No": "C2", "Beat Name": "B", "Post Office": OFFICE.name, Lat: "999", Lng: "72.95" }) },
      { ...MAPPING, latitude: "Lat", longitude: "Lng" },
      scope
    );
    expect(importable[0]).toMatchObject({ centerLatitude: 19.15, centerLongitude: 72.95 });
    expect(importable[1].centerLatitude).toBeNull();
    expect(check.rows[1].messages.join(" ")).toMatch(/centre coordinates are not valid/);
  });
});

describe("errorReportCsv", () => {
  it("lists only the rows that need attention, in plain words", async () => {
    const { check } = await checkBeatList(
      { rows: rows({ "Beat No": "R1", "Beat Name": "Ok", "Post Office": OFFICE.name, Boundary: square }, { "Beat No": "B01", "Beat Name": "Dup", "Post Office": OFFICE.name }) },
      MAPPING,
      scope
    );
    const csv = errorReportCsv(check.rows);
    expect(csv).toMatch(/"Row","Beat number","Beat name","Result","What to fix"/);
    expect(csv).toMatch(/"3","B01","Dup","Will not be imported"/);
    expect(csv).not.toMatch(/"R1"/);
  });
});

describe("readBeatListFile", () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "beats-"));

  it("finds the header below title rows in an Excel workbook, and reports real spreadsheet row numbers", async () => {
    const dir = tmp();
    const file = path.join(dir, "list.xlsx");
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1");
    ws.addRow(["Some Post Office - Beat List"]);
    ws.addRow([]);
    ws.addRow(["Sr", "Beat No.", "Beat Name", "Post Office"]);
    ws.addRow([1, "B7", "Seven", "Bhandup West Post Office"]);
    ws.addRow([]);
    ws.addRow([2, "B8", "Eight", "Bhandup West Post Office"]);
    await wb.xlsx.writeFile(file);

    const table = await readBeatListFile(file, "list.xlsx");
    expect(table.columns).toEqual(["Sr", "Beat No.", "Beat Name", "Post Office"]);
    expect(table.rows.map((r) => [r.rowNumber, r.cells["Beat No."]])).toEqual([[4, "B7"], [6, "B8"]]);
  });

  it("reads a CSV, including a quoted GeoJSON cell", async () => {
    const dir = tmp();
    const file = path.join(dir, "list.csv");
    fs.writeFileSync(file, `Beat No,Beat Name,Boundary\nB1,One,"${square.replace(/"/g, '""')}"\n`);
    const table = await readBeatListFile(file, "list.csv");
    expect(table.rows[0].cells.Boundary).toBe(square);
    expect(parseTerritoryCell(table.rows[0].cells.Boundary)?.type).toBe("Polygon");
  });

  it("refuses other file types and unreadable files in plain words", async () => {
    const dir = tmp();
    const txt = path.join(dir, "x.txt");
    fs.writeFileSync(txt, "hello");
    await expect(readBeatListFile(txt, "x.txt")).rejects.toThrow(/Only Excel/);
    const fake = path.join(dir, "fake.xlsx");
    fs.writeFileSync(fake, "not really a workbook");
    await expect(readBeatListFile(fake, "fake.xlsx")).rejects.toThrow(/could not be read as an Excel workbook/);
  });
});

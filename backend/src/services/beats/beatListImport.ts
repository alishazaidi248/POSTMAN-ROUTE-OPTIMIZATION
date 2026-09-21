import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import ExcelJS from "exceljs";
import { AppError } from "../../utils/AppError";
import { prisma } from "../../config/prisma";
import { Polygon, checkTerritory, parseTerritoryCell } from "./territory";

/**
 * Beat-list import: reading a CSV/XLSX beat list, working out which column is which,
 * and checking every row BEFORE anything reaches the database. Nothing here writes;
 * the routes hold the parsed list (BeatImport) until the administrator confirms.
 *
 * The list's own column names are never assumed: columns are matched by common names
 * (Beat No, Beat Name, Sector, Post Office, Boundary, Latitude, ...) and the
 * administrator can correct any match in the wizard.
 */

export const BEAT_FIELDS = ["beatNumber", "name", "postOffice", "territory", "latitude", "longitude"] as const;
export type BeatField = (typeof BEAT_FIELDS)[number];
export type BeatMapping = Record<BeatField, string | null>;

export const BEAT_FIELD_LABELS: Record<BeatField, string> = {
  beatNumber: "Beat number",
  name: "Beat name / sector",
  postOffice: "Post office",
  territory: "Territory (boundary)",
  latitude: "Centre latitude",
  longitude: "Centre longitude"
};

export interface RawRow {
  /** Row number as the person sees it in the spreadsheet. */
  rowNumber: number;
  cells: Record<string, string>;
}

export interface RawTable {
  columns: string[];
  rows: RawRow[];
  sheetName?: string;
}

const ALIASES: Record<BeatField, string[]> = {
  beatNumber: ["beat_number", "beat_no", "beat_no.", "beatno", "beat", "beat_id", "beat_code", "beat_num", "beat_#", "beat_number."],
  name: ["beat_name", "name", "sector", "sector_name", "beat_area", "area", "locality", "area_name", "beat_description", "description"],
  postOffice: ["post_office", "post_office_name", "postoffice", "office", "office_name", "po", "post_office_code", "office_code", "sub_office", "so"],
  territory: ["territory", "boundary", "polygon", "geojson", "wkt", "geometry", "boundary_geojson", "territory_boundary", "area_boundary"],
  latitude: ["latitude", "lat", "center_latitude", "centre_latitude", "center_lat", "centre_lat"],
  longitude: ["longitude", "lng", "lon", "long", "center_longitude", "centre_longitude", "center_lng", "centre_lng"]
};

const normalizeHeader = (h: string) => h.trim().toLowerCase().replace(/[\s\-/]+/g, "_");

export function suggestBeatMapping(columns: string[]): BeatMapping {
  const mapping = Object.fromEntries(BEAT_FIELDS.map((f) => [f, null])) as BeatMapping;
  const used = new Set<string>();
  const normalized = columns.map((raw) => ({ raw, n: normalizeHeader(raw) }));
  // Exact names first (so "beat_name" is not taken as the beat NUMBER), then looser containment.
  for (const field of BEAT_FIELDS) {
    const hit = normalized.find((c) => !used.has(c.raw) && ALIASES[field].includes(c.n));
    if (hit) {
      mapping[field] = hit.raw;
      used.add(hit.raw);
    }
  }
  if (!mapping.beatNumber) {
    const hit = normalized.find((c) => !used.has(c.raw) && /beat/.test(c.n) && /(no|num|number|code|id)/.test(c.n));
    if (hit) {
      mapping.beatNumber = hit.raw;
      used.add(hit.raw);
    }
  }
  return mapping;
}

// ── reading the file ───────────────────────────────────────────────────────

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    const v = value as unknown as Record<string, unknown>;
    if (Array.isArray(v.richText)) return (v.richText as { text: string }[]).map((t) => t.text).join("").trim();
    if ("result" in v) return cellText(v.result as ExcelJS.CellValue);
    if (typeof v.text === "string") return v.text.trim();
    if (typeof v.hyperlink === "string") return v.hyperlink;
    return "";
  }
  return String(value).trim();
}

/** The header is the row (within the first ten) that looks most like a beat-list header. */
function findHeaderRow(grid: string[][]): number {
  let best = 0;
  let bestScore = -1;
  grid.slice(0, 10).forEach((cells, index) => {
    const filled = cells.filter((c) => c !== "").length;
    if (filled < 2) return;
    const score = cells.reduce((sum, c) => {
      const n = normalizeHeader(c);
      return sum + (BEAT_FIELDS.some((f) => ALIASES[f].includes(n)) ? 3 : 0) + (c !== "" ? 1 : 0) * 0.01;
    }, 0);
    if (score > bestScore) {
      bestScore = score;
      best = index;
    }
  });
  return best;
}

function tableFromGrid(grid: string[][], sheetName?: string): RawTable {
  if (grid.length === 0) return { columns: [], rows: [], sheetName };
  const headerIndex = findHeaderRow(grid);
  const header = grid[headerIndex];
  const columns: string[] = [];
  const seen = new Map<string, number>();
  header.forEach((h, i) => {
    let name = h || (grid.slice(headerIndex + 1).some((r) => (r[i] ?? "") !== "") ? `Column ${i + 1}` : "");
    if (!name) return;
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    if (count > 0) name = `${name} (${count + 1})`;
    columns[i] = name;
  });

  const rows: RawRow[] = [];
  grid.slice(headerIndex + 1).forEach((cells, offset) => {
    const record: Record<string, string> = {};
    columns.forEach((col, i) => {
      if (col) record[col] = cells[i] ?? "";
    });
    if (Object.values(record).some((v) => v !== "")) rows.push({ rowNumber: headerIndex + offset + 2, cells: record });
  });
  return { columns: columns.filter(Boolean), rows, sheetName };
}

export async function readBeatListFile(filePath: string, originalName: string): Promise<RawTable> {
  const ext = path.extname(originalName).toLowerCase();
  if (ext === ".csv") {
    let records: string[][];
    try {
      records = parse(fs.readFileSync(filePath, "utf-8"), { skip_empty_lines: true, bom: true, relax_column_count: true, trim: true });
    } catch {
      throw AppError.badRequest("This file could not be read as a CSV. Please check it opens correctly in a spreadsheet program.");
    }
    return tableFromGrid(records.map((r) => r.map((c) => String(c ?? "").trim())));
  }
  if (ext === ".xlsx") {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.readFile(filePath);
    } catch {
      throw AppError.badRequest("This file could not be read as an Excel workbook. Please check it opens correctly in Excel.");
    }
    // Use the first sheet that has data; a beat list is normally the only one.
    const sheet = workbook.worksheets.find((ws) => ws.actualRowCount > 0);
    if (!sheet) return { columns: [], rows: [] };
    const grid: string[][] = [];
    sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const cells: string[] = [];
      for (let c = 1; c <= sheet.actualColumnCount; c++) cells.push(cellText(row.getCell(c).value));
      grid[rowNumber - 1] = cells;
    });
    return tableFromGrid(Array.from(grid, (r) => r ?? []), sheet.name);
  }
  throw AppError.badRequest("Only Excel (.xlsx) and CSV (.csv) beat lists are supported.");
}

// ── checking the rows ──────────────────────────────────────────────────────

export type RowStatus = "READY" | "WARNING" | "ERROR";
export type TerritoryState = "PRESENT" | "MISSING" | "INVALID";

export interface CheckedRow {
  rowNumber: number;
  beatNumber: string;
  name: string;
  postOfficeId: string | null;
  postOfficeName: string;
  territoryState: TerritoryState;
  hasCentre: boolean;
  status: RowStatus;
  messages: string[];
}

export interface PreviewSummary {
  totalRows: number;
  /** Rows that will be imported (ready + warnings). */
  importable: number;
  ready: number;
  warnings: number;
  errors: number;
  duplicates: number;
  missingTerritory: number;
  invalidTerritory: number;
}

export interface BeatListCheck {
  rows: CheckedRow[];
  summary: PreviewSummary;
  /** Problems with the file as a whole (e.g. no beat-number column). */
  fileProblems: string[];
}

export interface ImportableBeat {
  rowNumber: number;
  beatNumber: string;
  name: string;
  postOfficeId: string;
  territory: Polygon | null;
  centerLatitude: number | null;
  centerLongitude: number | null;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

function toNumber(text: string): number | null {
  if (!text) return null;
  const n = Number(text.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Checks every row against the mapping, the post offices and the beats that already exist.
 * `scopeOfficeId`: the administrator's own office (rows naming another office are refused);
 * a super administrator passes undefined and may import into any office.
 */
export async function checkBeatList(
  table: { rows: RawRow[] },
  mapping: BeatMapping,
  scope: { scopeOfficeId: string | undefined; defaultOfficeId: string }
): Promise<{ check: BeatListCheck; importable: ImportableBeat[] }> {
  const offices = await prisma.postOffice.findMany({ select: { id: true, name: true, code: true } });
  const officeById = new Map(offices.map((o) => [o.id, o]));
  const officeByText = new Map<string, string>();
  for (const o of offices) {
    officeByText.set(norm(o.name), o.id);
    officeByText.set(norm(o.code), o.id);
  }
  const findOffice = (text: string): string | null => {
    const n = norm(text);
    const exact = officeByText.get(n);
    if (exact) return exact;
    const partial = offices.filter((o) => norm(o.name).includes(n) || n.includes(norm(o.name)));
    return partial.length === 1 ? partial[0].id : null;
  };

  const fileProblems: string[] = [];
  if (!mapping.beatNumber) fileProblems.push("No column has been chosen for the beat number.");
  if (table.rows.length === 0) fileProblems.push("The file has no beats in it.");

  const existing = await prisma.beat.findMany({ select: { postOfficeId: true, beatNumber: true } });
  const existingKeys = new Set(existing.map((b) => `${b.postOfficeId}|${norm(b.beatNumber)}`));

  const cell = (row: RawRow, field: BeatField): string => (mapping[field] ? (row.cells[mapping[field] as string] ?? "").trim() : "");

  // First pass: identity (office + beat number) so duplicates inside the file can be reported on every row.
  const identity = table.rows.map((row) => {
    const beatNumber = cell(row, "beatNumber");
    const officeText = cell(row, "postOffice");
    const officeId = officeText ? findOffice(officeText) : scope.defaultOfficeId;
    return { row, beatNumber, officeText, officeId };
  });
  const rowsByKey = new Map<string, number[]>();
  for (const id of identity) {
    if (!id.beatNumber || !id.officeId) continue;
    const key = `${id.officeId}|${norm(id.beatNumber)}`;
    rowsByKey.set(key, [...(rowsByKey.get(key) ?? []), id.row.rowNumber]);
  }

  const rows: CheckedRow[] = [];
  const importable: ImportableBeat[] = [];
  let duplicates = 0;
  let missingTerritory = 0;
  let invalidTerritory = 0;

  for (const { row, beatNumber, officeText, officeId } of identity) {
    const messages: string[] = [];
    let status = "READY" as RowStatus;
    const fail = (m: string) => {
      messages.push(m);
      status = "ERROR";
    };
    const warn = (m: string) => {
      messages.push(m);
      if (status !== "ERROR") status = "WARNING";
    };

    // beat number
    if (!beatNumber) fail("The beat number is missing.");
    else if (beatNumber.length > 30) fail("The beat number is too long (30 characters at most).");

    // post office
    let officeName = officeId ? (officeById.get(officeId)?.name ?? "") : "";
    if (officeText && !officeId) {
      officeName = officeText;
      fail(`The post office "${officeText}" was not recognised.`);
    } else if (officeId && scope.scopeOfficeId && officeId !== scope.scopeOfficeId) {
      fail(`This beat belongs to ${officeName}, which is not your post office.`);
    }

    // duplicates
    let isDuplicate = false;
    if (beatNumber && officeId) {
      const key = `${officeId}|${norm(beatNumber)}`;
      const same = rowsByKey.get(key) ?? [];
      if (same.length > 1) {
        isDuplicate = true;
        fail(`Beat number ${beatNumber} appears more than once in the file (rows ${same.join(", ")}).`);
      }
      if (existingKeys.has(key)) {
        isDuplicate = true;
        fail(`Beat ${beatNumber} already exists in ${officeName || "this post office"}.`);
      }
    }
    if (isDuplicate) duplicates++;

    // name
    let name = cell(row, "name");
    if (!name && beatNumber) {
      name = `Beat ${beatNumber}`;
      if (mapping.name) warn("The beat has no name, so it will be called \"Beat " + beatNumber + "\".");
    }
    if (name.length > 120) fail("The beat name is too long (120 characters at most).");

    // territory / centre
    let territoryState: TerritoryState = "MISSING";
    let territory: Polygon | null = null;
    let centerLatitude: number | null = null;
    let centerLongitude: number | null = null;

    const territoryText = cell(row, "territory");
    if (territoryText) {
      try {
        territory = parseTerritoryCell(territoryText);
      } catch (err) {
        territoryState = "INVALID";
        invalidTerritory++;
        fail(err instanceof Error ? err.message : "The territory could not be read.");
      }
      if (territory) {
        const verdict = await checkTerritory(prisma, territory);
        if (verdict.valid) {
          territoryState = "PRESENT";
          centerLatitude = verdict.centerLatitude;
          centerLongitude = verdict.centerLongitude;
        } else {
          territory = null;
          territoryState = "INVALID";
          invalidTerritory++;
          fail(`The territory outline is not valid (${verdict.reason}).`);
        }
      }
    }
    // (a row that already cannot be imported does not also get a "no territory" note)
    if (territoryState === "MISSING" && status !== "ERROR") {
      missingTerritory++;
      warn("No territory yet. It will be imported as \"Needs review\" and you will need to draw the territory on the map.");
    }

    const lat = toNumber(cell(row, "latitude"));
    const lng = toNumber(cell(row, "longitude"));
    if (centerLatitude === null && lat !== null && lng !== null) {
      if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && !(lat === 0 && lng === 0)) {
        centerLatitude = lat;
        centerLongitude = lng;
      } else {
        warn("The centre coordinates are not valid and were ignored.");
      }
    } else if ((lat === null) !== (lng === null)) {
      warn("Only one of latitude / longitude was given, so the centre was ignored.");
    }

    rows.push({
      rowNumber: row.rowNumber,
      beatNumber,
      name,
      postOfficeId: officeId,
      postOfficeName: officeName,
      territoryState,
      hasCentre: centerLatitude !== null,
      status,
      messages
    });
    if (status !== "ERROR" && officeId) {
      importable.push({ rowNumber: row.rowNumber, beatNumber, name, postOfficeId: officeId, territory, centerLatitude, centerLongitude });
    }
  }

  const count = (s: RowStatus) => rows.filter((r) => r.status === s).length;
  return {
    check: {
      rows,
      fileProblems,
      summary: {
        totalRows: rows.length,
        importable: importable.length,
        ready: count("READY"),
        warnings: count("WARNING"),
        errors: count("ERROR"),
        duplicates,
        missingTerritory,
        invalidTerritory
      }
    },
    importable: fileProblems.length > 0 ? [] : importable
  };
}

/** The error report the administrator can download: one line per row that has a problem. */
export function errorReportCsv(rows: CheckedRow[]): string {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [["Row", "Beat number", "Beat name", "Result", "What to fix"].map(esc).join(",")];
  for (const r of rows) {
    if (r.status === "READY") continue;
    lines.push(
      [r.rowNumber, r.beatNumber, r.name, r.status === "ERROR" ? "Will not be imported" : "Imported with a warning", r.messages.join(" ")]
        .map(esc)
        .join(",")
    );
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}

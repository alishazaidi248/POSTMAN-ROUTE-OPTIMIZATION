import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import ExcelJS from "exceljs";
import pdfParse from "pdf-parse";
import { AppError } from "../../utils/AppError";
import { prisma } from "../../config/prisma";
import { Polygon, analyseTerritory, parseTerritoryCell } from "./territory";
import { canonical, normalizeValue } from "../addressing/normalize";

/**
 * Beat-list import: reading a CSV/XLSX beat list, working out which column is which,
 * and checking every row BEFORE anything reaches the database. Nothing here writes;
 * the routes hold the parsed list (BeatImport) until the administrator confirms.
 *
 * The list's own column names are never assumed: columns are matched by common names
 * (Beat No, Beat Name, Sector, Post Office, Boundary, Latitude, ...) and the
 * administrator can correct any match in the wizard.
 */

export const BEAT_FIELDS = ["beatNumber", "name", "postOffice", "territory", "latitude", "longitude", "locality", "mainArea", "pincode"] as const;
export type BeatField = (typeof BEAT_FIELDS)[number];
export type BeatMapping = Record<BeatField, string | null>;

export const BEAT_FIELD_LABELS: Record<BeatField, string> = {
  beatNumber: "Beat number",
  name: "Beat name / sector",
  postOffice: "Post office",
  territory: "Territory (boundary)",
  latitude: "Centre latitude",
  longitude: "Centre longitude",
  locality: "Locality (one per row)",
  mainArea: "Main area",
  pincode: "Pincode"
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
  name: ["beat_name", "name", "sector", "sector_name", "beat_area", "area", "area_name", "beat_description", "description"],
  postOffice: ["post_office", "post_office_name", "postoffice", "office", "office_name", "po", "post_office_code", "office_code", "sub_office", "so"],
  territory: ["territory", "boundary", "polygon", "geojson", "wkt", "geometry", "boundary_geojson", "territory_boundary", "area_boundary"],
  latitude: ["latitude", "lat", "center_latitude", "centre_latitude", "center_lat", "centre_lat"],
  longitude: ["longitude", "lng", "lon", "long", "center_longitude", "centre_longitude", "center_lng", "centre_lng"],
  locality: ["locality", "localities", "locality_name", "beat_locality", "colony", "locality_colony"],
  mainArea: ["main_area", "mainarea", "main_area_name", "sub_area", "sub_locality", "chawl", "society", "landmark"],
  pincode: ["pincode", "pin_code", "pin", "postal_code", "zip", "zip_code"]
};

/** The order fields claim columns in: the specific ones first, so "Locality" is never taken for the beat name. */
const MAPPING_ORDER: BeatField[] = ["locality", "mainArea", "beatNumber", "name", "postOffice", "territory", "latitude", "longitude", "pincode"];

const normalizeHeader = (h: string) => h.trim().toLowerCase().replace(/[\s\-/]+/g, "_");

export function suggestBeatMapping(columns: string[]): BeatMapping {
  const mapping = Object.fromEntries(BEAT_FIELDS.map((f) => [f, null])) as BeatMapping;
  const used = new Set<string>();
  const normalized = columns.map((raw) => ({ raw, n: normalizeHeader(raw) }));
  // Exact names first (so "beat_name" is not taken as the beat NUMBER), then looser containment.
  for (const field of MAPPING_ORDER) {
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
  if (ext === ".pdf") {
    const buffer = fs.readFileSync(filePath);
    let text: string;
    let numPages: number;
    try {
      const data = await pdfParse(buffer);
      text = data.text ?? "";
      numPages = data.numpages ?? 1;
    } catch {
      throw AppError.badRequest("This file could not be read as a PDF. Please check it opens correctly in a PDF viewer.");
    }
    // Same OCR-required heuristic as the delivery-list PDF reader: a scanned page yields almost no extracted text.
    const meaningfulChars = text.replace(/\s/g, "").length;
    if (meaningfulChars < 20 * Math.max(1, numPages)) {
      throw AppError.badRequest(
        "This PDF has no readable text (it is a scan or an image). Please export the beat list as Excel or CSV, or as a text-based PDF."
      );
    }
    // A PDF has no cell grid: columns are separated by a tab or by two-or-more spaces, the same
    // heuristic used for delivery-list PDFs elsewhere in the app.
    const grid = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split(/\t|\s{2,}/).map((c) => c.trim()));
    return tableFromGrid(grid);
  }
  throw AppError.badRequest("Only Excel (.xlsx), CSV (.csv) or a text-based PDF (.pdf) beat list is supported.");
}

// ── checking the rows ──────────────────────────────────────────────────────

export type RowStatus = "READY" | "WARNING" | "ERROR";
export type TerritoryState = "PRESENT" | "MISSING" | "INVALID";
/** What a row does when imported: starts a beat, adds a locality to a beat, or nothing (and says why in its messages). */
export type RowAction = "NEW_BEAT" | "ADD_LOCALITY" | "SKIPPED";

export interface CheckedRow {
  rowNumber: number;
  beatNumber: string;
  name: string;
  locality: string;
  mainArea: string;
  postOfficeId: string | null;
  postOfficeName: string;
  territoryState: TerritoryState;
  hasCentre: boolean;
  status: RowStatus;
  action: RowAction;
  messages: string[];
}

export interface PreviewSummary {
  totalRows: number;
  /** Beats that will be created or receive localities (ready + warnings). */
  importable: number;
  ready: number;
  warnings: number;
  errors: number;
  duplicates: number;
  missingTerritory: number;
  invalidTerritory: number;
  /** The list has one row per (beat, locality) - a beat number may repeat. */
  structured: boolean;
  /** Distinct beats that do not exist yet and will be created. */
  newBeats: number;
  /** Beats that already exist and only receive localities. */
  existingBeats: number;
  /** Locality records that will be added to the beat directory. */
  localityRecords: number;
  /** Rows repeating a (beat, locality, main area) that is already in the file or the directory: reported, adding nothing. */
  duplicateLocalityRows: number;
  /** Rows naming a post office the system does not know. */
  unknownPostOffices: number;
  missingBeatNumbers: number;
  /** New beats that end up with no locality at all (they can only be found by name until localities are added). */
  beatsWithoutLocality: number;
}

export interface BeatListCheck {
  rows: CheckedRow[];
  summary: PreviewSummary;
  /** Problems with the file as a whole (e.g. no beat-number column). */
  fileProblems: string[];
}

export interface ImportableLocality {
  rowNumber: number;
  locality: string;
  mainArea: string | null;
  pincode: string | null;
}

export interface ImportableBeat {
  rowNumber: number;
  beatNumber: string;
  name: string;
  postOfficeId: string;
  territory: Polygon | null;
  centerLatitude: number | null;
  centerLongitude: number | null;
  /** Set when the beat already exists: only its localities are added. */
  existingBeatId: string | null;
  localities: ImportableLocality[];
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
/** Comparison form of a locality / main area (spelling variants and abbreviations unified, like the matcher does). */
const localityKey = (s: string) => canonical(normalizeValue(s));

function toNumber(text: string): number | null {
  if (!text) return null;
  const n = Number(text.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Checks every row against the mapping, the post offices and the beats that already exist.
 * `scopeOfficeId`: the administrator's own office (rows naming another office are refused);
 * a super administrator passes undefined and may import into any office.
 *
 * Two kinds of list are understood:
 *   - one row per beat (no locality column): a beat number that repeats is a duplicate;
 *   - one row per (beat, locality) (a locality and/or main-area column is mapped): the rows of one beat number are ONE
 *     beat with several localities, which become the beat directory the address matcher reads. Rows that repeat a
 *     (beat, locality, main area) are reported as duplicates and add nothing - never dropped silently.
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
  // India Post names offices with a role suffix (S.O. = Sub Office, H.O. = Head Office, B.O. = Branch Office,
  // or the spelled-out "Post Office" / "PO"). A beat list and the seeded office record often use different
  // suffixes for the same office ("Bhandup West So" vs "Bhandup West Post Office"), so suffixes are stripped
  // before comparing, as a fallback below the exact and partial matches.
  const stripOfficeSuffix = (s: string) => s.replace(/\b(s\.?\s*o\.?|h\.?\s*o\.?|b\.?\s*o\.?|post\s*office|po)\.?\s*$/i, "").trim();
  const officeByCore = new Map<string, string>();
  for (const o of offices) {
    const core = norm(stripOfficeSuffix(o.name));
    if (core && !officeByCore.has(core)) officeByCore.set(core, o.id);
  }
  const findOffice = (text: string): string | null => {
    const n = norm(text);
    const exact = officeByText.get(n);
    if (exact) return exact;
    const partial = offices.filter((o) => norm(o.name).includes(n) || n.includes(norm(o.name)));
    if (partial.length === 1) return partial[0].id;
    const core = norm(stripOfficeSuffix(text));
    const coreExact = core ? officeByCore.get(core) : undefined;
    if (coreExact) return coreExact;
    const corePartial = offices.filter((o) => {
      const oc = norm(stripOfficeSuffix(o.name));
      return oc && (oc.includes(core) || core.includes(oc));
    });
    return corePartial.length === 1 ? corePartial[0].id : null;
  };

  const structured = !!(mapping.locality || mapping.mainArea);
  const fileProblems: string[] = [];
  if (!mapping.beatNumber) fileProblems.push("No column has been chosen for the beat number.");
  if (table.rows.length === 0) fileProblems.push("The file has no beats in it.");

  const existing = await prisma.beat.findMany({ select: { id: true, postOfficeId: true, beatNumber: true } });
  const existingBeatId = new Map(existing.map((b) => [`${b.postOfficeId}|${norm(b.beatNumber)}`, b.id]));
  const existingLocalities = new Set(
    (await prisma.beatLocality.findMany({ select: { beatId: true, normalizedLocality: true, normalizedMainArea: true } })).map(
      (l) => `${l.beatId}|${l.normalizedLocality}|${l.normalizedMainArea}`
    )
  );

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
  const beats = new Map<string, ImportableBeat>();
  const seenLocalities = new Map<string, number>(); // beat key | locality | main area -> first row number
  let duplicates = 0;
  let missingTerritory = 0;
  let invalidTerritory = 0;
  let duplicateLocalityRows = 0;
  let unknownPostOffices = 0;
  let missingBeatNumbers = 0;

  for (const { row, beatNumber, officeText, officeId } of identity) {
    const messages: string[] = [];
    let status = "READY" as RowStatus;
    let action: RowAction = "NEW_BEAT";
    const fail = (m: string) => {
      messages.push(m);
      status = "ERROR";
    };
    const warn = (m: string) => {
      messages.push(m);
      if (status !== "ERROR") status = "WARNING";
    };

    // beat number
    if (!beatNumber) {
      missingBeatNumbers++;
      fail("The beat number is missing.");
    } else if (beatNumber.length > 30) fail("The beat number is too long (30 characters at most).");

    // post office
    let officeName = officeId ? (officeById.get(officeId)?.name ?? "") : "";
    if (officeText && !officeId) {
      officeName = officeText;
      unknownPostOffices++;
      fail(`The post office "${officeText}" was not recognised.`);
    } else if (officeId && scope.scopeOfficeId && officeId !== scope.scopeOfficeId) {
      fail(`This beat belongs to ${officeName}, which is not your post office.`);
    }

    const beatKey = beatNumber && officeId ? `${officeId}|${norm(beatNumber)}` : null;
    const dbBeatId = beatKey ? (existingBeatId.get(beatKey) ?? null) : null;

    // duplicates: a repeated beat number is only a duplicate in a one-row-per-beat list
    let isDuplicate = false;
    if (beatKey && !structured) {
      const same = rowsByKey.get(beatKey) ?? [];
      if (same.length > 1) {
        isDuplicate = true;
        fail(`Beat number ${beatNumber} appears more than once in the file (rows ${same.join(", ")}).`);
      }
      if (dbBeatId) {
        isDuplicate = true;
        fail(`Beat ${beatNumber} already exists in ${officeName || "this post office"}.`);
      }
    }
    if (isDuplicate) duplicates++;

    // name
    const givenName = cell(row, "name");
    let name = givenName;
    if (!name && beatNumber) {
      name = `Beat ${beatNumber}`;
      if (mapping.name && !structured) warn("The beat has no name, so it will be called \"Beat " + beatNumber + "\".");
    }
    if (name.length > 120) fail("The beat name is too long (120 characters at most).");

    // locality (the beat directory)
    const locality = cell(row, "locality");
    const mainArea = cell(row, "mainArea");
    const pincodeText = cell(row, "pincode");
    const pincode = /^[1-9]\d{5}$/.test(pincodeText) ? pincodeText : "";
    if (pincodeText && !pincode) warn(`"${pincodeText}" is not a 6-digit pincode and was ignored.`);
    if (locality.length > 200 || mainArea.length > 200) fail("The locality or main area is too long (200 characters at most).");
    if (structured && !locality && mainArea) fail("A main area was given without its locality.");
    if (structured && locality && localityKey(locality) === "") fail("The locality has no readable words.");

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
        if (officeId) {
          const verdict = await analyseTerritory(prisma, territory, {
            postOfficeId: officeId,
            excludeBeatId: dbBeatId ?? undefined,
            beatNumber
          });
          if (verdict.valid) {
            territoryState = "PRESENT";
            centerLatitude = verdict.centerLatitude;
            centerLongitude = verdict.centerLongitude;
            if (verdict.overlaps.length > 0) warn(verdict.overlaps.map((o) => o.message).join(" "));
          } else {
            territory = null;
            territoryState = "INVALID";
            invalidTerritory++;
            fail(verdict.problems.join(" "));
          }
        } else {
          // The post office could not be resolved (already an error above); geometry cannot be checked
          // against a specific office's other beats without knowing which office it belongs to.
          territoryState = "INVALID";
          invalidTerritory++;
          territory = null;
        }
      }
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

    // what the row contributes
    if (status !== "ERROR" && beatKey && officeId) {
      const localityRecord = locality
        ? { rowNumber: row.rowNumber, locality, mainArea: mainArea || null, pincode: pincode || null }
        : null;
      const recordKey = localityRecord ? `${beatKey}|${localityKey(locality)}|${localityKey(mainArea)}` : null;

      let alreadyInFile: number | undefined;
      let alreadyInDirectory = false;
      if (recordKey) {
        alreadyInFile = seenLocalities.get(recordKey);
        alreadyInDirectory = !!dbBeatId && existingLocalities.has(`${dbBeatId}|${localityKey(locality)}|${localityKey(mainArea)}`);
      }

      let beat = beats.get(beatKey);
      if (localityRecord && (alreadyInFile !== undefined || alreadyInDirectory)) {
        action = "SKIPPED";
        duplicateLocalityRows++;
        warn(
          alreadyInFile !== undefined
            ? `Repeats row ${alreadyInFile} (same beat, locality and main area). It adds nothing.`
            : `Beat ${beatNumber} already lists this locality and main area. It adds nothing.`
        );
      } else if (structured && !localityRecord && (dbBeatId || beat)) {
        action = "SKIPPED";
        warn(dbBeatId ? `Beat ${beatNumber} already exists and this row names no locality, so there is nothing to add.` : `Beat ${beatNumber} is already defined by an earlier row and this row names no locality.`);
      } else {
        if (!beat) {
          beat = {
            rowNumber: row.rowNumber,
            beatNumber,
            name,
            postOfficeId: officeId,
            territory,
            centerLatitude,
            centerLongitude,
            existingBeatId: dbBeatId,
            localities: []
          };
          beats.set(beatKey, beat);
          action = dbBeatId ? "ADD_LOCALITY" : "NEW_BEAT";
          if (dbBeatId) warn(`Beat ${beatNumber} already exists; its localities are added to it.`);
          else if (!territory) warn("No territory yet. It will be imported as \"Needs review\" and you will need to draw the territory on the map.");
        } else {
          action = "ADD_LOCALITY";
          if (givenName && beat.name !== givenName && !/^Beat /.test(beat.name) && !dbBeatId) warn(`Named "${givenName}" here but "${beat.name}" on an earlier row; the first name is kept.`);
          if (!beat.territory && territory) {
            beat.territory = territory;
            beat.centerLatitude = centerLatitude;
            beat.centerLongitude = centerLongitude;
          }
          if (beat.name.startsWith("Beat ") && givenName && !dbBeatId) beat.name = givenName;
        }
        if (localityRecord) {
          beat.localities.push(localityRecord);
          seenLocalities.set(recordKey!, row.rowNumber);
        }
      }
    } else {
      action = "SKIPPED";
    }

    rows.push({
      rowNumber: row.rowNumber,
      beatNumber,
      name,
      locality,
      mainArea,
      postOfficeId: officeId,
      postOfficeName: officeName,
      territoryState,
      hasCentre: centerLatitude !== null,
      status,
      action,
      messages
    });
  }

  // A beat with no territory needs one drawn later (counted once per beat, not once per locality row).
  for (const beat of beats.values()) {
    if (!beat.existingBeatId && !beat.territory) missingTerritory++;
  }

  const importable = [...beats.values()];
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
        invalidTerritory,
        structured,
        newBeats: importable.filter((b) => !b.existingBeatId).length,
        existingBeats: importable.filter((b) => b.existingBeatId).length,
        localityRecords: importable.reduce((n, b) => n + b.localities.length, 0),
        duplicateLocalityRows,
        unknownPostOffices,
        missingBeatNumbers,
        beatsWithoutLocality: importable.filter((b) => !b.existingBeatId && b.localities.length === 0).length
      }
    },
    importable: fileProblems.length > 0 ? [] : importable
  };
}

/** The error report the administrator can download: one line per row that has a problem. */
export function errorReportCsv(rows: CheckedRow[]): string {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  // The locality columns only appear for a list that has localities (one row per beat and locality).
  const withLocality = rows.some((r) => r.locality || r.mainArea);
  const head = ["Row", "Beat number", "Beat name", ...(withLocality ? ["Locality", "Main area"] : []), "Result", "What to fix"];
  const lines = [head.map(esc).join(",")];
  for (const r of rows) {
    if (r.status === "READY") continue;
    const result = r.status === "ERROR" ? "Will not be imported" : r.action === "SKIPPED" ? "Skipped (adds nothing)" : "Imported with a warning";
    const cells = [r.rowNumber, r.beatNumber, r.name, ...(withLocality ? [r.locality, r.mainArea] : []), result, r.messages.join(" ")];
    lines.push(cells.map(esc).join(","));
  }
  return "\ufeff" + lines.join("\r\n") + "\r\n";
}

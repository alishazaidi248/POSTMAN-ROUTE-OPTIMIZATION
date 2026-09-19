import fs from "fs";
import { parse } from "csv-parse/sync";
import ExcelJS from "exceljs";
// pdf-parse has no types export path that plays well with strict esModuleInterop; require keeps it simple.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse = require("pdf-parse");
import { AppError } from "../../utils/AppError";

export interface ParsedTable {
  columns: string[];
  rows: Record<string, string>[];
  sheetNames?: string[];
  activeSheet?: string;
  ocrRequired?: boolean;
  ocrConfidenceByRow?: number[];
}

export function parseCsv(filePath: string): ParsedTable {
  const content = fs.readFileSync(filePath, "utf-8");
  const records: Record<string, string>[] = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true
  });

  const columns = records.length > 0 ? Object.keys(records[0]) : [];
  return { columns, rows: records };
}

export async function parseXlsx(filePath: string, sheetName?: string): Promise<ParsedTable> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const sheetNames = workbook.worksheets.map((ws) => ws.name);
  const worksheet = sheetName ? workbook.getWorksheet(sheetName) : workbook.worksheets[0];

  if (!worksheet) {
    throw AppError.badRequest(`Sheet not found: ${sheetName}`);
  }

  const headerRow = worksheet.getRow(1);
  const columns: string[] = [];
  headerRow.eachCell((cell, colNumber) => {
    columns[colNumber - 1] = String(cell.value ?? `column_${colNumber}`);
  });

  const rows: Record<string, string>[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const record: Record<string, string> = {};
    columns.forEach((col, idx) => {
      const cell = row.getCell(idx + 1);
      record[col] = cell.value != null ? String(cell.value) : "";
    });
    if (Object.values(record).some((v) => v !== "")) rows.push(record);
  });

  return { columns, rows, sheetNames, activeSheet: worksheet.name };
}

export async function listXlsxSheets(filePath: string): Promise<{ name: string; rowCount: number }[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  return workbook.worksheets.map((ws) => ({ name: ws.name, rowCount: ws.rowCount - 1 }));
}

/**
 * Text-based PDF extraction. If the extracted text is empty/near-empty the
 * PDF is almost certainly a scanned image and OCR is required — this
 * service flags that rather than silently returning garbage (spec §10).
 * Actual OCR (e.g. Tesseract) is not wired in yet; ocrRequired signals the
 * admin UI to route the file to manual review instead of guessing.
 */
export async function parsePdf(filePath: string): Promise<ParsedTable> {
  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);
  const text: string = data.text ?? "";

  const meaningfulChars = text.replace(/\s/g, "").length;
  const ocrRequired = meaningfulChars < 20 * Math.max(1, data.numpages ?? 1);

  if (ocrRequired) {
    return { columns: [], rows: [], ocrRequired: true };
  }

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  // Best-effort heuristic table extraction: split on 2+ spaces or tabs.
  const rows = lines.map((line) => line.split(/\t|\s{2,}/).map((c) => c.trim()));
  const maxCols = Math.max(0, ...rows.map((r) => r.length));
  const columns = Array.from({ length: maxCols }, (_, i) => `column_${i + 1}`);

  const records = rows.map((r) => {
    const record: Record<string, string> = {};
    columns.forEach((col, idx) => (record[col] = r[idx] ?? ""));
    return record;
  });

  return { columns, rows: records, ocrRequired: false };
}

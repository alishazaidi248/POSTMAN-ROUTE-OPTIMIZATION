import path from "path";
import fs from "fs/promises";
import { randomUUID } from "crypto";
import { AppError } from "../../utils/AppError";
import { env } from "../../config/env";

const ALLOWED_MIME_TYPES: Record<string, string> = {
  "text/csv": "CSV",
  "application/vnd.ms-excel": "CSV",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
  "application/pdf": "PDF"
};

const ALLOWED_EXTENSIONS = new Set([".csv", ".xlsx", ".pdf"]);

export function detectFileType(originalName: string, mimeType: string): "CSV" | "XLSX" | "PDF" {
  const ext = path.extname(originalName).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw AppError.badRequest(`Unsupported file extension: ${ext}`);
  }

  const byMime = ALLOWED_MIME_TYPES[mimeType];
  if (byMime) return byMime as "CSV" | "XLSX" | "PDF";

  // Fall back to extension when the client sent a generic/octet-stream mime type.
  if (ext === ".csv") return "CSV";
  if (ext === ".xlsx") return "XLSX";
  if (ext === ".pdf") return "PDF";

  throw AppError.badRequest("Could not verify file type from extension or MIME type");
}

export function safeStoredFilename(originalName: string): string {
  const ext = path.extname(originalName).toLowerCase();
  return `${randomUUID()}${ext}`;
}

export async function ensureUploadDirs() {
  await fs.mkdir(path.join(env.uploadDir, "tmp"), { recursive: true });
  await fs.mkdir(path.join(env.uploadDir, "rejected"), { recursive: true });
}

export async function cleanupTempFile(filePath: string) {
  try {
    await fs.unlink(filePath);
  } catch {
    // already removed or never persisted — nothing to clean up
  }
}

import { ImportFileType, ImportRowStatus, ParcelPriority, Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { logger } from "../../config/logger";
import { AppError } from "../../utils/AppError";
import { suggestColumnMapping, SystemField } from "./columnMapping";
import { parseCsv, parseXlsx, parsePdf, ParsedTable } from "./parsers";
import { normalizeAndValidateRow } from "./validation";
import { getGeocodingService } from "../geocoding";
import { assignDeliveryToBeat } from "../assignment.service";
import { GeocodeOutcome, createDeliveryRecords } from "../delivery.service";
import { recordAudit } from "../audit.service";

export async function parseUploadedFile(filePath: string, fileType: ImportFileType, sheetName?: string): Promise<ParsedTable> {
  switch (fileType) {
    case "CSV":
      return parseCsv(filePath);
    case "XLSX":
      return parseXlsx(filePath, sheetName);
    case "PDF":
      return parsePdf(filePath);
    default:
      throw AppError.badRequest(`Unsupported file type: ${fileType}`);
  }
}

export async function createImportWithPreview(params: {
  postOfficeId: string;
  uploadedById: string;
  originalFilename: string;
  storedFilename: string;
  fileType: ImportFileType;
  filePath: string;
  sheetName?: string;
  columnMapping?: Record<string, string | null>;
}) {
  const parsed = await parseUploadedFile(params.filePath, params.fileType, params.sheetName);

  if (parsed.ocrRequired) {
    const importRecord = await prisma.deliveryImport.create({
      data: {
        postOfficeId: params.postOfficeId,
        uploadedById: params.uploadedById,
        originalFilename: params.originalFilename,
        storedFilename: params.storedFilename,
        fileType: params.fileType,
        sheetName: params.sheetName,
        status: "FAILED",
        errorSummary: "Scanned PDF detected: OCR extraction is required but not available in this environment. Please re-upload as CSV/XLSX or a text-based PDF."
      }
    });
    return { import: importRecord, preview: null, ocrRequired: true };
  }

  const mapping = params.columnMapping ?? suggestColumnMapping(parsed.columns);

  const importRecord = await prisma.deliveryImport.create({
    data: {
      postOfficeId: params.postOfficeId,
      uploadedById: params.uploadedById,
      originalFilename: params.originalFilename,
      storedFilename: params.storedFilename,
      fileType: params.fileType,
      sheetName: parsed.activeSheet,
      columnMapping: mapping as any,
      totalRows: parsed.rows.length,
      status: "PROCESSING"
    }
  });

  const seenTrackingIds = new Set<string>();
  const seenPhoneAddress = new Set<string>();
  let validCount = 0, invalidCount = 0, duplicateCount = 0, missingCount = 0;

  const rowsData = [];
  for (let i = 0; i < parsed.rows.length; i++) {
    const raw = parsed.rows[i];
    const result = normalizeAndValidateRow(raw, mapping);

    let status: ImportRowStatus = result.status as ImportRowStatus;

    if (status === "VALID") {
      const trackingKey = result.normalized.trackingId!;
      const dupKey = `${result.normalized.phone}|${result.normalized.addressLine1}`.toLowerCase();

      const existingTracking = await prisma.delivery.findUnique({ where: { trackingId: trackingKey } });

      if (seenTrackingIds.has(trackingKey) || seenPhoneAddress.has(dupKey) || existingTracking) {
        status = "DUPLICATE";
        duplicateCount++;
      } else {
        seenTrackingIds.add(trackingKey);
        seenPhoneAddress.add(dupKey);
        validCount++;
      }
    } else if (status === "MISSING_DATA") {
      missingCount++;
    } else {
      invalidCount++;
    }

    rowsData.push({
      importId: importRecord.id,
      rowNumber: i + 1,
      rawData: raw as any,
      normalizedData: result.normalized as any,
      status,
      errors: result.errors.length ? (result.errors as any) : undefined
    });
  }

  await prisma.deliveryImportRow.createMany({ data: rowsData });

  const updatedImport = await prisma.deliveryImport.update({
    where: { id: importRecord.id },
    data: {
      validRows: validCount,
      invalidRows: invalidCount,
      duplicateRows: duplicateCount,
      missingDataRows: missingCount,
      status: "PREVIEW_READY"
    }
  });

  return { import: updatedImport, preview: await getImportPreview(importRecord.id), ocrRequired: false };
}

export async function getImportPreview(importId: string) {
  const rows = await prisma.deliveryImportRow.findMany({
    where: { importId },
    orderBy: { rowNumber: "asc" },
    take: 500
  });
  return rows;
}

/**
 * Re-runs validation (and duplicate detection) over every stored row with a new
 * column mapping. The raw rows are in PostgreSQL, so this never needs the
 * original file. Only a PREVIEW_READY import can be re-mapped; nothing has been
 * created as a delivery yet at that point.
 */
export async function remapImport(importId: string, mapping: Record<string, string | null>) {
  const importRecord = await prisma.deliveryImport.findUniqueOrThrow({ where: { id: importId } });
  if (importRecord.status !== "PREVIEW_READY") {
    throw AppError.conflict(`The column mapping can only be changed while the import is awaiting review (status: ${importRecord.status})`);
  }

  const rows = await prisma.deliveryImportRow.findMany({ where: { importId }, orderBy: { rowNumber: "asc" } });

  const seenTrackingIds = new Set<string>();
  const seenPhoneAddress = new Set<string>();
  let validCount = 0, invalidCount = 0, duplicateCount = 0, missingCount = 0;

  const updates: Prisma.PrismaPromise<unknown>[] = [];
  for (const row of rows) {
    const result = normalizeAndValidateRow(row.rawData as Record<string, string>, mapping);
    let status: ImportRowStatus = result.status as ImportRowStatus;

    if (status === "VALID") {
      const trackingKey = result.normalized.trackingId!;
      const dupKey = `${result.normalized.phone}|${result.normalized.addressLine1}`.toLowerCase();
      const existingTracking = await prisma.delivery.findUnique({ where: { trackingId: trackingKey } });
      if (seenTrackingIds.has(trackingKey) || seenPhoneAddress.has(dupKey) || existingTracking) {
        status = "DUPLICATE";
        duplicateCount++;
      } else {
        seenTrackingIds.add(trackingKey);
        seenPhoneAddress.add(dupKey);
        validCount++;
      }
    } else if (status === "MISSING_DATA") missingCount++;
    else invalidCount++;

    updates.push(
      prisma.deliveryImportRow.update({
        where: { id: row.id },
        data: {
          status,
          normalizedData: result.normalized as any,
          errors: result.errors.length ? (result.errors as any) : Prisma.DbNull
        }
      })
    );
  }

  const importUpdate = prisma.deliveryImport.update({
    where: { id: importId },
    data: {
      columnMapping: mapping as any,
      validRows: validCount,
      invalidRows: invalidCount,
      duplicateRows: duplicateCount,
      missingDataRows: missingCount
    }
  });
  const results = await prisma.$transaction([...updates, importUpdate]);
  return results[results.length - 1];
}

/**
 * Confirms an import: geocodes each valid row, writes Recipient + Address +
 * Delivery in one transaction per row, then runs PostGIS beat matching and postman
 * assignment. Everything is committed to PostgreSQL row by row, so:
 *   - nothing is lost if the server stops half way (rows already IMPORTED stay);
 *   - one bad row (a tracking id another import created meanwhile, a database
 *     error) is marked and skipped instead of aborting — and wedging — the import;
 *   - if the whole run fails the import returns to PREVIEW_READY so it can be
 *     confirmed again, and only the remaining VALID rows are processed;
 *   - two simultaneous confirms cannot both run (an atomic status claim).
 */
export async function confirmImport(importId: string, userId: string) {
  const claim = await prisma.deliveryImport.updateMany({
    where: { id: importId, status: "PREVIEW_READY" },
    data: { status: "PROCESSING" }
  });
  if (claim.count === 0) {
    const current = await prisma.deliveryImport.findUniqueOrThrow({ where: { id: importId } });
    throw AppError.conflict(`Import is not in a confirmable state: ${current.status}`);
  }

  const importRecord = await prisma.deliveryImport.findUniqueOrThrow({ where: { id: importId } });
  let successCount = 0, geocodingFailed = 0, assignmentFailed = 0, duplicates = 0, failedRows = 0;

  try {
    const validRows = await prisma.deliveryImportRow.findMany({ where: { importId, status: "VALID" }, orderBy: { rowNumber: "asc" } });
    const geocoder = getGeocodingService();

    for (const row of validRows) {
      const data = row.normalizedData as any;

      // A delivery with this tracking id may have appeared since the preview.
      if (await prisma.delivery.findUnique({ where: { trackingId: data.trackingId }, select: { id: true } })) {
        await prisma.deliveryImportRow.update({
          where: { id: row.id },
          data: { status: "DUPLICATE", errors: ["Tracking id already exists"] as any }
        });
        duplicates++;
        continue;
      }

      const geocodeResult = await geocoder
        .geocode({
          addressLine1: data.addressLine1,
          addressLine2: data.addressLine2,
          area: data.area,
          city: data.city,
          state: data.state,
          pincode: data.pincode
        })
        .catch((err): GeocodeOutcome => {
          logger.warn({ err, row: row.rowNumber }, "geocoding threw; recording as FAILED");
          return { status: "FAILED", latitude: 0, longitude: 0, confidence: 0, source: "error" };
        });

      let deliveryId: string;
      try {
        deliveryId = await prisma.$transaction(async (tx) => {
          const created = await createDeliveryRecords(
            tx,
            {
              postOfficeId: importRecord.postOfficeId,
              trackingId: data.trackingId,
              recipient: { name: data.recipientName, phone: data.phone, altPhone: data.altPhone },
              address: {
                addressLine1: data.addressLine1,
                addressLine2: data.addressLine2,
                area: data.area,
                city: data.city,
                state: data.state,
                pincode: data.pincode
              },
              parcelType: data.parcelType,
              priority: parsePriority(data.priority),
              serviceTimeMinutes: data.serviceTime,
              importRowId: row.id
            },
            geocodeResult
          );
          await tx.deliveryImportRow.update({ where: { id: row.id }, data: { status: "IMPORTED" } });
          return created.deliveryId;
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        logger.error({ err, row: row.rowNumber, importId }, "import row failed; skipping");
        await prisma.deliveryImportRow.update({
          where: { id: row.id },
          data: { status: "INVALID", errors: [`Could not be saved: ${message.split("\n").pop()}`] as any }
        });
        failedRows++;
        continue;
      }

      successCount++;

      if (geocodeResult.status === "SUCCESS") {
        try {
          const result = await assignDeliveryToBeat(deliveryId, geocodeResult.latitude, geocodeResult.longitude);
          if (result.status !== "ASSIGNED") assignmentFailed++;
        } catch (err) {
          // The delivery is saved; repairUnassignedDeliveries() will assign it.
          logger.error({ err, deliveryId }, "beat assignment failed after the delivery was saved");
          assignmentFailed++;
        }
      } else {
        geocodingFailed++;
      }
    }

    const counts = await prisma.deliveryImportRow.groupBy({ by: ["status"], where: { importId }, _count: true });
    const countOf = (s: ImportRowStatus) => counts.find((c) => c.status === s)?._count ?? 0;

    const finalImport = await prisma.deliveryImport.update({
      where: { id: importId },
      data: {
        status: "CONFIRMED",
        successfulRows: (importRecord.successfulRows ?? 0) + successCount,
        geocodingFailedRows: (importRecord.geocodingFailedRows ?? 0) + geocodingFailed,
        assignmentFailedRows: (importRecord.assignmentFailedRows ?? 0) + assignmentFailed,
        duplicateRows: countOf("DUPLICATE"),
        invalidRows: countOf("INVALID"),
        errorSummary: failedRows > 0 ? `${failedRows} row(s) could not be saved - see the row errors` : null
      }
    });

    await recordAudit({
      userId,
      action: "IMPORT_CONFIRMED",
      entityType: "DeliveryImport",
      entityId: importId,
      newValue: { successCount, geocodingFailed, assignmentFailed, duplicates, failedRows }
    });

    return finalImport;
  } catch (err) {
    // Nothing already saved is undone; the import just becomes confirmable again.
    await prisma.deliveryImport.updateMany({ where: { id: importId, status: "PROCESSING" }, data: { status: "PREVIEW_READY" } });
    throw err;
  }
}

function parsePriority(value: unknown): ParcelPriority {
  const p = typeof value === "string" ? value.trim().toUpperCase() : "";
  return (["LOW", "NORMAL", "HIGH", "URGENT"] as const).includes(p as ParcelPriority) ? (p as ParcelPriority) : "NORMAL";
}

/** A confirmed import cannot be cancelled: its deliveries already exist. */
export async function cancelImport(importId: string, userId: string) {
  const result = await prisma.deliveryImport.updateMany({
    where: { id: importId, status: { in: ["UPLOADED", "PROCESSING", "PREVIEW_READY", "FAILED"] } },
    data: { status: "CANCELLED" }
  });
  if (result.count === 0) {
    const current = await prisma.deliveryImport.findUniqueOrThrow({ where: { id: importId } });
    throw AppError.conflict(`Import cannot be cancelled: ${current.status}`);
  }

  await recordAudit({ userId, action: "IMPORT_CANCELLED", entityType: "DeliveryImport", entityId: importId });
  return prisma.deliveryImport.findUniqueOrThrow({ where: { id: importId } });
}

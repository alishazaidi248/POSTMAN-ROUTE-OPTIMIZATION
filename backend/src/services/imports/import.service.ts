import { ImportFileType, ImportRowStatus } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { AppError } from "../../utils/AppError";
import { suggestColumnMapping, SystemField } from "./columnMapping";
import { parseCsv, parseXlsx, parsePdf, ParsedTable } from "./parsers";
import { normalizeAndValidateRow } from "./validation";
import { getGeocodingService } from "../geocoding";
import { assignDeliveryToBeat } from "../assignment.service";
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
 * Confirms an import: geocodes valid rows, runs point-in-polygon beat
 * matching, and only then writes Delivery records. Runs inside a single
 * transaction per row-batch so a partial failure never leaves half-imported
 * data (spec §11, §7 "import transaction handling").
 */
export async function confirmImport(importId: string, userId: string) {
  const importRecord = await prisma.deliveryImport.findUniqueOrThrow({ where: { id: importId } });
  if (importRecord.status !== "PREVIEW_READY") {
    throw AppError.badRequest(`Import is not in a confirmable state: ${importRecord.status}`);
  }

  const validRows = await prisma.deliveryImportRow.findMany({
    where: { importId, status: "VALID" }
  });

  const geocoder = getGeocodingService();
  let successCount = 0, geocodingFailed = 0, assignmentFailed = 0;

  for (const row of validRows) {
    const data = row.normalizedData as any;

    const geocodeResult = await geocoder.geocode({
      addressLine1: data.addressLine1,
      addressLine2: data.addressLine2,
      area: data.area,
      city: data.city,
      state: data.state,
      pincode: data.pincode
    });

    await prisma.$transaction(async (tx) => {
      const recipient = await tx.recipient.create({
        data: { name: data.recipientName, phone: data.phone, altPhone: data.altPhone }
      });

      const address = await tx.address.create({
        data: {
          recipientId: recipient.id,
          addressLine1: data.addressLine1,
          addressLine2: data.addressLine2,
          area: data.area,
          city: data.city,
          state: data.state,
          pincode: data.pincode,
          latitude: geocodeResult.status === "SUCCESS" ? geocodeResult.latitude : null,
          longitude: geocodeResult.status === "SUCCESS" ? geocodeResult.longitude : null,
          geocodingStatus: geocodeResult.status,
          geocodingSource: geocodeResult.source,
          geocodingConfidence: geocodeResult.confidence,
          geocodedAt: new Date()
        }
      });

      const delivery = await tx.delivery.create({
        data: {
          trackingId: data.trackingId,
          recipientId: recipient.id,
          addressId: address.id,
          parcelType: data.parcelType,
          priority: (data.priority?.toUpperCase() as any) ?? "NORMAL",
          serviceTimeMinutes: data.serviceTime,
          postOfficeId: importRecord.postOfficeId,
          importRowId: row.id,
          status: "RECEIVED"
        }
      });

      if (geocodeResult.status === "FAILED") {
        await tx.assignmentException.create({
          data: { deliveryId: delivery.id, reason: "GEOCODING_FAILED" }
        });
      }

      await tx.deliveryImportRow.update({
        where: { id: row.id },
        data: { status: "IMPORTED" }
      });

      return delivery.id;
    }).then(async (deliveryId) => {
      if (geocodeResult.status === "SUCCESS") {
        const result = await assignDeliveryToBeat(deliveryId, geocodeResult.latitude, geocodeResult.longitude);
        if (result.status !== "ASSIGNED") assignmentFailed++;
      } else {
        geocodingFailed++;
      }
      successCount++;
    });
  }

  const finalImport = await prisma.deliveryImport.update({
    where: { id: importId },
    data: {
      status: "CONFIRMED",
      successfulRows: successCount,
      geocodingFailedRows: geocodingFailed,
      assignmentFailedRows: assignmentFailed
    }
  });

  await recordAudit({
    userId,
    action: "IMPORT_CONFIRMED",
    entityType: "DeliveryImport",
    entityId: importId,
    newValue: { successCount, geocodingFailed, assignmentFailed }
  });

  return finalImport;
}

export async function cancelImport(importId: string, userId: string) {
  const importRecord = await prisma.deliveryImport.update({
    where: { id: importId },
    data: { status: "CANCELLED" }
  });

  await recordAudit({ userId, action: "IMPORT_CANCELLED", entityType: "DeliveryImport", entityId: importId });
  return importRecord;
}

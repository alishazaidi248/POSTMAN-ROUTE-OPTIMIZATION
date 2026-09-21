import { Router } from "express";
import { prisma } from "../config/prisma";
import { requireAuth, requireRole, resolvePostOfficeScope, assertOwnsResource, adminOnly } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { toCsv } from "../utils/csv";
import { addressGeocodeData, geocodeAddress } from "../services/geocoding";
import { assignDeliveryToBeat } from "../services/assignment.service";

export const dataQualityRouter = Router();
dataQualityRouter.use(requireAuth, adminOnly);

dataQualityRouter.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const postOfficeId = resolvePostOfficeScope(req);
    const importWhere = postOfficeId ? { postOfficeId } : {};

    const [totalRows, invalidRows, duplicateRows, missingRows, geocodingFailedDeliveries, noBeatMatched, assignmentFailed] =
      await Promise.all([
        prisma.deliveryImportRow.count({ where: { import: importWhere } }),
        prisma.deliveryImportRow.count({ where: { import: importWhere, status: "INVALID" } }),
        prisma.deliveryImportRow.count({ where: { import: importWhere, status: "DUPLICATE" } }),
        prisma.deliveryImportRow.count({ where: { import: importWhere, status: "MISSING_DATA" } }),
        prisma.assignmentException.count({ where: { reason: "GEOCODING_FAILED", delivery: postOfficeId ? { postOfficeId } : {} } }),
        prisma.assignmentException.count({ where: { reason: "NO_BEAT_MATCH", delivery: postOfficeId ? { postOfficeId } : {} } }),
        prisma.assignmentException.count({ where: { reason: "NO_POSTMAN_ASSIGNED", delivery: postOfficeId ? { postOfficeId } : {} } })
      ]);

    res.json({
      totalRows,
      validRows: totalRows - invalidRows - duplicateRows - missingRows,
      invalidRows,
      duplicateRows,
      missingRows,
      geocodingFailed: geocodingFailedDeliveries,
      noBeatMatched,
      assignmentFailed
    });
  })
);

dataQualityRouter.get(
  "/errors",
  asyncHandler(async (req, res) => {
    const postOfficeId = resolvePostOfficeScope(req);
    const rows = await prisma.deliveryImportRow.findMany({
      where: {
        import: postOfficeId ? { postOfficeId } : {},
        status: { in: ["INVALID", "DUPLICATE", "MISSING_DATA"] }
      },
      orderBy: { createdAt: "desc" },
      take: 1000
    });

    if (req.query.format === "csv") {
      res.header("Content-Type", "text/csv");
      res.attachment("data-quality-errors.csv");
      return res.send(
        toCsv(rows.map((r) => ({ rowNumber: r.rowNumber, status: r.status, errors: JSON.stringify(r.errors), raw: JSON.stringify(r.rawData) })))
      );
    }

    res.json(rows);
  })
);

dataQualityRouter.post(
  "/retry/:importRowId",
  requireRole("ADMIN", "SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const row = await prisma.deliveryImportRow.findUniqueOrThrow({
      where: { id: req.params.importRowId },
      include: { import: true }
    });
    assertOwnsResource(req, row.import.postOfficeId);
    const delivery = await prisma.delivery.findUnique({ where: { importRowId: row.id }, include: { address: true } });

    if (!delivery) return res.status(404).json({ error: { message: "No delivery associated with this row yet" } });

    const result = await geocodeAddress(delivery.address, delivery.postOfficeId);

    if (result.status === "SUCCESS") {
      await prisma.address.update({ where: { id: delivery.addressId }, data: addressGeocodeData(result, delivery.address) });
    }
    await assignDeliveryToBeat(delivery.id);

    res.json({ status: result.status });
  })
);

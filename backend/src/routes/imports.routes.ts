import { Router } from "express";
import multer from "multer";
import path from "path";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { requireAuth, requireRole, resolvePostOfficeScope, assertOwnsResource, adminOnly } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { AppError } from "../utils/AppError";
import { env } from "../config/env";
import { detectFileType } from "../services/imports/fileSecurity";
import { listXlsxSheets } from "../services/imports/parsers";
import { createImportWithPreview, getImportPreview, confirmImport, cancelImport, remapImport } from "../services/imports/import.service";
import { SYSTEM_FIELDS } from "../services/imports/columnMapping";
import { validate } from "../middleware/validate";
import { recordAudit } from "../services/audit.service";

export const importsRouter = Router();
importsRouter.use(requireAuth, adminOnly);

const upload = multer({
  dest: path.join(env.uploadDir, "tmp"),
  limits: { fileSize: env.maxUploadSizeMb * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [".csv", ".xlsx", ".pdf"];
    if (!allowed.includes(path.extname(file.originalname).toLowerCase())) {
      return cb(new Error("Unsupported file extension"));
    }
    cb(null, true);
  }
});

importsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const postOfficeId = resolvePostOfficeScope(req);
    const imports = await prisma.deliveryImport.findMany({
      where: postOfficeId ? { postOfficeId } : undefined,
      include: { uploadedBy: { select: { name: true, email: true } } },
      orderBy: { createdAt: "desc" }
    });
    res.json(imports);
  })
);

importsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const importRecord = await prisma.deliveryImport.findUniqueOrThrow({
      where: { id: req.params.id },
      include: { uploadedBy: { select: { name: true, email: true } } }
    });
    assertOwnsResource(req, importRecord.postOfficeId);
    res.json(importRecord);
  })
);

importsRouter.get(
  "/:id/rows",
  asyncHandler(async (req, res) => {
    const importRecord = await prisma.deliveryImport.findUniqueOrThrow({ where: { id: req.params.id } });
    assertOwnsResource(req, importRecord.postOfficeId);
    const rows = await getImportPreview(req.params.id);
    res.json(rows);
  })
);

importsRouter.post(
  "/upload",
  requireRole("ADMIN", "SUPER_ADMIN"),
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw AppError.badRequest("No file uploaded");

    // A regular Admin's post office is implied by their account. A Super
    // Admin has no single home office, but forcing them to pick one before
    // every upload is unnecessary friction — default to the first active
    // post office instead of blocking the upload.
    let postOfficeId = resolvePostOfficeScope(req);
    if (!postOfficeId) {
      const defaultPostOffice = await prisma.postOffice.findFirst({
        where: { isActive: true },
        orderBy: { name: "asc" }
      });
      if (!defaultPostOffice) throw AppError.badRequest("No post office exists to import deliveries into yet");
      postOfficeId = defaultPostOffice.id;
    }

    const fileType = detectFileType(req.file.originalname, req.file.mimetype);

    if (fileType === "XLSX") {
      const sheets = await listXlsxSheets(req.file.path);
      if (sheets.length > 1 && !req.query.sheet) {
        return res.json({ needsSheetSelection: true, sheets, tempPath: req.file.filename, originalFilename: req.file.originalname });
      }
    }

    const result = await createImportWithPreview({
      postOfficeId,
      uploadedById: req.user!.sub,
      originalFilename: req.file.originalname,
      storedFilename: req.file.filename,
      fileType,
      filePath: req.file.path,
      sheetName: req.query.sheet as string | undefined
    });

    if (result.ocrRequired) {
      await recordAudit({ req, action: "IMPORT_FAILED", entityType: "DeliveryImport", entityId: result.import.id, reason: "OCR_REQUIRED" });
    } else {
      await recordAudit({ req, action: "DELIVERY_IMPORTED", entityType: "DeliveryImport", entityId: result.import.id });
    }

    res.status(201).json(result);
  })
);

importsRouter.put(
  "/:id/mapping",
  requireRole("ADMIN", "SUPER_ADMIN"),
  validate(
    z.object({
      body: z.object({
        columnMapping: z
          .record(z.enum(SYSTEM_FIELDS), z.string().nullable())
          .refine((m) => !!m.recipientName && !!m.addressLine1 && !!m.city && !!m.state && !!m.pincode && !!m.phone, {
            message: "recipientName, phone, addressLine1, city, state and pincode must each be mapped to a column"
          })
      })
    })
  ),
  asyncHandler(async (req, res) => {
    const existing = await prisma.deliveryImport.findUniqueOrThrow({ where: { id: req.params.id } });
    assertOwnsResource(req, existing.postOfficeId);
    // Re-validates every stored row with the new mapping, so the preview the admin
    // confirms is exactly what will be written.
    const updated = await remapImport(req.params.id, req.body.columnMapping);
    res.json(updated);
  })
);

importsRouter.post(
  "/:id/confirm",
  requireRole("ADMIN", "SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const existing = await prisma.deliveryImport.findUniqueOrThrow({ where: { id: req.params.id } });
    assertOwnsResource(req, existing.postOfficeId);
    const result = await confirmImport(req.params.id, req.user!.sub);
    res.json(result);
  })
);

importsRouter.post(
  "/:id/cancel",
  requireRole("ADMIN", "SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const existing = await prisma.deliveryImport.findUniqueOrThrow({ where: { id: req.params.id } });
    assertOwnsResource(req, existing.postOfficeId);
    const result = await cancelImport(req.params.id, req.user!.sub);
    res.json(result);
  })
);

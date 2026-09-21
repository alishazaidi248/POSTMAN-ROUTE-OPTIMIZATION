import { NextFunction, Request, RequestHandler, Response, Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs/promises";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { env } from "../config/env";
import { requireAuth, adminOnly, resolvePostOfficeScope, assertOwnsResource } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../utils/asyncHandler";
import { AppError } from "../utils/AppError";
import { recordAudit } from "../services/audit.service";
import {
  BEAT_FIELDS,
  BEAT_FIELD_LABELS,
  BeatMapping,
  RawRow,
  checkBeatList,
  errorReportCsv,
  readBeatListFile,
  suggestBeatMapping
} from "../services/beats/beatListImport";

/**
 * Beat-list import, in the steps the administrator sees:
 *   POST /beats/import            upload -> the list is read and held (BeatImport), nothing is imported
 *   GET  /beats/import/:id        the checked list (every row: ready / warning / error)
 *   PUT  /beats/import/:id/mapping  correct which column is which; the list is checked again
 *   GET  /beats/import/:id/errors.csv  the error report
 *   POST /beats/import/:id/confirm  only now are beats written to PostgreSQL
 *   POST /beats/import/:id/cancel
 * Mounted BEFORE the beats router so "import" is never read as a beat id.
 */
export const beatImportRouter = Router();
beatImportRouter.use(requireAuth, adminOnly);

const MAX_ROWS = 2000;

const upload = multer({
  dest: path.join(env.uploadDir, "tmp"),
  limits: { fileSize: env.maxUploadSizeMb * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== ".csv" && ext !== ".xlsx") return cb(new Error("UNSUPPORTED"));
    cb(null, true);
  }
});

/** multer's own errors become a plain message instead of a server error. */
const uploadOne: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  upload.single("file")(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof Error && err.message === "UNSUPPORTED") {
      return next(AppError.badRequest("Only Excel (.xlsx) and CSV (.csv) beat lists can be uploaded."));
    }
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return next(AppError.badRequest(`This file is too large (the limit is ${env.maxUploadSizeMb} MB).`));
    }
    return next(AppError.badRequest("The file could not be uploaded. Please try again."));
  });
};

async function defaultOfficeId(req: Request): Promise<string> {
  const scope = resolvePostOfficeScope(req);
  if (scope) return scope;
  const office = await prisma.postOffice.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!office) throw AppError.badRequest("There is no post office to import beats into.");
  return office.id;
}

async function loadImport(req: Request) {
  const record = await prisma.beatImport.findUnique({ where: { id: req.params.id } });
  if (!record) throw AppError.notFound("This upload could not be found.");
  assertOwnsResource(req, record.postOfficeId);
  return record;
}

async function buildPreview(req: Request, record: Awaited<ReturnType<typeof loadImport>>) {
  const mapping = record.columnMapping as unknown as BeatMapping;
  const rows = record.rawRows as unknown as RawRow[];
  const destination = await prisma.postOffice.findUniqueOrThrow({ where: { id: record.postOfficeId }, select: { name: true } });
  const { check, importable } = await checkBeatList({ rows }, mapping, {
    scopeOfficeId: resolvePostOfficeScope(req),
    defaultOfficeId: record.postOfficeId
  });
  return {
    record,
    importable,
    preview: {
      id: record.id,
      fileName: record.originalFilename,
      fileSize: record.fileSize,
      sheetName: record.sheetName,
      status: record.status,
      importedCount: record.importedCount,
      destinationPostOffice: destination.name,
      columns: record.columns as string[],
      mapping,
      fields: BEAT_FIELDS.map((key) => ({ key, label: BEAT_FIELD_LABELS[key], required: key === "beatNumber" })),
      ...check
    }
  };
}

beatImportRouter.post(
  "/",
  uploadOne,
  asyncHandler(async (req, res) => {
    if (!req.file) throw AppError.badRequest("Please choose a beat list to upload.");
    const file = req.file;
    try {
      const table = await readBeatListFile(file.path, file.originalname);
      if (table.columns.length === 0) throw AppError.badRequest("This file is empty. Please choose a beat list that has a header row and at least one beat.");
      if (table.rows.length > MAX_ROWS) throw AppError.badRequest(`This file has ${table.rows.length} rows; up to ${MAX_ROWS} beats can be imported at once.`);

      const record = await prisma.beatImport.create({
        data: {
          postOfficeId: await defaultOfficeId(req),
          uploadedById: req.user!.sub,
          originalFilename: file.originalname,
          fileSize: file.size,
          sheetName: table.sheetName,
          columns: table.columns as unknown as Prisma.InputJsonValue,
          rawRows: table.rows as unknown as Prisma.InputJsonValue,
          columnMapping: suggestBeatMapping(table.columns) as unknown as Prisma.InputJsonValue
        }
      });
      const { preview } = await buildPreview(req, record);
      res.status(201).json(preview);
    } finally {
      await fs.rm(file.path, { force: true });
    }
  })
);

beatImportRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const { preview } = await buildPreview(req, await loadImport(req));
    res.json(preview);
  })
);

beatImportRouter.put(
  "/:id/mapping",
  validate(
    z.object({
      body: z.object({
        mapping: z.object(Object.fromEntries(BEAT_FIELDS.map((f) => [f, z.string().nullable()])) as Record<(typeof BEAT_FIELDS)[number], z.ZodNullable<z.ZodString>>)
      })
    })
  ),
  asyncHandler(async (req, res) => {
    const record = await loadImport(req);
    if (record.status !== "PREVIEW_READY") throw AppError.badRequest("This upload has already been finished.");
    const columns = record.columns as string[];
    const mapping = req.body.mapping as BeatMapping;
    for (const field of BEAT_FIELDS) {
      const chosen = mapping[field];
      if (chosen !== null && !columns.includes(chosen)) throw AppError.badRequest("One of the chosen columns is not in the file.");
    }
    const updated = await prisma.beatImport.update({ where: { id: record.id }, data: { columnMapping: mapping as unknown as Prisma.InputJsonValue } });
    const { preview } = await buildPreview(req, updated);
    res.json(preview);
  })
);

beatImportRouter.get(
  "/:id/errors.csv",
  asyncHandler(async (req, res) => {
    const { preview } = await buildPreview(req, await loadImport(req));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="beat-list-problems.csv"`);
    res.send(errorReportCsv(preview.rows));
  })
);

beatImportRouter.post(
  "/:id/confirm",
  asyncHandler(async (req, res) => {
    const { record, importable, preview } = await buildPreview(req, await loadImport(req));
    if (record.status !== "PREVIEW_READY") throw AppError.badRequest("This beat list has already been imported or cancelled.");
    if (preview.fileProblems.length > 0) throw AppError.badRequest(preview.fileProblems[0]);
    if (importable.length === 0) throw AppError.badRequest("There are no beats that can be imported. Please fix the problems in the file and upload it again.");

    let created: string[];
    try {
      created = await prisma.$transaction(
        async (tx) => {
          const ids: string[] = [];
          for (const beat of importable) {
            const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
              INSERT INTO "Beat" (id, "postOfficeId", beat_number, name, boundary, "centerLatitude", "centerLongitude", status, metadata,
                                  "verificationStatus", "createdAt", "updatedAt")
              VALUES (gen_random_uuid(), ${beat.postOfficeId}, ${beat.beatNumber}, ${beat.name},
                      ${beat.territory ? Prisma.sql`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(beat.territory)}), 4326)` : Prisma.sql`NULL`},
                      ${beat.centerLatitude}, ${beat.centerLongitude}, 'ACTIVE',
                      ${JSON.stringify({ importId: record.id, sourceRow: beat.rowNumber })}::jsonb,
                      ${beat.territory ? "PENDING_VERIFICATION" : "NEEDS_REVIEW"}::"BeatVerificationStatus", now(), now())
              RETURNING id
            `);
            ids.push(rows[0].id);
          }
          await tx.beatImport.update({
            where: { id: record.id },
            data: { status: "CONFIRMED", importedCount: ids.length, confirmedAt: new Date() }
          });
          return ids;
        },
        { timeout: 60_000 }
      );
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw AppError.conflict("One of these beats was added by someone else while you were reviewing. Please upload the list again to check it.");
      }
      throw err;
    }

    await recordAudit({
      req,
      action: "BEAT_IMPORTED",
      entityType: "BeatImport",
      entityId: record.id,
      newValue: { file: record.originalFilename, imported: created.length, skipped: preview.summary.errors, beatIds: created }
    });
    // Imported beats wait for verification; nothing is matched to them until then.
    res.status(201).json({ imported: created.length, skipped: preview.summary.errors, beatIds: created });
  })
);

beatImportRouter.post(
  "/:id/cancel",
  asyncHandler(async (req, res) => {
    const record = await loadImport(req);
    if (record.status === "PREVIEW_READY") {
      await prisma.beatImport.update({ where: { id: record.id }, data: { status: "CANCELLED" } });
    }
    res.json({ cancelled: true });
  })
);

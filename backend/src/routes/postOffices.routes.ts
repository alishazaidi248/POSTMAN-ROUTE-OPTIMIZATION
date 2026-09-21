import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { requireAuth, requireRole, adminOnly, assertOwnsResource } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../utils/asyncHandler";
import { recordAudit } from "../services/audit.service";

export const postOfficesRouter = Router();
postOfficesRouter.use(requireAuth, adminOnly);

postOfficesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    // SUPER_ADMIN sees all post offices; ADMIN/POSTMAN only their own (spec §44).
    const where = req.user!.role === "SUPER_ADMIN" ? {} : { id: req.user!.postOfficeId ?? "__none__" };
    const postOffices = await prisma.postOffice.findMany({ where, orderBy: { name: "asc" } });
    res.json(postOffices);
  })
);

const upsertSchema = z.object({
  body: z.object({
    code: z.string().min(1),
    name: z.string().min(1),
    addressLine: z.string().min(1),
    city: z.string().min(1),
    state: z.string().min(1),
    pincode: z.string().length(6),
    latitude: z.number(),
    longitude: z.number()
  })
});

postOfficesRouter.post(
  "/",
  requireRole("SUPER_ADMIN"),
  validate(upsertSchema),
  asyncHandler(async (req, res) => {
    const created = await prisma.postOffice.create({ data: req.body });
    await recordAudit({ req, action: "USER_CREATED", entityType: "PostOffice", entityId: created.id, newValue: created });
    res.status(201).json(created);
  })
);

postOfficesRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const postOffice = await prisma.postOffice.findUniqueOrThrow({ where: { id: req.params.id } });
    assertOwnsResource(req, postOffice.id);
    res.json(postOffice);
  })
);

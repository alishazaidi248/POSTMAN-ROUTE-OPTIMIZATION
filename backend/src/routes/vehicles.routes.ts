import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { VehicleStatus } from "@prisma/client";
import { requireAuth, requireRole, resolvePostOfficeScope, assertCanWriteToPostOffice, assertOwnsResource } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../utils/asyncHandler";
import { recordAudit } from "../services/audit.service";

export const vehiclesRouter = Router();
vehiclesRouter.use(requireAuth);

vehiclesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const postOfficeId = resolvePostOfficeScope(req);
    const vehicles = await prisma.vehicle.findMany({
      where: postOfficeId ? { postOfficeId } : undefined,
      include: { assignedPostman: { select: { id: true, name: true } } },
      orderBy: { assetId: "asc" }
    });
    res.json(vehicles);
  })
);

const vehicleSchema = z.object({
  body: z.object({
    assetId: z.string().min(1),
    postOfficeId: z.string().uuid(),
    model: z.string().min(1),
    batteryCapacityWh: z.number().int().positive()
  })
});

vehiclesRouter.post(
  "/",
  requireRole("ADMIN", "SUPER_ADMIN"),
  validate(vehicleSchema),
  asyncHandler(async (req, res) => {
    assertCanWriteToPostOffice(req, req.body.postOfficeId);
    const created = await prisma.vehicle.create({ data: req.body });
    await recordAudit({ req, action: "VEHICLE_CREATED", entityType: "Vehicle", entityId: created.id, newValue: created });
    res.status(201).json(created);
  })
);

const vehicleUpdateSchema = z.object({
  body: z.object({
    model: z.string().min(1).optional(),
    batteryCapacityWh: z.number().int().positive().optional(),
    status: z.nativeEnum(VehicleStatus).optional(),
    assignedPostmanId: z.string().uuid().nullable().optional(),
    lastMaintenanceAt: z.string().datetime().optional()
  })
});

vehiclesRouter.put(
  "/:id",
  requireRole("ADMIN", "SUPER_ADMIN"),
  validate(vehicleUpdateSchema),
  asyncHandler(async (req, res) => {
    const before = await prisma.vehicle.findUniqueOrThrow({ where: { id: req.params.id } });
    assertOwnsResource(req, before.postOfficeId);

    if (req.body.assignedPostmanId) {
      const postman = await prisma.postman.findUniqueOrThrow({ where: { id: req.body.assignedPostmanId } });
      assertOwnsResource(req, postman.postOfficeId);
    }

    const { lastMaintenanceAt, ...rest } = req.body;
    const updated = await prisma.vehicle.update({
      where: { id: req.params.id },
      data: { ...rest, lastMaintenanceAt: lastMaintenanceAt ? new Date(lastMaintenanceAt) : undefined }
    });
    await recordAudit({ req, action: "VEHICLE_UPDATED", entityType: "Vehicle", entityId: updated.id, oldValue: before, newValue: updated });
    res.json(updated);
  })
);

vehiclesRouter.post(
  "/:id/battery-log",
  requireRole("ADMIN", "SUPER_ADMIN"),
  validate(z.object({ body: z.object({ batteryPercentage: z.number().min(0).max(100) }) })),
  asyncHandler(async (req, res) => {
    const vehicle = await prisma.vehicle.findUniqueOrThrow({ where: { id: req.params.id } });
    assertOwnsResource(req, vehicle.postOfficeId);
    const log = await prisma.vehicleBatteryLog.create({
      data: { vehicleId: req.params.id, batteryPercentage: req.body.batteryPercentage }
    });
    await prisma.vehicle.update({ where: { id: req.params.id }, data: { currentBatteryPercentage: req.body.batteryPercentage } });
    res.status(201).json(log);
  })
);

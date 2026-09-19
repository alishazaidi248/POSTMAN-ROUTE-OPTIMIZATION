import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { requireAuth, requireRole, assertOwnsResource } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../utils/asyncHandler";
import { getGeocodingService } from "../services/geocoding";
import { assignDeliveryToBeat } from "../services/assignment.service";

export const geocodingRouter = Router();
geocodingRouter.use(requireAuth);

geocodingRouter.post(
  "/retry/:addressId",
  requireRole("ADMIN", "SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    const address = await prisma.address.findUniqueOrThrow({ where: { id: req.params.addressId } });
    const owningDelivery = await prisma.delivery.findFirst({ where: { addressId: address.id } });
    if (owningDelivery) assertOwnsResource(req, owningDelivery.postOfficeId);
    const result = await getGeocodingService().geocode(address);

    const updated = await prisma.address.update({
      where: { id: address.id },
      data: {
        latitude: result.status === "SUCCESS" ? result.latitude : address.latitude,
        longitude: result.status === "SUCCESS" ? result.longitude : address.longitude,
        geocodingStatus: result.status,
        geocodingSource: result.source,
        geocodingConfidence: result.confidence,
        geocodedAt: new Date()
      }
    });

    if (result.status === "SUCCESS") {
      const delivery = await prisma.delivery.findFirst({ where: { addressId: address.id } });
      if (delivery) await assignDeliveryToBeat(delivery.id, result.latitude, result.longitude);
    }

    res.json(updated);
  })
);

geocodingRouter.post(
  "/manual/:addressId",
  requireRole("ADMIN", "SUPER_ADMIN"),
  validate(z.object({ body: z.object({ latitude: z.number(), longitude: z.number() }) })),
  asyncHandler(async (req, res) => {
    const delivery = await prisma.delivery.findFirst({ where: { addressId: req.params.addressId } });
    if (delivery) assertOwnsResource(req, delivery.postOfficeId);

    const updated = await prisma.address.update({
      where: { id: req.params.addressId },
      data: {
        latitude: req.body.latitude,
        longitude: req.body.longitude,
        geocodingStatus: "MANUAL",
        geocodingSource: "manual",
        geocodingConfidence: 1,
        geocodedAt: new Date()
      }
    });

    if (delivery) await assignDeliveryToBeat(delivery.id, req.body.latitude, req.body.longitude);

    res.json(updated);
  })
);

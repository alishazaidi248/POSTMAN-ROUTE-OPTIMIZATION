import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { requireAuth, requireRole, assertOwnsResource, adminOnly } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../utils/asyncHandler";
import { AppError } from "../utils/AppError";
import { addressGeocodeData, manualGeocode, retryAddressGeocode } from "../services/geocoding";
import { assignDeliveryToBeat } from "../services/assignment.service";

export const geocodingRouter = Router();
geocodingRouter.use(requireAuth, adminOnly);

geocodingRouter.post(
  "/retry/:addressId",
  requireRole("ADMIN", "SUPER_ADMIN"),
  asyncHandler(async (req, res) => {
    // An address with no delivery has no owner to check against, and is not reachable via retryAddressGeocode
    // either (it throws notFound), so the ownership check happens first against the delivery it does have.
    const owningDelivery = await prisma.delivery.findFirst({ where: { addressId: req.params.addressId } });
    if (!owningDelivery) throw AppError.notFound("Address not found");
    assertOwnsResource(req, owningDelivery.postOfficeId);

    // Re-match whatever the outcome: a failed retry must not leave a stale exception, and a better location may
    // settle a beat the name could not (retryAddressGeocode does both, and is the same function "Retry Geocode All"
    // calls, so there is exactly one implementation of "retry" to keep correct).
    const { address } = await retryAddressGeocode(req.params.addressId);

    res.json(address);
  })
);

geocodingRouter.post(
  "/manual/:addressId",
  requireRole("ADMIN", "SUPER_ADMIN"),
  validate(z.object({ body: z.object({ latitude: z.number(), longitude: z.number() }) })),
  asyncHandler(async (req, res) => {
    const delivery = await prisma.delivery.findFirst({ where: { addressId: req.params.addressId } });
    if (!delivery) throw AppError.notFound("Address not found");
    assertOwnsResource(req, delivery.postOfficeId);

    const address = await prisma.address.findUniqueOrThrow({ where: { id: req.params.addressId } });
    const updated = await prisma.address.update({
      where: { id: address.id },
      data: addressGeocodeData(manualGeocode(req.body.latitude, req.body.longitude), address, { manual: true })
    });

    await assignDeliveryToBeat(delivery.id);

    res.json(updated);
  })
);

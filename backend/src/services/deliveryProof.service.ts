import { prisma } from "../config/prisma";
import { env } from "../config/env";
import { AppError } from "../utils/AppError";
import { validateImage } from "./storage/imageStorage";
import { removeProofPhoto, saveProofPhoto } from "./storage/proofStorage";
import { recordAudit } from "./audit.service";

/**
 * Proof of delivery. What a post office requires is a setting (PostOffice.proofMode): NONE (a status change is
 * enough), PHOTO (the postman photographs the delivery) or SIGNATURE (the recipient signs on screen). The server
 * enforces it - the apps only help the postman comply - so a delivery cannot be COMPLETED without its proof
 * whatever a client sends. Either way the proof is one image (a photo or a rasterised signature); DeliveryProof.type
 * records which.
 *
 * Not implemented, on purpose: OTP (needs an SMS provider this system does not have). ProofMode is an enum, so it
 * can be added as another value with its own check here, the way SIGNATURE was.
 */
export function proofRequiredMessage(mode: "PHOTO" | "SIGNATURE"): string {
  return mode === "SIGNATURE"
    ? "The recipient's signature is required to complete this delivery. Capture it first."
    : "A photo of the delivery is required to complete it. Take the photo first.";
}

export async function isProofRequired(deliveryId: string): Promise<boolean> {
  const delivery = await prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId }, select: { postOffice: { select: { proofMode: true } } } });
  return delivery.postOffice.proofMode !== "NONE";
}

/** Throws unless a delivery that needs proof has it. Called before a delivery may become DELIVERED. */
export async function assertProofPresent(deliveryId: string): Promise<void> {
  const delivery = await prisma.delivery.findUniqueOrThrow({
    where: { id: deliveryId },
    select: { postOffice: { select: { proofMode: true } }, proof: { select: { id: true } } }
  });
  const mode = delivery.postOffice.proofMode;
  if (mode !== "NONE" && !delivery.proof) {
    throw AppError.badRequest(proofRequiredMessage(mode), { proofRequired: true });
  }
}

export interface ProofInput {
  deliveryId: string;
  buffer: Buffer | undefined;
  userId: string;
  /** PHOTO (camera) or SIGNATURE (drawn on screen, rasterised to a PNG client-side) - both are stored as one image. */
  type?: "PHOTO" | "SIGNATURE";
  latitude?: number;
  longitude?: number;
  capturedAt?: Date;
}

/** Stores the proof for a delivery that is out for delivery (a new one replaces the old one, of either type). */
export async function saveDeliveryProof(input: ProofInput) {
  const delivery = await prisma.delivery.findUniqueOrThrow({ where: { id: input.deliveryId }, include: { proof: true } });
  if (delivery.status !== "OUT_FOR_DELIVERY") {
    throw AppError.conflict(`Proof can only be added while the delivery is out for delivery (it is ${delivery.status}).`);
  }
  const image = validateImage(input.buffer, env.maxProofPhotoMb * 1024 * 1024);
  const storageKey = await saveProofPhoto(image);
  const data = {
    type: input.type ?? "PHOTO",
    storageKey,
    contentType: `image/${image.type}`,
    sizeBytes: image.buffer.length,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    capturedById: input.userId,
    capturedAt: input.capturedAt ?? new Date()
  };
  try {
    const proof = await prisma.deliveryProof.upsert({ where: { deliveryId: input.deliveryId }, create: { deliveryId: input.deliveryId, ...data }, update: data });
    await removeProofPhoto(delivery.proof?.storageKey);
    await recordAudit({ userId: input.userId, action: "DELIVERY_PROOF_ADDED", entityType: "Delivery", entityId: input.deliveryId, newValue: { proofId: proof.id, sizeBytes: proof.sizeBytes } });
    return { id: proof.id, capturedAt: proof.capturedAt, contentType: proof.contentType, sizeBytes: proof.sizeBytes };
  } catch (err) {
    await removeProofPhoto(storageKey); // the database did not take it: leave no orphan file
    throw err;
  }
}

import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { env } from "../../config/env";
import { AppError } from "../../utils/AppError";
import { ImageType, ValidatedImage } from "./imageStorage";

/**
 * Delivery-proof photos. Unlike profile pictures these are personal data (a recipient's door, sometimes the recipient), so:
 *   - they live in a PRIVATE folder that is never mounted as static files;
 *   - the only way to read one is GET /deliveries/:id/proof, which checks who is asking (the post office's administrators,
 *     the postman the delivery belongs to);
 *   - the database keeps only the random storage key; the bytes are addressed by nothing an outsider can guess.
 * A production deployment can replace this with object storage (private bucket + signed URLs) behind the same three calls.
 */
const EXTENSION: Record<ImageType, string> = { jpeg: "jpg", png: "png", webp: "webp" };
const KEY = /^[0-9a-f-]{36}\.(jpg|png|webp)$/;

export const proofDirectory = () => path.resolve(env.uploadDir, "private", "proof");

export async function saveProofPhoto(image: ValidatedImage): Promise<string> {
  await fs.mkdir(proofDirectory(), { recursive: true });
  const key = `${randomUUID()}.${EXTENSION[image.type]}`;
  await fs.writeFile(path.join(proofDirectory(), key), image.buffer, { mode: 0o600 });
  return key;
}

/** The file path of a stored key; refuses anything that is not a key this module made (no path traversal). */
export function proofPhotoPath(key: string): string {
  if (!KEY.test(key)) throw AppError.notFound("Proof photo not found");
  return path.join(proofDirectory(), key);
}

export async function removeProofPhoto(key: string | null | undefined): Promise<void> {
  if (!key || !KEY.test(key)) return;
  await fs.rm(path.join(proofDirectory(), key), { force: true });
}

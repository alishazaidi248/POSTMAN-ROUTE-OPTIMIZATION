import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { env } from "../../config/env";
import { AppError } from "../../utils/AppError";

/**
 * Where profile pictures live. The database keeps only the picture's URL (Postman.profilePhotoUrl); the
 * image bytes are kept by an ImageStorage. Development uses the local disk; a production deployment can add
 * another implementation (object storage) behind the same interface without touching the routes or the apps.
 */
export interface ImageStorage {
  /** Stores the image and returns the URL clients should use. The name is random, so URLs cannot be guessed. */
  save(image: ValidatedImage): Promise<string>;
  /** Deletes an image previously returned by save. Missing or foreign URLs are ignored. */
  remove(url: string | null | undefined): Promise<void>;
}

export type ImageType = "jpeg" | "png" | "webp";

export interface ValidatedImage {
  buffer: Buffer;
  type: ImageType;
}

const EXTENSION: Record<ImageType, string> = { jpeg: "jpg", png: "png", webp: "webp" };

/** URL prefix under which app.ts serves the profile pictures. */
export const PROFILE_URL_PREFIX = "/uploads/profile";

/** The real type of an image, from its first bytes (a file name or a client-sent content type can lie). */
export function detectImageType(buffer: Buffer): ImageType | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpeg";
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  return null;
}

/** Throws a plain-language error unless the bytes are a JPEG, PNG or WebP within the size limit. */
export function validateImage(buffer: Buffer | undefined, maxBytes = env.maxProfilePhotoMb * 1024 * 1024): ValidatedImage {
  if (!buffer || buffer.length === 0) throw AppError.badRequest("Please choose a photo to upload.");
  if (buffer.length > maxBytes) {
    throw AppError.badRequest(`This photo is too large. Please choose one under ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  }
  const type = detectImageType(buffer);
  if (!type) throw AppError.badRequest("This file is not a supported photo. Please use a JPEG, PNG or WebP image.");
  return { buffer, type };
}

export class LocalImageStorage implements ImageStorage {
  constructor(private readonly directory: string) {}

  async save(image: ValidatedImage): Promise<string> {
    await fs.mkdir(this.directory, { recursive: true });
    const name = `${randomUUID()}.${EXTENSION[image.type]}`;
    await fs.writeFile(path.join(this.directory, name), image.buffer);
    return `${PROFILE_URL_PREFIX}/${name}`;
  }

  async remove(url: string | null | undefined): Promise<void> {
    if (!url || !url.startsWith(`${PROFILE_URL_PREFIX}/`)) return;
    const name = path.basename(url); // basename: a crafted URL can never point outside the folder
    await fs.rm(path.join(this.directory, name), { force: true });
  }
}

let storage: ImageStorage | null = null;

export function getImageStorage(): ImageStorage {
  if (!storage) storage = new LocalImageStorage(path.resolve(env.uploadDir, "profile"));
  return storage;
}

/** Test seam. Pass null to reset. */
export function setImageStorageForTests(next: ImageStorage | null): void {
  storage = next;
}

export function profileImageDirectory(): string {
  return path.resolve(env.uploadDir, "profile");
}

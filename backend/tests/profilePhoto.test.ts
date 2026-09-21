import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import fs from "fs";
import os from "os";
import path from "path";

const prismaMock = vi.hoisted(() => ({
  postman: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
  auditLog: { create: vi.fn() }
}));
vi.mock("../src/config/prisma", () => ({ prisma: prismaMock }));
vi.mock("../src/config/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }
}));
vi.mock("pino-http", () => ({ default: () => (_req: unknown, _res: unknown, next: () => void) => next() }));
vi.mock("../src/services/routePlanner.service", () => ({ getOrPlanRoute: vi.fn(), recalculateRoute: vi.fn(), recalculateRouteForPostmanId: vi.fn() }));

import { createApp } from "../src/app";
import { env } from "../src/config/env";
import {
  ImageStorage,
  LocalImageStorage,
  PROFILE_URL_PREFIX,
  detectImageType,
  setImageStorageForTests,
  validateImage
} from "../src/services/storage/imageStorage";

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 2)]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP"), Buffer.alloc(100, 3)]);

describe("detectImageType / validateImage", () => {
  it("recognises JPEG, PNG and WebP from their first bytes", () => {
    expect(detectImageType(JPEG)).toBe("jpeg");
    expect(detectImageType(PNG)).toBe("png");
    expect(detectImageType(WEBP)).toBe("webp");
  });

  it("refuses everything else, whatever the file is called", () => {
    expect(detectImageType(Buffer.from("<svg onload=alert(1)></svg>"))).toBeNull();
    expect(detectImageType(Buffer.from("GIF89a...."))).toBeNull();
    expect(detectImageType(Buffer.from("%PDF-1.7"))).toBeNull();
    expect(() => validateImage(Buffer.from("just text"))).toThrow(/not a supported photo/);
  });

  it("refuses an empty upload and one over the size limit, in plain words", () => {
    expect(() => validateImage(undefined)).toThrow(/choose a photo/);
    expect(() => validateImage(Buffer.alloc(0))).toThrow(/choose a photo/);
    expect(() => validateImage(Buffer.concat([JPEG, Buffer.alloc(3000)]), 2048)).toThrow(/too large/);
    expect(validateImage(JPEG).type).toBe("jpeg");
  });
});

describe("LocalImageStorage", () => {
  it("stores under a random name with the right extension, and removes only its own files", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "photos-"));
    const storage = new LocalImageStorage(dir);
    const url = await storage.save({ buffer: PNG, type: "png" });
    expect(url).toMatch(new RegExp(`^${PROFILE_URL_PREFIX}/[0-9a-f-]{36}\\.png$`));
    const file = path.join(dir, path.basename(url));
    expect(fs.existsSync(file)).toBe(true);
    expect((await storage.save({ buffer: PNG, type: "png" })) === url).toBe(false);

    // a crafted URL can never reach outside the folder or another prefix
    const outside = path.join(dir, "..", "keep-me.txt");
    fs.writeFileSync(outside, "x");
    await storage.remove(`${PROFILE_URL_PREFIX}/../keep-me.txt`);
    await storage.remove("https://evil.example/x.png");
    await storage.remove(null);
    expect(fs.existsSync(outside)).toBe(true);
    expect(fs.existsSync(file)).toBe(true);

    await storage.remove(url);
    expect(fs.existsSync(file)).toBe(false);
  });
});

// ── the endpoints ──────────────────────────────────────────────────────────────

const app = createApp();
const token = (over: Record<string, unknown> = {}) =>
  jwt.sign({ sub: "admin-1", role: "ADMIN", postOfficeId: "po1", email: "a@postal.local", ...over }, env.jwtAccessSecret, { expiresIn: "15m" });
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

const store = { saved: [] as string[], removed: [] as (string | null | undefined)[] };
const storage: ImageStorage = {
  save: async () => {
    const url = `${PROFILE_URL_PREFIX}/new-${store.saved.length + 1}.jpg`;
    store.saved.push(url);
    return url;
  },
  remove: async (url) => {
    store.removed.push(url);
  }
};

beforeEach(() => {
  vi.clearAllMocks();
  store.saved.length = 0;
  store.removed.length = 0;
  setImageStorageForTests(storage);
  prismaMock.postman.findUniqueOrThrow.mockResolvedValue({ id: "pm1", postOfficeId: "po1", profilePhotoUrl: `${PROFILE_URL_PREFIX}/old.jpg` });
  prismaMock.postman.update.mockResolvedValue({});
  prismaMock.auditLog.create.mockResolvedValue({});
});

describe("PUT /api/v1/postmen/:id/photo", () => {
  it("stores the photo, saves its URL on the postman, deletes the old file and audits it", async () => {
    const res = await request(app).put("/api/v1/postmen/pm1/photo").set(bearer(token())).attach("photo", JPEG, "me.jpg");
    expect(res.status).toBe(200);
    expect(res.body.photoUrl).toBe(`${PROFILE_URL_PREFIX}/new-1.jpg`);
    expect(prismaMock.postman.update).toHaveBeenCalledWith({ where: { id: "pm1" }, data: { profilePhotoUrl: `${PROFILE_URL_PREFIX}/new-1.jpg` } });
    expect(store.removed).toEqual([`${PROFILE_URL_PREFIX}/old.jpg`]);
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "POSTMAN_UPDATED", entityId: "pm1", reason: "Profile photo changed" }) });
  });

  it("rejects a file that is not a real image even when it is named .jpg, and stores nothing", async () => {
    const res = await request(app).put("/api/v1/postmen/pm1/photo").set(bearer(token())).attach("photo", Buffer.from("MZ not an image"), { filename: "me.jpg", contentType: "image/jpeg" });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/not a supported photo/);
    expect(store.saved).toEqual([]);
    expect(prismaMock.postman.update).not.toHaveBeenCalled();
  });

  it("rejects a photo over the size limit in plain words", async () => {
    const big = Buffer.concat([JPEG, Buffer.alloc(env.maxProfilePhotoMb * 1024 * 1024 + 10)]);
    const res = await request(app).put("/api/v1/postmen/pm1/photo").set(bearer(token())).attach("photo", big, "big.jpg");
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/too large/);
    expect(store.saved).toEqual([]);
  });

  it("rejects a request with no file", async () => {
    const res = await request(app).put("/api/v1/postmen/pm1/photo").set(bearer(token()));
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/choose a photo/i);
  });

  it("does not leave an orphan file when the database refuses the change", async () => {
    prismaMock.postman.update.mockRejectedValueOnce(new Error("db down"));
    const res = await request(app).put("/api/v1/postmen/pm1/photo").set(bearer(token())).attach("photo", PNG, "me.png");
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(store.removed).toEqual([`${PROFILE_URL_PREFIX}/new-1.jpg`]);
  });

  it("is refused for a postman (403), for no token (401) and for another post office's admin (404)", async () => {
    expect((await request(app).put("/api/v1/postmen/pm1/photo").set(bearer(token({ role: "POSTMAN" }))).attach("photo", JPEG, "me.jpg")).status).toBe(403);
    expect((await request(app).put("/api/v1/postmen/pm1/photo").attach("photo", JPEG, "me.jpg")).status).toBe(401);
    expect((await request(app).put("/api/v1/postmen/pm1/photo").set(bearer(token({ postOfficeId: "po2" }))).attach("photo", JPEG, "me.jpg")).status).toBe(404);
    expect(store.saved).toEqual([]);
    expect(prismaMock.postman.update).not.toHaveBeenCalled();
  });

  it("a super administrator may change any office's postman photo", async () => {
    const res = await request(app).put("/api/v1/postmen/pm1/photo").set(bearer(token({ role: "SUPER_ADMIN", postOfficeId: null }))).attach("photo", WEBP, "me.webp");
    expect(res.status).toBe(200);
  });
});

describe("DELETE /api/v1/postmen/:id/photo", () => {
  it("clears the URL and deletes the file, so the initials avatar returns", async () => {
    const res = await request(app).delete("/api/v1/postmen/pm1/photo").set(bearer(token()));
    expect(res.status).toBe(200);
    expect(res.body.photoUrl).toBeNull();
    expect(prismaMock.postman.update).toHaveBeenCalledWith({ where: { id: "pm1" }, data: { profilePhotoUrl: null } });
    expect(store.removed).toEqual([`${PROFILE_URL_PREFIX}/old.jpg`]);
  });

  it("is a no-op when there is no photo, and is refused for a postman or another office", async () => {
    prismaMock.postman.findUniqueOrThrow.mockResolvedValue({ id: "pm1", postOfficeId: "po1", profilePhotoUrl: null });
    expect((await request(app).delete("/api/v1/postmen/pm1/photo").set(bearer(token()))).status).toBe(200);
    expect(prismaMock.postman.update).not.toHaveBeenCalled();
    expect((await request(app).delete("/api/v1/postmen/pm1/photo").set(bearer(token({ role: "POSTMAN" })))).status).toBe(403);
    expect((await request(app).delete("/api/v1/postmen/pm1/photo").set(bearer(token({ postOfficeId: "po2" })))).status).toBe(404);
  });
});

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../../src/config/prisma";
import { createApp } from "../../src/app";
import { hashPassword, checkPasswordPolicy } from "../../src/services/auth.service";
import { makeOffice, resetDatabase } from "./db";

/** The forced first-login password change, through the real API and database. */
const app = createApp();
const TEMPORARY = "temp-Passw0rd-x1";
let officeId: string;

beforeEach(async () => {
  await resetDatabase();
  officeId = (await makeOffice()).id;
  await prisma.user.create({ data: { email: "new.admin@t.local", name: "New Admin", role: "ADMIN", postOfficeId: officeId, passwordHash: await hashPassword(TEMPORARY), mustChangePassword: true } });
  await prisma.user.create({ data: { email: "settled.admin@t.local", name: "Settled", role: "ADMIN", postOfficeId: officeId, passwordHash: await hashPassword(TEMPORARY) } });
});
afterAll(() => prisma.$disconnect());

const login = (email: string, password = TEMPORARY) => request(app).post("/api/v1/auth/login").send({ email, password });
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

describe("an account with a temporary password", () => {
  it("can sign in, and is told it must change the password", async () => {
    const res = await login("new.admin@t.local");
    expect(res.status).toBe(200);
    expect(res.body.mustChangePassword).toBe(true);
    expect(res.body.user.mustChangePassword).toBe(true);
  });

  it("can do NOTHING but read who it is, change the password or sign out - every other endpoint says so", async () => {
    const { accessToken, refreshToken } = (await login("new.admin@t.local")).body;
    expect((await request(app).get("/api/v1/auth/me").set(bearer(accessToken))).status).toBe(200);
    for (const path of ["/api/v1/deliveries", "/api/v1/beats", "/api/v1/postmen", "/api/v1/assignments/exceptions", "/api/v1/dashboard/summary", "/api/v1/notifications"]) {
      const res = await request(app).get(path).set(bearer(accessToken));
      expect(res.status, path).toBe(403);
      expect(res.body.error.details, path).toEqual({ code: "PASSWORD_CHANGE_REQUIRED" });
    }
    expect((await request(app).post("/api/v1/auth/logout").set(bearer(accessToken)).send({ refreshToken })).status).toBe(204);
  });

  it("a refreshed token is still restricted while the password is temporary", async () => {
    const { refreshToken } = (await login("new.admin@t.local")).body;
    const refreshed = await request(app).post("/api/v1/auth/refresh").send({ refreshToken });
    expect((await request(app).get("/api/v1/deliveries").set(bearer(refreshed.body.accessToken))).status).toBe(403);
  });

  it("changing it opens everything, ends the old sessions, and the new password works (the temporary one does not)", async () => {
    const first = (await login("new.admin@t.local")).body;
    const changed = await request(app).post("/api/v1/auth/change-password").set(bearer(first.accessToken)).send({ currentPassword: TEMPORARY, newPassword: "my-own-Secret-42" });
    expect(changed.status).toBe(200);
    expect(changed.body.mustChangePassword).toBe(false);

    expect((await request(app).get("/api/v1/deliveries").set(bearer(changed.body.accessToken))).status).toBe(200);
    expect((await request(app).post("/api/v1/auth/refresh").send({ refreshToken: first.refreshToken })).status).toBe(401); // the old session is over
    expect((await login("new.admin@t.local", "my-own-Secret-42")).body.mustChangePassword).toBe(false);
    expect((await login("new.admin@t.local", TEMPORARY)).status).toBe(401);

    const row = await prisma.user.findUniqueOrThrow({ where: { email: "new.admin@t.local" } });
    expect(row).toMatchObject({ mustChangePassword: false });
    expect(row.passwordChangedAt).toBeInstanceOf(Date);
    expect((await prisma.auditLog.findMany({ where: { action: "PASSWORD_CHANGED" } })).length).toBe(1);
  });

  it("refuses a wrong current password, and a new password that breaks the rules, with the reasons in words", async () => {
    const { accessToken } = (await login("new.admin@t.local")).body;
    const post = (currentPassword: string, newPassword: string) => request(app).post("/api/v1/auth/change-password").set(bearer(accessToken)).send({ currentPassword, newPassword });
    expect((await post("not-the-password", "my-own-Secret-42")).status).toBe(401);
    for (const [bad, expected] of [["short1", /at least 10/], ["onlyletterslongenough", /letter and one number/], ["1234567890123", /letter and one number/], ["new.admin-Passw0rd", /email name/], [TEMPORARY, /different from the current/], ["ChangeMe123!", /too common/]] as const) {
      const res = await post(TEMPORARY, bad);
      expect(res.status, bad).toBe(400);
      expect(res.body.error.message, bad).toMatch(expected);
    }
    expect((await prisma.user.findUniqueOrThrow({ where: { email: "new.admin@t.local" } })).mustChangePassword).toBe(true);
  });
});

describe("an account that has already chosen its password", () => {
  it("is not restricted", async () => {
    const res = await login("settled.admin@t.local");
    expect(res.body.mustChangePassword).toBe(false);
    expect((await request(app).get("/api/v1/deliveries").set(bearer(res.body.accessToken))).status).toBe(200);
  });

  it("can change it voluntarily", async () => {
    const { accessToken } = (await login("settled.admin@t.local")).body;
    expect((await request(app).post("/api/v1/auth/change-password").set(bearer(accessToken)).send({ currentPassword: TEMPORARY, newPassword: "another-Secret-77" })).status).toBe(200);
  });
});

describe("accounts created by an administrator start with a temporary password", () => {
  it("POST /users and POST /postmen/:id/account set mustChangePassword", async () => {
    await prisma.user.create({ data: { email: "super@t.local", name: "Super", role: "SUPER_ADMIN", passwordHash: await hashPassword(TEMPORARY) } });
    const admin = (await login("settled.admin@t.local")).body.accessToken;
    const superAdmin = (await login("super@t.local")).body.accessToken;
    const created = await request(app).post("/api/v1/users").set(bearer(superAdmin)).send({ name: "Second Admin", email: "second@t.local", password: "initial-Passw0rd", role: "ADMIN", postOfficeId: officeId });
    expect(created.status).toBe(201);
    expect((await prisma.user.findUniqueOrThrow({ where: { email: "second@t.local" } })).mustChangePassword).toBe(true);

    const postman = await prisma.postman.create({ data: { employeeId: "E1", postOfficeId: officeId, name: "P One", phone: "9800000001" } });
    const account = await request(app).post(`/api/v1/postmen/${postman.id}/account`).set(bearer(admin)).send({ email: "p1@t.local", password: "initial-Passw0rd" });
    expect(account.status).toBeLessThan(300);
    expect((await prisma.user.findUniqueOrThrow({ where: { email: "p1@t.local" } })).mustChangePassword).toBe(true);
  });
});

describe("the password rules", () => {
  it("are short and about length, not tricks", () => {
    const ok = (pw: string) => checkPasswordPolicy(pw, { email: "someone@x.local" });
    expect(ok("correct-horse-battery-9")).toEqual([]);
    expect(ok("abc")).toContain("Use at least 10 characters.");
    expect(ok("a".repeat(200))).toContain("Use at most 128 characters.");
    expect(ok("someone-Passw0rd")).toContain("Do not use your email name in the password.");
  });
});

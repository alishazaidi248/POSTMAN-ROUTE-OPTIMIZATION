/**
 * Seeds the database the browser tests (e2e/) run against: its own post office, its own logins, nothing shared with real data.
 *
 *   DATABASE_URL=postgresql://.../postal_e2e npx tsx scripts/e2e-seed.ts ../e2e/.users.json
 *
 * It WIPES the database first, so it refuses to run unless the database name ends in _e2e or _test. Passwords are random and
 * written to the output file (git-ignored), never printed and never in the source. The accounts start with a temporary
 * password, exactly as an administrator-created account does (the tests then exercise the forced password change).
 */
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";
import { randomPassword } from "./lib/credentials";

const prisma = new PrismaClient();

async function main() {
  const name = (process.env.DATABASE_URL ?? "").split("?")[0].split("/").pop() ?? "";
  if (!/_(e2e|test)$/.test(name)) throw new Error(`Refusing to wipe "${name}": the e2e database name must end in _e2e or _test.`);

  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('_prisma_migrations', 'spatial_ref_sys')`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);

  const office = await prisma.postOffice.create({
    data: { code: "E2E-BW", name: "E2E Bhandup West", addressLine: "LBS Marg", city: "Mumbai", state: "Maharashtra", pincode: "400078", latitude: 19.1487, longitude: 72.9366 }
  });
  const hash = (p: string) => argon2.hash(p, { type: argon2.argon2id });
  const users = {
    admin: { email: "e2e.admin@postal.test", password: randomPassword(), newPassword: `${randomPassword()}Z` },
    postman: { email: "e2e.postman@postal.test", password: randomPassword(), newPassword: `${randomPassword()}Z` },
    settled: { email: "e2e.settled@postal.test", password: randomPassword() } // has already chosen a password: signs in without the change screen
  };
  await prisma.user.create({ data: { email: users.admin.email, name: "E2E Admin", role: "ADMIN", postOfficeId: office.id, passwordHash: await hash(users.admin.password), mustChangePassword: true } });
  await prisma.user.create({ data: { email: users.settled.email, name: "E2E Settled Admin", role: "ADMIN", postOfficeId: office.id, passwordHash: await hash(users.settled.password) } });
  const postman = await prisma.postman.create({ data: { employeeId: "E2E-PM-1", postOfficeId: office.id, name: "E2E Postman", phone: "9800000001", email: users.postman.email } });
  await prisma.user.create({ data: { email: users.postman.email, name: "E2E Postman", role: "POSTMAN", postOfficeId: office.id, postmanId: postman.id, passwordHash: await hash(users.postman.password), mustChangePassword: true } });

  fs.writeFileSync(process.argv[2] ?? "e2e-users.json", JSON.stringify({ officeId: office.id, postmanId: postman.id, users }, null, 2), { mode: 0o600 });
  console.log(`E2E database "${name}" seeded (post office ${office.code}); logins written to ${process.argv[2] ?? "e2e-users.json"}`);
}

main().finally(() => prisma.$disconnect());

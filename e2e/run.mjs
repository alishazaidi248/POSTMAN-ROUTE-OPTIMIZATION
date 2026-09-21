import { adminE2E } from "./admin.e2e.mjs";
import { postmanE2E } from "./postman.e2e.mjs";

/**
 * Runs the browser tests against servers that are already up (see README.md): the backend on E2E_API_URL with a seeded
 * database, the admin panel on E2E_ADMIN_URL and the Postman app's web build on E2E_APP_URL. Choose with: node run.mjs admin | postman
 */
const which = process.argv[2] ?? "all";
const all = [];
if (which === "all" || which === "admin") all.push(...(await adminE2E()));
if (which === "all" || which === "postman") all.push(...(await postmanE2E()));

const failed = all.filter((r) => !r.ok);
console.log(`\n${all.length - failed.length} passed, ${failed.length} failed of ${all.length} checks`);
if (failed.length) console.log(failed.map((f) => `  FAILED: ${f.name}`).join("\n"));
process.exit(failed.length ? 1 : 0);

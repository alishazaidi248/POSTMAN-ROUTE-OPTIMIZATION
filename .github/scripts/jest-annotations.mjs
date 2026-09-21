// Turns a Jest --json result into GitHub error annotations (one per failed test, plus suites that could not run), so a red
// run says which test failed and why on the run's summary page instead of only in a long log.
//   node .github/scripts/jest-annotations.mjs PostmanApp/jest-result.json
import fs from "node:fs";

const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
  console.log(`::error title=Jest produced no result file::${file ?? "(no path given)"} does not exist - Jest probably crashed before writing it`);
  process.exit(0);
}
const escape = (s) => String(s).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const result = JSON.parse(fs.readFileSync(file, "utf8"));
let count = 0;
for (const suite of result.testResults ?? []) {
  const where = suite.name.replace(process.cwd() + "/", "");
  if (suite.status === "failed" && (suite.assertionResults ?? []).every((t) => t.status !== "failed")) {
    console.log(`::error file=${where},title=Test suite failed to run::${escape((suite.message ?? "").slice(0, 900))}`);
    count++;
  }
  for (const t of suite.assertionResults ?? []) {
    if (t.status !== "failed") continue;
    console.log(`::error file=${where},title=${escape(t.fullName)}::${escape((t.failureMessages ?? []).join("\n").slice(0, 900))}`);
    count++;
  }
}
console.log(`${count} failure(s) annotated (${result.numFailedTests} failed tests, ${result.numFailedTestSuites} failed suites of ${result.numTotalTestSuites})`);

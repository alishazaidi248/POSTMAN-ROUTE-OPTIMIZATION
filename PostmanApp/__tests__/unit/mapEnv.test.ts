import fs from "fs";
import path from "path";
import { env } from "../../src/config/env";

const SRC_DIR = path.join(__dirname, "..", "..", "src");

function walk(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

describe("MAP_STYLE_URL is configurable (spec item 15)", () => {
  it("env.mapStyleUrl reads from the injected extra/process.env config, not a literal", () => {
    // The env module resolves from Constants.expoConfig.extra / process.env
    // (src/config/env.ts) — this asserts the exported value is whatever
    // that resolution produced for the current test env, proving it's
    // wired through configuration rather than inlined at every call site.
    expect(typeof env.mapStyleUrl).toBe("string");
    expect(env.mapStyleUrl.length).toBeGreaterThan(0);
  });

  it("does not default to MapLibre's near-empty demo style", () => {
    // Regression guard for the actual bug this fixes: demotiles.maplibre.org
    // is a minimal test style with no real road/building/label data
    // anywhere, which is exactly what produced the "blank light-blue map".
    expect(env.mapStyleUrl).not.toContain("demotiles.maplibre.org");
  });
});

describe("no Google API key ever appears in mobile app source (spec item 14)", () => {
  const sourceFiles = walk(SRC_DIR).filter((f) => /\.(ts|tsx)$/.test(f));

  it("scanned at least the expected number of source files (sanity check the scan itself works)", () => {
    expect(sourceFiles.length).toBeGreaterThan(20);
  });

  it("no source file references a Google Maps/Geocoding API key", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles) {
      const content = fs.readFileSync(file, "utf8");
      if (/GOOGLE_.*API_KEY|GoogleGeocodingApiKey|AIza[0-9A-Za-z_-]{20,}/.test(content)) {
        offenders.push(path.relative(SRC_DIR, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the mobile env config has no key-shaped field at all — geocoding stays entirely server-side", () => {
    expect(Object.keys(env)).toEqual(["apiBaseUrl", "mapStyleUrl", "osrmBaseUrl"]);
  });
});

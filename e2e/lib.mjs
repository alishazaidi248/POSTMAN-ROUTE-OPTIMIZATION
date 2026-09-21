import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const API = process.env.E2E_API_URL ?? "http://localhost:4000/api/v1";
export const ADMIN_URL = process.env.E2E_ADMIN_URL ?? "http://localhost:5173";
export const APP_URL = process.env.E2E_APP_URL ?? "http://localhost:8081";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const seed = () => JSON.parse(fs.readFileSync(path.join(HERE, ".users.json"), "utf8"));

/** A real browser is needed: CHROME_PATH, or a Chrome / Chromium / Edge in the usual places. */
export function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  ].filter(Boolean);
  const found = candidates.find((c) => fs.existsSync(c));
  if (!found) throw new Error("No Chrome found. Set CHROME_PATH to a Chrome / Chromium executable.");
  return found;
}

export const launch = () =>
  puppeteer.launch({ executablePath: chromePath(), headless: "new", args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });

export async function api(method, route, token, body) {
  const res = await fetch(API + route, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
}

export async function loginApi(email, password) {
  const r = await api("POST", "/auth/login", null, { email, password });
  if (r.status !== 200) throw new Error(`API login failed for ${email}: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}

/** Collects results; a failed check does not stop the run, so one report shows everything that is wrong. */
export function reporter(title) {
  const results = [];
  console.log(`\n${title}`);
  return {
    check(name, ok, detail) {
      results.push({ name, ok: !!ok });
      console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === undefined ? "" : `\n        -> ${String(detail).slice(0, 300)}`}`);
      // In GitHub Actions a failed check becomes an annotation on the run's summary page (no log download needed)
      if (!ok && process.env.GITHUB_ACTIONS) {
        const message = String(detail ?? "").slice(0, 700).replace(/%/g, "%25").replace(/\r?\n/g, "%0A");
        console.log(`::error title=${title.replace(/[:,]/g, " ")}::${name.replace(/[:,]/g, " ")} -> ${message}`);
      }
    },
    results
  };
}

export const shot = async (page, name) => {
  const dir = path.join(HERE, "screenshots");
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}.png`) }).catch(() => undefined);
};

/** Waits until `fn` (run in the page) is truthy; returns its value, or null on timeout. */
export async function waitFor(page, fn, arg, timeout = 15000) {
  try {
    const handle = await page.waitForFunction(fn, { timeout, polling: 250 }, arg);
    return await handle.jsonValue();
  } catch {
    return null;
  }
}

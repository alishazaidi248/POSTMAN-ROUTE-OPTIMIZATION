import Constants from "expo-constants";

interface AppEnv {
  apiBaseUrl: string;
  mapStyleUrl: string;
  osrmBaseUrl?: string;
}

/**
 * expo-constants exposes values from app.json `extra` at runtime (works in
 * both Expo Go/dev-client and standalone builds), falling back to
 * process.env for local `expo start` sessions reading .env via babel-dotenv.
 */
function readExtra(key: string): string | undefined {
  const fromExtra = (Constants.expoConfig?.extra as Record<string, string> | undefined)?.[key];
  if (fromExtra) return fromExtra;
  return (process.env as Record<string, string | undefined>)[key];
}

/** localhost, the Android emulator's alias for it, or a private (LAN) IPv4 address. */
function isDevMachineHost(host: string): boolean {
  if (host === "localhost" || host === "127.0.0.1" || host === "10.0.2.2") return true;
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

/**
 * The machine the app was loaded from, as the app sees it right now: the page's host on the web, or the
 * dev server's host (Metro's hostUri, e.g. "192.168.29.11:8081") on a phone. Null in a store build.
 */
function currentDevHost(): string | null {
  if (typeof window !== "undefined" && window.location?.hostname) return window.location.hostname;
  const hostUri = Constants.expoConfig?.hostUri;
  return hostUri ? hostUri.split(":")[0] : null;
}

/**
 * When API_BASE_URL points at a development machine (localhost or a LAN IP), the backend runs on the same
 * machine that serves the app, so its host is swapped for that machine's current address. Switching Wi-Fi
 * changes the LAN IP; this keeps the app working without editing .env. A real server URL (e.g.
 * https://api.example.com) is never touched.
 */
export function resolveApiBaseUrl(configured: string, devHost: string | null): string {
  if (!devHost) return configured;
  try {
    const url = new URL(configured);
    if (!isDevMachineHost(url.hostname) || !isDevMachineHost(devHost)) return configured;
    url.hostname = devHost;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return configured;
  }
}

export const env: AppEnv = {
  apiBaseUrl: resolveApiBaseUrl(readExtra("API_BASE_URL") ?? "http://localhost:4000/api/v1", currentDevHost()),
  // Fallback matches .env.example's default — a real OSM-derived basemap,
  // never MapLibre's own near-empty demo style (see .env.example for why).
  mapStyleUrl: readExtra("MAP_STYLE_URL") ?? "https://tiles.openfreemap.org/styles/liberty",
  osrmBaseUrl: readExtra("OSRM_BASE_URL")
};

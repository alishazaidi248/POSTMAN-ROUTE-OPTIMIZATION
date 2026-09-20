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

export const env: AppEnv = {
  apiBaseUrl: readExtra("API_BASE_URL") ?? "http://localhost:4000/api/v1",
  // Fallback matches .env.example's default — a real OSM-derived basemap,
  // never MapLibre's own near-empty demo style (see .env.example for why).
  mapStyleUrl: readExtra("MAP_STYLE_URL") ?? "https://tiles.openfreemap.org/styles/liberty",
  osrmBaseUrl: readExtra("OSRM_BASE_URL")
};

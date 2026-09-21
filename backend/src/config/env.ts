import dotenv from "dotenv";

dotenv.config();

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4000),

  databaseUrl: required("DATABASE_URL"),

  jwtAccessSecret: required("JWT_ACCESS_SECRET"),
  jwtRefreshSecret: required("JWT_REFRESH_SECRET"),
  jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? "15m",
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? "7d",

  uploadDir: process.env.UPLOAD_DIR ?? "./uploads",
  maxUploadSizeMb: Number(process.env.MAX_UPLOAD_SIZE_MB ?? 25),
  maxProfilePhotoMb: Number(process.env.MAX_PROFILE_PHOTO_MB ?? 2),
  maxProofPhotoMb: Number(process.env.MAX_PROOF_PHOTO_MB ?? 5),

  geocodingProvider: process.env.GEOCODING_PROVIDER ?? "nominatim",
  nominatimBaseUrl: process.env.NOMINATIM_BASE_URL ?? "https://nominatim.openstreetmap.org",
  nominatimUserAgent: process.env.NOMINATIM_USER_AGENT ?? "postal-admin-system",
  googleGeocodingApiKey: process.env.GOOGLE_GEOCODING_API_KEY ?? "",

  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",

  // Road routing (travel-time/distance matrix + route geometry). Empty means
  // "not configured": the optimizer then falls back to straight-line
  // estimates and says so in the route response.
  osrmBaseUrl: (process.env.OSRM_BASE_URL ?? "").replace(/\/+$/, ""),
  osrmProfile: process.env.OSRM_PROFILE ?? "driving",
  osrmTimeoutMs: Number(process.env.OSRM_TIMEOUT_MS ?? 8000),

  // The route algorithm (DBSCAN -> Nearest Neighbor -> 2-opt -> ALNS) is NOT configurable.
  // These only tune it. Two stops are DBSCAN neighbours when the road travel time
  // between them is <= ROUTE_DBSCAN_EPS_SECONDS; leave it unset (or 0) to derive the
  // radius from each route's own travel-time matrix.
  dbscanEpsSeconds: Number(process.env.ROUTE_DBSCAN_EPS_SECONDS ?? 0),
  dbscanMinPoints: Number(process.env.ROUTE_DBSCAN_MIN_POINTS ?? 2),
  // A start point (GPS fix / last known location) farther than this from the post
  // office is not a plausible start of a delivery round and is ignored (and reported).
  routeStartMaxKm: Number(process.env.ROUTE_START_MAX_KM ?? 50),
  // ALNS (the last stage of the fixed pipeline). These only bound the search - they never switch it off.
  alnsMaxIterations: Number(process.env.ROUTE_ALNS_MAX_ITERATIONS ?? 2500),
  alnsMaxMs: Number(process.env.ROUTE_ALNS_MAX_MS ?? 1500),
  alnsNoImprovementLimit: Number(process.env.ROUTE_ALNS_NO_IMPROVEMENT_LIMIT ?? 600),
  // true: every DBSCAN cluster stays one unbroken run in the final route (see services/optimization/alns.ts).
  alnsPreserveClusters: (process.env.ROUTE_ALNS_PRESERVE_CLUSTERS ?? "true") !== "false",
  twoOptMaxMillis: Number(process.env.ROUTE_2OPT_MAX_MS ?? 1500),
  twoOptMaxPasses: Number(process.env.ROUTE_2OPT_MAX_PASSES ?? 500),
  defaultServiceTimeMinutes: Number(process.env.DEFAULT_SERVICE_TIME_MINUTES ?? 3),

  // Push notifications through Expo's push service. A token is only ever registered by a phone that has one, so leaving
  // this on with no phones does nothing. EXPO_ACCESS_TOKEN is optional (needed only if enhanced push security is enabled
  // on the Expo project) and is a secret: it is read from the environment and never stored or logged.
  pushEnabled: (process.env.PUSH_ENABLED ?? "true") !== "false",
  expoAccessToken: process.env.EXPO_ACCESS_TOKEN ?? "",
  // Assignments that arrive together (an import) become one notification: the wait before it is sent.
  pushBatchMs: Number(process.env.PUSH_BATCH_MS ?? 20_000),

  // Sign-in attempts per IP per 15 minutes (brute-force protection). Raise it only for automated browser tests.
  authRateLimit: Number(process.env.AUTH_RATE_LIMIT ?? 20),

  isProduction: (process.env.NODE_ENV ?? "development") === "production"
};

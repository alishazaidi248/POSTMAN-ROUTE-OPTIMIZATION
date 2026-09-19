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

  geocodingProvider: process.env.GEOCODING_PROVIDER ?? "nominatim",
  nominatimBaseUrl: process.env.NOMINATIM_BASE_URL ?? "https://nominatim.openstreetmap.org",
  nominatimUserAgent: process.env.NOMINATIM_USER_AGENT ?? "postal-admin-system",
  googleGeocodingApiKey: process.env.GOOGLE_GEOCODING_API_KEY ?? "",

  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",

  isProduction: (process.env.NODE_ENV ?? "development") === "production"
};

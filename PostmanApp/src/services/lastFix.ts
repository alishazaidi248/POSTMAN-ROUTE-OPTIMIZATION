/**
 * The device's most recent GPS fix, kept where non-React code (the API layer) can read it.
 * The route request sends it as the start of the round, so the backend plans from where the
 * postman actually is.
 */
export interface LastFix {
  latitude: number;
  longitude: number;
  /** Metres, as the device reports it; null when it does not say. */
  accuracy: number | null;
  /** When the fix was taken (ms since epoch). */
  timestamp: number;
}

let current: LastFix | null = null;

export function setLastFix(fix: (Pick<LastFix, "latitude" | "longitude"> & Partial<LastFix>) | null): void {
  current = fix ? { latitude: fix.latitude, longitude: fix.longitude, accuracy: fix.accuracy ?? null, timestamp: fix.timestamp ?? Date.now() } : null;
}

/** The last fix, only when it is recent enough to say where the postman IS now (default: 2 minutes). */
export function getFreshFix(maxAgeMs = 120_000): LastFix | null {
  return current && Date.now() - current.timestamp <= maxAgeMs ? current : null;
}

export function getLastFix(): LastFix | null {
  return current;
}

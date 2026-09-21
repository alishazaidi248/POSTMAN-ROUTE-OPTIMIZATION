/**
 * The device's most recent GPS fix, kept where non-React code (the API layer) can read it.
 * The route request sends it as the start of the round, so the backend plans from where the
 * postman actually is.
 */
export interface LastFix {
  latitude: number;
  longitude: number;
}

let current: LastFix | null = null;

export function setLastFix(fix: LastFix | null): void {
  current = fix ? { latitude: fix.latitude, longitude: fix.longitude } : null;
}

export function getLastFix(): LastFix | null {
  return current;
}

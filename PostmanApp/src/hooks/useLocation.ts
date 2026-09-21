import { useCallback, useEffect, useRef, useState } from "react";
import * as Location from "expo-location";
import { locationApi } from "../api/locationApi";
import * as locationService from "../services/locationService";
import { setLastFix } from "../services/lastFix";
import { LocationFix, LocationPermissionState, TrackingMode } from "../types/location";

const PING_INTERVAL_MS: Record<TrackingMode, number> = {
  ACTIVE_ROUTE: 30_000,
  IDLE: 180_000
};

/**
 * Owns GPS permission state, the live fix, and periodic server pings.
 * Ping cadence follows `mode` (spec §13) and every failure is swallowed —
 * a location ping is best-effort telemetry, never something that should
 * surface an error to a postman mid-delivery.
 */
export function useLocation(mode: TrackingMode = "IDLE") {
  const [permission, setPermission] = useState<LocationPermissionState>("UNKNOWN");
  const [fix, setFix] = useState<LocationFix | null>(null);
  const lastPingAt = useRef(0);
  const subscriptionRef = useRef<Location.LocationSubscription | null>(null);

  const refreshPermission = useCallback(async () => {
    const state = await locationService.getPermissionState();
    setPermission(state);
    return state;
  }, []);

  const requestPermission = useCallback(async () => {
    const state = await locationService.requestPermission();
    setPermission(state);
    return state;
  }, []);

  useEffect(() => {
    // refreshPermission is async (awaits a native permissions call) before
    // it ever touches state, so this isn't the synchronous setState-in-effect
    // pattern the lint rule is guarding against.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshPermission();
  }, [refreshPermission]);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      if (permission !== "GRANTED") return;

      const subscription = await locationService.watchPosition(mode, (nextFix) => {
        if (cancelled) return;
        setFix(nextFix);
        setLastFix(nextFix);

        const now = Date.now();
        if (now - lastPingAt.current >= PING_INTERVAL_MS[mode]) {
          lastPingAt.current = now;
          locationApi
            .sendPing({ latitude: nextFix.latitude, longitude: nextFix.longitude, isMock: false })
            .catch(() => {
              /* best-effort telemetry; offline pings are simply dropped, not queued */
            });
        }
      });
      subscriptionRef.current = subscription;
    }

    start();

    return () => {
      cancelled = true;
      subscriptionRef.current?.remove();
      subscriptionRef.current = null;
    };
  }, [permission, mode]);

  return { permission, fix, requestPermission, refreshPermission };
}

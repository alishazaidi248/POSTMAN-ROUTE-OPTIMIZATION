import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { navigationApi } from "../api/navigationApi";
import { Directions, TravelMode } from "../types/navigation";
import { LocationFix, LocationPermissionState } from "../types/location";
import { buildRouteModel, computeProgress, isOffRoute, Progress } from "../utils/navigationProgress";
import { getFreshFix } from "../services/lastFix";

/** Off route for this many fixes in a row (about 3 s at navigation rate) before rerouting: one bad fix is not a detour. */
const OFF_ROUTE_FIXES_BEFORE_REROUTE = 3;
/** Never ask the server for a new route more often than this. */
const MIN_REROUTE_INTERVAL_MS = 15_000;
/** A straight-line answer means the routing server was unreachable: try again for street directions this often. */
const STRAIGHT_LINE_RETRY_MS = 30_000;
/** How long to wait for a first GPS fix before asking for directions from the last known location instead. */
const FIRST_FIX_WAIT_MS = 4_000;
/** A fix another screen got this recently is where the postman still is: start from it rather than wait for GPS. */
const RECENT_FIX_MS = 60_000;

const recentFix = () => {
  const f = getFreshFix(RECENT_FIX_MS);
  return f ? { latitude: f.latitude, longitude: f.longitude } : null;
};

// Postmen mostly cycle; whichever mode they last picked is kept for the next delivery while the app is open.
let rememberedMode: TravelMode = "BIKE";

export type TurnByTurnPhase = "LOADING" | "READY" | "ERROR";

export function useTurnByTurn(deliveryId: string, fix: LocationFix | null, permission: LocationPermissionState) {
  const [mode, setModeState] = useState<TravelMode>(rememberedMode);
  const [directions, setDirections] = useState<Directions | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rerouting, setRerouting] = useState(false);
  const [arrived, setArrived] = useState(false);
  /** When the postman should get there (epoch ms), refreshed with every fix. */
  const [arrivalAt, setArrivalAt] = useState<number | null>(null);

  const requestSeq = useRef(0);
  const lastFetchAt = useRef(0);
  const offRouteCount = useRef(0);
  const fixRef = useRef(fix);
  useEffect(() => {
    fixRef.current = fix;
  }, [fix]);
  const progressRef = useRef<Progress | null>(null);
  /** The directions on screen were asked for before the phone had a GPS fix (they start from the last known spot). */
  const startedWithoutFix = useRef(false);

  const model = useMemo(() => (directions ? buildRouteModel(directions) : null), [directions]);

  const load = useCallback(
    async (opts: { quiet: boolean }) => {
      const seq = ++requestSeq.current;
      lastFetchAt.current = Date.now();
      if (opts.quiet) setRerouting(true);
      else setError(null);
      const from = fixRef.current ? { latitude: fixRef.current.latitude, longitude: fixRef.current.longitude } : recentFix();
      startedWithoutFix.current = from === null;
      try {
        const next = await navigationApi.getDirections(deliveryId, mode, from);
        if (seq !== requestSeq.current) return; // a newer request (mode switch, reroute) superseded this one
        offRouteCount.current = 0;
        progressRef.current = null;
        setProgress(null);
        setDirections(next);
        setArrivalAt(Date.now() + next.durationSeconds * 1000);
        setError(null);
      } catch (err) {
        if (seq !== requestSeq.current) return;
        // A failed reroute keeps the directions already on screen; only a first load shows the error.
        if (!opts.quiet) setError(err instanceof Error ? err.message : "Couldn't load directions.");
      } finally {
        if (seq === requestSeq.current) setRerouting(false);
      }
    },
    [deliveryId, mode]
  );

  // A different delivery or travel mode starts over.
  const requestedFor = useRef<string | null>(null);
  useEffect(() => {
    requestedFor.current = null;
    progressRef.current = null;
    offRouteCount.current = 0;
    /* eslint-disable react-hooks/set-state-in-effect -- resetting for new inputs, before the first request below */
    setDirections(null);
    setProgress(null);
    setArrived(false);
    setArrivalAt(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [deliveryId, mode]);

  // First load: as soon as there is a GPS fix, or after a short wait without one (then the server starts from the
  // postman's last known location).
  const hasFix = fix !== null;
  const noGps = permission === "DENIED" || permission === "PERMANENTLY_DENIED" || permission === "GPS_DISABLED";
  useEffect(() => {
    const key = `${deliveryId}:${mode}`;
    if (requestedFor.current === key) return;
    const start = () => {
      requestedFor.current = key;
      void load({ quiet: false });
    };
    if (hasFix || noGps || recentFix()) {
      start();
      return;
    }
    const timer = setTimeout(() => requestedFor.current !== key && start(), FIRST_FIX_WAIT_MS);
    return () => clearTimeout(timer);
  }, [deliveryId, mode, hasFix, noGps, load]);

  // Every fix: where along the route, and whether to reroute.
  useEffect(() => {
    if (!fix) return;
    // Directions asked for before GPS answered started from the last known spot: ask again from where the postman is.
    if (startedWithoutFix.current) {
      startedWithoutFix.current = false;
      void load({ quiet: true });
      return;
    }
    if (!model || !directions) return;
    const next = computeProgress(model, fix, progressRef.current);
    progressRef.current = next;
    setProgress(next);
    setArrivalAt(Date.now() + next.remainingSeconds * 1000);
    if (next.arrived) setArrived(true);

    const since = Date.now() - lastFetchAt.current;
    if (directions.source === "STRAIGHT_LINE") {
      if (since > STRAIGHT_LINE_RETRY_MS && !next.arrived) void load({ quiet: true });
      return;
    }
    offRouteCount.current = isOffRoute(next, fix.accuracy) ? offRouteCount.current + 1 : 0;
    if (offRouteCount.current >= OFF_ROUTE_FIXES_BEFORE_REROUTE && since > MIN_REROUTE_INTERVAL_MS) {
      offRouteCount.current = 0;
      void load({ quiet: true });
    }
  }, [fix, model, directions, load]);

  const setMode = useCallback((next: TravelMode) => {
    rememberedMode = next;
    setModeState(next);
  }, []);

  const phase: TurnByTurnPhase = directions ? "READY" : error ? "ERROR" : "LOADING";

  return {
    mode,
    setMode,
    directions,
    progress,
    phase,
    error,
    rerouting,
    arrived,
    arrivalAt,
    retry: () => void load({ quiet: false }),
    /** The postman says they are not there yet (e.g. a wrong-side-of-the-building fix): keep guiding. */
    dismissArrival: () => setArrived(false)
  };
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../lib/apiClient";
import styles from "../styles/components.module.css";
import postmen from "../styles/postmen.module.css";

interface RouteStop {
  deliveryId: string;
  sequence: number;
  estimatedArrival: string;
  distanceFromPreviousMeters?: number;
  travelTimeFromPreviousSeconds?: number;
}

interface RouteMetrics {
  stops: number;
  clusters: number;
  totalCost: number;
  inputOrderCost: number;
  dbscanNnCost: number;
  twoOptCost: number;
  improvementOverInputPercent: number;
  improvementFrom2OptPercent: number;
  improvementFromAlnsPercent: number;
  twoOptPasses: number;
  optimizationMs: number;
  matrixMode: "ROAD" | "ESTIMATED";
  alns: { iterations: number; improvements: number; stoppedBy: string; runtimeMs: number };
}

interface RouteResponse {
  routeId: string;
  version: number;
  generatedAt: string;
  stale?: boolean;
  solution: {
    stops: RouteStop[];
    totalDistanceMeters: number;
    estimatedDurationMinutes: number;
    start?: { source: "REQUEST" | "POSTMAN_LOCATION" | "POST_OFFICE" };
    startIgnored?: { source: string; reason: string }[];
    routing?: { mode: "ROAD" | "ESTIMATED"; geometrySource: string; warnings: string[] };
    unroutable?: { deliveryId: string; reason: string }[];
    metrics?: RouteMetrics;
  };
}

interface DeliveryRow {
  id: string;
  trackingId: string;
  recipient: { name: string };
  address: { addressLine1?: string | null };
}

const START_LABEL: Record<string, string> = {
  REQUEST: "the postman's live GPS position",
  POSTMAN_LOCATION: "the postman's last known location",
  POST_OFFICE: "the post office"
};

const km = (meters: number) => `${(meters / 1000).toFixed(1)} km`;
const minutes = (cost: number) => `${(cost / 60).toFixed(1)} min`;
const improvement = (before: number, after: number) => (before > 0 ? `${(((before - after) / before) * 100).toFixed(1)}%` : "0%");

/**
 * The postman's current route as the backend planned it - the very same route the mobile app
 * shows. There is no route method to pick: every route comes from the one planner
 * (DBSCAN -> Nearest Neighbor -> 2-opt -> ALNS) and this card only displays and can re-run it.
 */
export function PostmanRouteCard({ postmanId }: { postmanId: string }) {
  const queryClient = useQueryClient();
  const queryKey = ["postman-route", postmanId];

  const route = useQuery<RouteResponse | { route: null }>({
    queryKey,
    queryFn: () => apiClient.get(`/postmen/${postmanId}/route`).then((r) => r.data),
    refetchInterval: 30_000
  });

  const deliveries = useQuery<{ rows: DeliveryRow[] }>({
    queryKey: ["postman-route-deliveries", postmanId],
    queryFn: () => apiClient.get("/deliveries", { params: { postmanId, pageSize: 100 } }).then((r) => r.data),
    refetchInterval: 30_000
  });

  const recalc = useMutation({
    mutationFn: () => apiClient.post(`/postmen/${postmanId}/route/recalculate`).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey })
  });

  const byId = new Map((deliveries.data?.rows ?? []).map((d) => [d.id, d]));
  const data = route.data && "solution" in route.data ? route.data : null;
  const solution = data?.solution;
  const metrics = solution?.metrics;

  return (
    <div className={styles.card} style={{ gridColumn: "1 / -1" }}>
      <div className={styles.toolbar} style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <h3 className={styles.sectionTitle} style={{ margin: 0 }}>Optimized route</h3>
        <button className={styles.button} onClick={() => recalc.mutate()} disabled={recalc.isPending || !data}>
          {recalc.isPending ? "Recalculating…" : "Recalculate"}
        </button>
      </div>

      {route.isLoading && <p>Loading route…</p>}
      {route.isError && <p className={styles.errorText}>Couldn't load the route.</p>}
      {recalc.isError && <p className={styles.errorText}>Couldn't recalculate the route.</p>}
      {!route.isLoading && !data && !route.isError && <p>No remaining deliveries to route.</p>}

      {data && solution && (
        <>
          <p>
            {solution.stops.length} stops · {km(solution.totalDistanceMeters)} · ~{Math.round(solution.estimatedDurationMinutes)} min ·
            version {data.version}
            {solution.start && <> · starts from {START_LABEL[solution.start.source] ?? solution.start.source}</>}
          </p>
          <p style={{ color: "var(--color-ink-500)", margin: "0 0 8px" }}>Optimized automatically</p>
          {data.stale && <p className={styles.errorText}>The route couldn't be refreshed - showing the last one.</p>}
          {solution.routing?.mode === "ESTIMATED" && (
            <p className={styles.errorText}>Road routing unavailable - distances and times are straight-line estimates.</p>
          )}
          {solution.startIgnored?.map((i) => (
            <p key={i.source} style={{ color: "var(--color-ink-500)" }}>
              Ignored start ({i.source.toLowerCase().replace("_", " ")}): {i.reason}
            </p>
          ))}

          <table className={styles.table}>
            <thead>
              <tr>
                <th>#</th>
                <th>Tracking ID</th>
                <th>Recipient</th>
                <th>Leg</th>
                <th>ETA</th>
              </tr>
            </thead>
            <tbody>
              {solution.stops.map((stop) => {
                const d = byId.get(stop.deliveryId);
                return (
                  <tr key={stop.deliveryId}>
                    <td>{stop.sequence}</td>
                    <td>{d?.trackingId ?? "—"}</td>
                    <td>{d?.recipient.name ?? "—"}</td>
                    <td>
                      {stop.distanceFromPreviousMeters !== undefined ? km(stop.distanceFromPreviousMeters) : "—"}
                      {stop.travelTimeFromPreviousSeconds !== undefined && ` · ${Math.max(1, Math.round(stop.travelTimeFromPreviousSeconds / 60))} min`}
                    </td>
                    <td>{new Date(stop.estimatedArrival).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {(solution.unroutable?.length ?? 0) > 0 && (
            <p style={{ color: "var(--color-ink-500)" }}>
              Not routed: {solution.unroutable?.map((u) => `${byId.get(u.deliveryId)?.trackingId ?? u.deliveryId} (${u.reason.replace(/_/g, " ").toLowerCase()})`).join(", ")}
            </p>
          )}

          {metrics && (
            <details className={postmen.optDetails}>
              <summary>Technical details</summary>
              <table className={styles.table} data-testid="optimization-summary">
                <tbody>
                  <tr><td>Algorithm</td><td>DBSCAN + NN + 2-opt + ALNS</td></tr>
                  <tr><td>Deliveries</td><td>{metrics.stops}</td></tr>
                  <tr><td>Input order</td><td>{minutes(metrics.inputOrderCost)}</td></tr>
                  <tr><td>Initial route (clusters + nearest neighbor)</td><td>{minutes(metrics.dbscanNnCost)}</td></tr>
                  <tr><td>After 2-opt</td><td>{minutes(metrics.twoOptCost)}</td></tr>
                  <tr><td>After ALNS</td><td>{minutes(metrics.totalCost)}</td></tr>
                  <tr><td>Improvement over the initial route</td><td>{improvement(metrics.dbscanNnCost, metrics.totalCost)}</td></tr>
                  <tr><td>Improvement over the input order</td><td>{metrics.improvementOverInputPercent}%</td></tr>
                  <tr><td>Search</td><td>{metrics.alns.iterations} iterations, {metrics.alns.improvements} improvements</td></tr>
                  <tr><td>Runtime</td><td>{(metrics.optimizationMs / 1000).toFixed(1)} sec</td></tr>
                  <tr><td>Travel times</td><td>{metrics.matrixMode === "ROAD" ? "Road network" : "Estimated (road service unavailable)"}</td></tr>
                </tbody>
              </table>
              <p style={{ color: "var(--color-ink-500)", fontSize: 12, margin: "6px 0 0" }}>
                Route cost combines driving time, parcel load and delivery priority, in minutes. Lower is better.
              </p>
            </details>
          )}
        </>
      )}
    </div>
  );
}

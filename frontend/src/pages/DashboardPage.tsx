import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../lib/apiClient";
import { StatCard } from "../components/StatCard";
import { Badge } from "../components/Badge";
import styles from "../styles/components.module.css";

interface DashboardSummary {
  cards: Record<string, number>;
  assignmentExceptions: number;
  recentImports: { id: string; originalFilename: string; status: string; totalRows: number; createdAt: string }[];
  beatWorkload: { beatId: string; _count: number }[];
}

export function DashboardPage() {
  const { data, isLoading } = useQuery<DashboardSummary>({
    queryKey: ["dashboard-summary"],
    queryFn: () => apiClient.get("/dashboard/summary").then((r) => r.data)
  });

  if (isLoading || !data) return <p>Loading dashboard…</p>;

  const cardLabels: [string, string][] = [
    ["total", "Total Deliveries"],
    ["assigned", "Assigned"],
    ["unassigned", "Unassigned"],
    ["delivered", "Delivered"],
    ["pending", "Pending"],
    ["failed", "Failed"],
    ["rescheduled", "Rescheduled"],
    ["activePostmen", "Active Postmen"],
    ["activeBeats", "Active Beats"]
  ];

  return (
    <div>
      <div className={styles.cardGrid}>
        {cardLabels.map(([key, label]) => (
          <StatCard key={key} label={label} value={data.cards[key] ?? 0} />
        ))}
      </div>

      <div className={styles.cardGrid} style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className={styles.card}>
          <h3 className={styles.sectionTitle}>Assignment Exceptions</h3>
          <p>
            <strong>{data.assignmentExceptions}</strong> unresolved exception{data.assignmentExceptions === 1 ? "" : "s"} require
            attention.
          </p>
          <a href="/exceptions">Review affected deliveries →</a>
        </div>

        <div className={styles.card}>
          <h3 className={styles.sectionTitle}>Recent Imports</h3>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>File</th>
                <th>Rows</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.recentImports.length === 0 && (
                <tr>
                  <td colSpan={3}>No imports yet.</td>
                </tr>
              )}
              {data.recentImports.map((imp) => (
                <tr key={imp.id}>
                  <td>{imp.originalFilename}</td>
                  <td>{imp.totalRows}</td>
                  <td><Badge value={imp.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className={styles.card} style={{ marginTop: "var(--space-4)" }}>
        <h3 className={styles.sectionTitle}>Beat Workload (High Workload flagged, not judged)</h3>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Beat</th>
              <th>Delivery Count</th>
            </tr>
          </thead>
          <tbody>
            {data.beatWorkload.map((w) => (
              <tr key={w.beatId}>
                <td>{w.beatId}</td>
                <td>{w._count}{w._count > 50 ? " — High workload" : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

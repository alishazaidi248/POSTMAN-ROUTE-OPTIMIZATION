import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../lib/apiClient";
import styles from "../styles/components.module.css";

function AnalysisCard({ title, endpoint }: { title: string; endpoint: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["research", endpoint],
    queryFn: () => apiClient.get(`/research/${endpoint}`).then((r) => r.data)
  });

  return (
    <div className={styles.card}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      {isLoading ? (
        <p>Loading…</p>
      ) : data?.available ? (
        <pre style={{ fontSize: 12, whiteSpace: "pre-wrap" }}>{JSON.stringify(data.result ?? data.results, null, 2)}</pre>
      ) : (
        <p style={{ fontSize: 13, color: "var(--color-ink-500)" }}>
          No analysis has been run yet. This section will populate once the external research optimization service
          publishes results — it never shows fabricated data.
        </p>
      )}
    </div>
  );
}

export function ResearchAnalyticsPage() {
  return (
    <div className={styles.cardGrid} style={{ gridTemplateColumns: "1fr 1fr" }}>
      <AnalysisCard title="Delivery Density / Spatial Distribution" endpoint="density" />
      <AnalysisCard title="DBSCAN Clusters" endpoint="clusters" />
      <AnalysisCard title="Ripley's K / L Analysis" endpoint="ripley" />
      <AnalysisCard title="Algorithm Benchmarks" endpoint="benchmarks" />
    </div>
  );
}

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../lib/apiClient";
import { StatCard } from "../components/StatCard";
import styles from "../styles/components.module.css";

export function DataQualityPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["data-quality-summary"],
    queryFn: () => apiClient.get("/data-quality/summary").then((r) => r.data)
  });

  if (isLoading || !data) return <p>Loading…</p>;

  return (
    <div>
      <div className={styles.cardGrid}>
        <StatCard label="Total Records" value={data.totalRows} />
        <StatCard label="Valid Records" value={data.validRows} />
        <StatCard label="Invalid Records" value={data.invalidRows} />
        <StatCard label="Duplicates" value={data.duplicateRows} />
        <StatCard label="Missing Data" value={data.missingRows} />
        <StatCard label="Geocoding Failures" value={data.geocodingFailed} />
        <StatCard label="No Beat Matched" value={data.noBeatMatched} />
        <StatCard label="Assignment Failed" value={data.assignmentFailed} />
      </div>
      <div className={styles.toolbar}>
        <button
          className={styles.button}
          onClick={async () => {
            const res = await apiClient.get("/data-quality/errors", { params: { format: "csv" }, responseType: "blob" });
            const url = URL.createObjectURL(res.data as Blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = "data-quality-errors.csv";
            link.click();
            URL.revokeObjectURL(url);
          }}
        >
          Download Error CSV
        </button>
      </div>
    </div>
  );
}

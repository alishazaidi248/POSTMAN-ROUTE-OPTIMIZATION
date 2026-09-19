import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../lib/apiClient";
import styles from "../styles/components.module.css";

type ReportType = "postmen" | "beats" | "daily";

export function ReportsPage() {
  const [reportType, setReportType] = useState<ReportType>("postmen");

  const { data, isLoading } = useQuery({
    queryKey: ["report", reportType],
    queryFn: () => apiClient.get(`/reports/${reportType}`).then((r) => r.data)
  });

  async function download() {
    const res = await apiClient.get(`/reports/${reportType}`, { params: { format: "csv" }, responseType: "blob" });
    const url = URL.createObjectURL(res.data as Blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${reportType}-report.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div className={styles.toolbar}>
        <select className={styles.input} value={reportType} onChange={(e) => setReportType(e.target.value as ReportType)}>
          <option value="postmen">Postman Report</option>
          <option value="beats">Beat Report</option>
          <option value="daily">Daily Report</option>
        </select>
        {reportType !== "daily" && (
          <button className={styles.button} onClick={download}>Export CSV</button>
        )}
      </div>

      {isLoading || !data ? (
        <p>Loading…</p>
      ) : reportType === "daily" ? (
        <table className={styles.table}>
          <tbody>
            <tr><td>Date</td><td>{data.date}</td></tr>
            <tr><td>Total</td><td>{data.total}</td></tr>
            <tr><td>Completed</td><td>{data.completed}</td></tr>
            <tr><td>Failed</td><td>{data.failed}</td></tr>
            <tr><td>Rescheduled</td><td>{data.rescheduled}</td></tr>
            <tr><td>Unassigned</td><td>{data.unassigned}</td></tr>
          </tbody>
        </table>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              {Object.keys(data[0] ?? {}).map((key) => <th key={key}>{key}</th>)}
            </tr>
          </thead>
          <tbody>
            {data.map((row: Record<string, unknown>, idx: number) => (
              <tr key={idx}>
                {Object.values(row).map((v, i) => <td key={i}>{String(v)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

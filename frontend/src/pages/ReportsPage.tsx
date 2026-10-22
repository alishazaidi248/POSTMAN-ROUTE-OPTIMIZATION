import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../lib/apiClient";
import styles from "../styles/components.module.css";

type ReportType = "postmen" | "beats" | "daily";

/** Which fields to show for a row-per-record report, and the label each one reads as - the server's raw field
 * names (postmanId, successRate, ...) are for the CSV export, not for a person reading the table on screen. */
const COLUMNS: Record<"postmen" | "beats", [field: string, label: string][]> = {
  postmen: [
    ["name", "Postman"],
    ["employeeId", "Employee ID"],
    ["assigned", "Assigned"],
    ["delivered", "Delivered"],
    ["failed", "Failed"],
    ["rescheduled", "Rescheduled"],
    ["successRate", "Success rate"]
  ],
  beats: [
    ["beatNumber", "Beat"],
    ["name", "Name"],
    ["total", "Total"],
    ["completed", "Completed"],
    ["pending", "Pending"],
    ["failed", "Failed"]
  ]
};

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
              {COLUMNS[reportType].map(([field, label]) => <th key={field}>{label}</th>)}
            </tr>
          </thead>
          <tbody>
            {data.length === 0 && (
              <tr><td colSpan={COLUMNS[reportType].length}>No data for this report yet.</td></tr>
            )}
            {data.map((row: Record<string, unknown>, idx: number) => (
              <tr key={idx}>
                {COLUMNS[reportType].map(([field]) => (
                  <td key={field}>{field === "beatNumber" ? `B${String(row[field])}` : field === "successRate" ? `${String(row[field])}%` : String(row[field])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

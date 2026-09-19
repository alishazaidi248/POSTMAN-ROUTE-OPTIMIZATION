import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../lib/apiClient";
import styles from "../styles/components.module.css";

export function AuditLogPage() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ["audit-logs", page],
    queryFn: () => apiClient.get("/audit-logs", { params: { page } }).then((r) => r.data)
  });

  if (isLoading || !data) return <p>Loading…</p>;

  return (
    <div>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>User</th>
            <th>Action</th>
            <th>Entity</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((log: any) => (
            <tr key={log.id}>
              <td>{new Date(log.createdAt).toLocaleString()}</td>
              <td>{log.user?.name ?? "System"}</td>
              <td>{log.action}</td>
              <td>{log.entityType}{log.entityId ? ` (${log.entityId.slice(0, 8)}…)` : ""}</td>
              <td>{log.reason ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={styles.toolbar} style={{ marginTop: 12 }}>
        <button className={styles.button} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
        <span>Page {page} · {data.total} total</span>
        <button className={styles.button} disabled={page * data.pageSize >= data.total} onClick={() => setPage((p) => p + 1)}>Next</button>
      </div>
    </div>
  );
}

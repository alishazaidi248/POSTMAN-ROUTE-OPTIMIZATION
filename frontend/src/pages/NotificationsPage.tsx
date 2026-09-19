import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../lib/apiClient";
import { Badge } from "../components/Badge";
import styles from "../styles/components.module.css";

export function NotificationsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => apiClient.get("/notifications").then((r) => r.data)
  });

  const markAllRead = useMutation({
    mutationFn: () => apiClient.post("/notifications/read-all"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] })
  });

  if (isLoading || !data) return <p>Loading…</p>;

  return (
    <div>
      <div className={styles.toolbar}>
        <button className={styles.button} onClick={() => markAllRead.mutate()}>Mark all as read</button>
      </div>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Type</th>
            <th>Message</th>
            <th>Severity</th>
            <th>Date</th>
            <th>Read</th>
          </tr>
        </thead>
        <tbody>
          {data.map((n: any) => (
            <tr key={n.id} style={{ opacity: n.isRead ? 0.6 : 1 }}>
              <td>{n.type}</td>
              <td>{n.message}</td>
              <td><Badge value={n.severity} /></td>
              <td>{new Date(n.createdAt).toLocaleString()}</td>
              <td>{n.isRead ? "Yes" : "No"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

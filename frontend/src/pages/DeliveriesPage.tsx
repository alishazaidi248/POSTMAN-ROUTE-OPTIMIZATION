import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { apiClient } from "../lib/apiClient";
import { Badge } from "../components/Badge";
import styles from "../styles/components.module.css";

interface DeliveryRow {
  id: string;
  trackingId: string;
  status: string;
  priority: string;
  recipient: { name: string; phone: string };
  address: { pincode: string; addressLine1: string };
  beat: { beatNumber: string } | null;
  assignedPostman: { name: string } | null;
}

const STATUS_OPTIONS = [
  "RECEIVED", "SORTED", "ASSIGNED", "OUT_FOR_DELIVERY", "DELIVERED",
  "RECIPIENT_UNAVAILABLE", "REJECTED", "WRONG_ADDRESS", "ADDRESS_NOT_FOUND",
  "RESCHEDULED", "RETURNED", "FAILED", "CANCELLED"
];

export function DeliveriesPage() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ["deliveries", q, status, page],
    queryFn: () =>
      apiClient
        .get("/deliveries", { params: { q: q || undefined, status: status || undefined, page } })
        .then((r) => r.data as { total: number; rows: DeliveryRow[]; pageSize: number })
  });

  return (
    <div>
      <div className={styles.toolbar}>
        <input
          className={styles.input}
          placeholder="Search tracking ID, recipient, phone, pincode…"
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1); }}
          style={{ width: 320 }}
        />
        <select className={styles.input} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
          ))}
        </select>
      </div>

      {isLoading || !data ? (
        <p>Loading deliveries…</p>
      ) : (
        <>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Tracking ID</th>
                <th>Recipient</th>
                <th>Address</th>
                <th>Beat</th>
                <th>Postman</th>
                <th>Priority</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((d) => (
                <tr key={d.id}>
                  <td><Link to={`/deliveries/${d.id}`}>{d.trackingId}</Link></td>
                  <td>{d.recipient.name}<br /><small>{d.recipient.phone}</small></td>
                  <td>{d.address.addressLine1}<br /><small>{d.address.pincode}</small></td>
                  <td>{d.beat?.beatNumber ?? "—"}</td>
                  <td>{d.assignedPostman?.name ?? "—"}</td>
                  <td>{d.priority}</td>
                  <td><Badge value={d.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className={styles.toolbar} style={{ marginTop: 12 }}>
            <button className={styles.button} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
            <span>Page {page} · {data.total} total</span>
            <button className={styles.button} disabled={page * data.pageSize >= data.total} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        </>
      )}
    </div>
  );
}

import { useParams } from "react-router-dom";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { apiClient } from "../lib/apiClient";
import { Badge } from "../components/Badge";
import { ProofPhoto } from "../components/ProofPhoto";
import { friendlyError } from "../lib/friendlyError";
import styles from "../styles/components.module.css";

export function DeliveryDetailPage() {
  const { id } = useParams();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["delivery", id],
    queryFn: () => apiClient.get(`/deliveries/${id}`).then((r) => r.data)
  });

  const statusMutation = useMutation({
    mutationFn: (status: string) => apiClient.post(`/deliveries/${id}/status`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["delivery", id] })
  });

  if (isLoading || !data) return <p>Loading…</p>;

  return (
    <div className={styles.cardGrid} style={{ gridTemplateColumns: "1fr 1fr" }}>
      <div className={styles.card}>
        <h3 className={styles.sectionTitle}>Delivery {data.trackingId}</h3>
        <p>Recipient: {data.recipient.name} ({data.recipient.phone})</p>
        <p>Address: {data.address.addressLine1}, {data.address.city} {data.address.pincode}</p>
        <p>Coordinates: {data.address.latitude ?? "—"}, {data.address.longitude ?? "—"}</p>
        <p>Beat: {data.beat?.beatNumber ?? "Unassigned"}</p>
        <p>Postman: {data.assignedPostman?.name ?? "Unassigned"}</p>
        <p>Status: <Badge value={data.status} /></p>
        {data.assignmentMethod && (
          <div data-testid="assignment-evidence">
            <p>
              Assigned by: <strong>{String(data.assignmentMethod).replace(/_/g, " ").toLowerCase()}</strong>
              {data.assignmentConfidence != null && <> · {data.assignmentConfidence}% confidence</>}
            </p>
            {Array.isArray(data.assignmentEvidence?.evidence) && data.assignmentEvidence.evidence.length > 0 && (
              <ul style={{ margin: "0 0 8px 18px", padding: 0, fontSize: 12 }}>
                {data.assignmentEvidence.evidence.map((line: string) => <li key={line}>{line}</li>)}
              </ul>
            )}
          </div>
        )}

        <div className={styles.formGroup}>
          <label>Change status</label>
          <select className={styles.input} onChange={(e) => e.target.value && statusMutation.mutate(e.target.value)} defaultValue="">
            <option value="" disabled>Select new status…</option>
            {["SORTED", "ASSIGNED", "OUT_FOR_DELIVERY", "DELIVERED", "RECIPIENT_UNAVAILABLE", "FAILED", "RESCHEDULED", "CANCELLED"].map((s) => (
              <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
            ))}
          </select>
          {statusMutation.isError && <p className={styles.errorText}>{friendlyError(statusMutation.error, "The status could not be changed.")}</p>}
        </div>

        {data.proof && (
          <div>
            <h3 className={styles.sectionTitle} style={{ marginTop: 16 }}>Proof of delivery</h3>
            <p style={{ fontSize: 12 }}>Photo taken {new Date(data.proof.capturedAt).toLocaleString()}</p>
            <ProofPhoto deliveryId={data.id} />
          </div>
        )}
      </div>

      <div className={styles.card}>
        <h3 className={styles.sectionTitle}>Status History</h3>
        <table className={styles.table}>
          <tbody>
            {data.statusHistory.map((h: any) => (
              <tr key={h.id}>
                <td>{new Date(h.createdAt).toLocaleString()}</td>
                <td>{h.fromStatus ?? "—"} → {h.toStatus}</td>
                <td>{h.reason ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {data.exceptions.length > 0 && (
          <>
            <h3 className={styles.sectionTitle} style={{ marginTop: 16 }}>Assignment Exceptions</h3>
            {data.exceptions.map((e: any) => (
              <p key={e.id}><Badge value={e.reason} /> {e.resolvedAt ? "resolved" : "open"}</p>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

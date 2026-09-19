import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../lib/apiClient";
import { Badge } from "../components/Badge";
import styles from "../styles/components.module.css";

export function ImportDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: importRecord, isLoading } = useQuery({
    queryKey: ["import", id],
    queryFn: () => apiClient.get(`/imports/${id}`).then((r) => r.data)
  });

  const { data: rows } = useQuery({
    queryKey: ["import-rows", id],
    queryFn: () => apiClient.get(`/imports/${id}/rows`).then((r) => r.data),
    enabled: !!importRecord && importRecord.status === "PREVIEW_READY"
  });

  const confirmMutation = useMutation({
    mutationFn: () => apiClient.post(`/imports/${id}/confirm`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["import", id] });
      queryClient.invalidateQueries({ queryKey: ["imports"] });
    }
  });

  const cancelMutation = useMutation({
    mutationFn: () => apiClient.post(`/imports/${id}/cancel`),
    onSuccess: () => navigate("/imports")
  });

  if (isLoading || !importRecord) return <p>Loading…</p>;

  const counts = {
    total: importRecord.totalRows,
    valid: importRecord.validRows,
    invalid: importRecord.invalidRows,
    duplicates: importRecord.duplicateRows,
    missing: importRecord.missingDataRows
  };

  return (
    <div>
      <div className={styles.card} style={{ marginBottom: "var(--space-4)" }}>
        <h3 className={styles.sectionTitle}>Import Preview — {importRecord.originalFilename}</h3>
        {importRecord.errorSummary && <p className={styles.errorText}>{importRecord.errorSummary}</p>}
        <p>
          Total rows: {counts.total} · Valid: {counts.valid} · Invalid: {counts.invalid} · Duplicates: {counts.duplicates} · Missing
          data: {counts.missing}
        </p>
        <p>Status: <Badge value={importRecord.status} /></p>

        {importRecord.status === "PREVIEW_READY" && (
          <div className={styles.toolbar}>
            <button className={styles.buttonDanger} onClick={() => cancelMutation.mutate()}>Cancel Import</button>
            <button className={styles.buttonPrimary} onClick={() => confirmMutation.mutate()} disabled={confirmMutation.isPending}>
              {confirmMutation.isPending ? "Confirming…" : "Confirm Import"}
            </button>
          </div>
        )}
      </div>

      {rows && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Row</th>
              <th>Name</th>
              <th>Phone</th>
              <th>Address</th>
              <th>Pincode</th>
              <th>Status</th>
              <th>Errors</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r: any) => (
              <tr key={r.id}>
                <td>{r.rowNumber}</td>
                <td>{r.normalizedData?.recipientName}</td>
                <td>{r.normalizedData?.phone}</td>
                <td>{r.normalizedData?.addressLine1}</td>
                <td>{r.normalizedData?.pincode}</td>
                <td><Badge value={r.status} /></td>
                <td>{Array.isArray(r.errors) ? r.errors.join("; ") : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

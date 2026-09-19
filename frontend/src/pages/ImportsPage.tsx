import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../lib/apiClient";
import { Badge } from "../components/Badge";
import styles from "../styles/components.module.css";

interface ImportRow {
  id: string;
  originalFilename: string;
  uploadedBy: { name: string };
  createdAt: string;
  totalRows: number;
  successfulRows: number;
  duplicateRows: number;
  geocodingFailedRows: number;
  assignmentFailedRows: number;
  status: string;
}

export function ImportsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery<ImportRow[]>({
    queryKey: ["imports"],
    queryFn: () => apiClient.get("/imports").then((r) => r.data)
  });

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await apiClient.post("/imports/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" }
      });
      queryClient.invalidateQueries({ queryKey: ["imports"] });
      if (res.data.import) navigate(`/imports/${res.data.import.id}`);
    } catch (err: any) {
      setError(err.response?.data?.error?.message ?? "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div>
      <div className={styles.card} style={{ marginBottom: "var(--space-4)" }}>
        <h3 className={styles.sectionTitle}>Upload delivery file (CSV, XLSX, PDF)</h3>
        <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.pdf" onChange={handleFileChange} disabled={uploading} />
        {uploading && <p>Uploading and processing…</p>}
        {error && <p className={styles.errorText}>{error}</p>}
      </div>

      <h3 className={styles.sectionTitle}>Import History</h3>
      {isLoading || !data ? (
        <p>Loading…</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>File</th>
              <th>Uploaded By</th>
              <th>Date</th>
              <th>Records</th>
              <th>Successful</th>
              <th>Duplicates</th>
              <th>Geocoding Failures</th>
              <th>Assignment Failures</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {data.map((imp) => (
              <tr key={imp.id} onClick={() => navigate(`/imports/${imp.id}`)} style={{ cursor: "pointer" }}>
                <td>{imp.originalFilename}</td>
                <td>{imp.uploadedBy?.name}</td>
                <td>{new Date(imp.createdAt).toLocaleString()}</td>
                <td>{imp.totalRows}</td>
                <td>{imp.successfulRows}</td>
                <td>{imp.duplicateRows}</td>
                <td>{imp.geocodingFailedRows}</td>
                <td>{imp.assignmentFailedRows}</td>
                <td><Badge value={imp.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

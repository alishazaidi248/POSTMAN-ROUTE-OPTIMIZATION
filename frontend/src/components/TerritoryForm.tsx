import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../lib/apiClient";
import styles from "../styles/components.module.css";

interface PostmanOption {
  id: string;
  name: string;
  employeeId: string;
}

export interface TerritoryFormValues {
  beatNumber: string;
  name: string;
  postmanId: string;
}

export function TerritoryForm({
  onSubmit,
  onCancel
}: {
  onSubmit: (values: TerritoryFormValues) => Promise<void>;
  onCancel: () => void;
}) {
  const [beatNumber, setBeatNumber] = useState("");
  const [name, setName] = useState("");
  const [postmanId, setPostmanId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { data: postmen } = useQuery<PostmanOption[]>({
    queryKey: ["postmen-for-assignment"],
    queryFn: () => apiClient.get("/postmen").then((r) => r.data)
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!beatNumber.trim() || !name.trim()) {
      setError("Beat number and name are required.");
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({ beatNumber: beatNumber.trim(), name: name.trim(), postmanId });
    } catch (err: any) {
      setError(err.response?.data?.error?.message ?? "Failed to create territory");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className={styles.formGroup}>
        <label htmlFor="beatNumber">Beat / Territory Number</label>
        <input id="beatNumber" className={styles.input} value={beatNumber} onChange={(e) => setBeatNumber(e.target.value)} placeholder="e.g. B03" />
      </div>

      <div className={styles.formGroup}>
        <label htmlFor="territoryName">Territory Name</label>
        <input id="territoryName" className={styles.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Bhandup West - Sector C" />
      </div>

      <div className={styles.formGroup}>
        <label htmlFor="postman">Assign Postman (optional)</label>
        <select id="postman" className={styles.input} value={postmanId} onChange={(e) => setPostmanId(e.target.value)}>
          <option value="">Leave unassigned</option>
          {postmen?.map((p) => (
            <option key={p.id} value={p.id}>{p.name} ({p.employeeId})</option>
          ))}
        </select>
      </div>

      {error && <p className={styles.errorText}>{error}</p>}

      <div className={styles.toolbar} style={{ justifyContent: "flex-end", marginTop: 8 }}>
        <button type="button" className={styles.button} onClick={onCancel}>Cancel</button>
        <button type="submit" className={styles.buttonPrimary} disabled={submitting}>
          {submitting ? "Creating…" : "Create Territory"}
        </button>
      </div>
    </form>
  );
}

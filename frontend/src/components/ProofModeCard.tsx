import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../lib/apiClient";
import { friendlyError } from "../lib/friendlyError";
import { useAuth } from "../lib/auth";
import styles from "../styles/components.module.css";

interface Office {
  id: string;
  name: string;
  proofMode: "NONE" | "PHOTO";
}

/** What the post office requires as proof of delivery. The server enforces it: with PHOTO, DELIVERED is refused without the photo. */
export function ProofModeCard() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const offices = useQuery<Office[]>({ queryKey: ["post-offices"], queryFn: () => apiClient.get("/post-offices").then((r) => r.data) });
  const change = useMutation({
    mutationFn: (v: { id: string; proofMode: "NONE" | "PHOTO" }) => apiClient.put(`/post-offices/${v.id}/proof-mode`, { proofMode: v.proofMode }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["post-offices"] })
  });
  if (!user || user.role === "POSTMAN" || !offices.data?.length) return null;

  return (
    <div className={styles.card} data-testid="proof-mode-card">
      <h3 className={styles.sectionTitle}>Proof of delivery</h3>
      {offices.data.map((o) => (
        <div key={o.id} className={styles.formGroup}>
          <label htmlFor={`proof-${o.id}`}>{offices.data.length > 1 ? o.name : "Required to complete a delivery"}</label>
          <select
            id={`proof-${o.id}`}
            className={styles.input}
            value={o.proofMode}
            disabled={change.isPending}
            onChange={(e) => change.mutate({ id: o.id, proofMode: e.target.value as "NONE" | "PHOTO" })}
          >
            <option value="NONE">Nothing extra (a status change is enough)</option>
            <option value="PHOTO">A photo of the delivery</option>
          </select>
        </div>
      ))}
      {change.isError && <p className={styles.errorText}>{friendlyError(change.error, "The setting could not be changed.")}</p>}
      <p style={{ fontSize: 12, color: "var(--color-ink-500)" }}>
        With a photo required, the server refuses to mark a delivery as delivered until the postman has added it. Photos are private to this post office.
      </p>
    </div>
  );
}

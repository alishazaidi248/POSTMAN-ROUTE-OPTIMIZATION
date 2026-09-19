import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { apiClient } from "../lib/apiClient";
import { useAuth } from "../lib/auth";
import { Badge } from "../components/Badge";
import { Modal } from "../components/Modal";
import { PostmanForm, PostmanFormValues } from "../components/PostmanForm";
import styles from "../styles/components.module.css";

interface PostmanRow {
  id: string;
  employeeId: string;
  name: string;
  phone: string;
  status: string;
  beat: { beatNumber: string; name: string } | null;
  postOffice: { id: string; name: string; code: string } | null;
  lastActiveAt: string | null;
  totals: { assigned: number; delivered: number; failed: number; rescheduled: number };
}

export function PostmenPage() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "SUPER_ADMIN";
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery<PostmanRow[]>({
    queryKey: ["postmen"],
    queryFn: () => apiClient.get("/postmen").then((r) => r.data)
  });

  const createMutation = useMutation({
    mutationFn: (values: PostmanFormValues) =>
      apiClient.post("/postmen", {
        ...values,
        postOfficeId: isSuperAdmin ? values.postOfficeId : user!.postOfficeId,
        email: values.email || undefined
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["postmen"] });
      setShowCreate(false);
    },
    onError: (err: any) => setError(err.response?.data?.error?.message ?? "Failed to create postman")
  });

  if (isLoading || !data) return <p>Loading postmen…</p>;

  return (
    <div>
      <div className={styles.toolbar}>
        <button className={styles.buttonPrimary} onClick={() => { setError(null); setShowCreate(true); }}>
          + Add Postman
        </button>
      </div>

      <table className={styles.table}>
        <thead>
          <tr>
            <th>Postman</th>
            <th>Employee ID</th>
            <th>Contact</th>
            {isSuperAdmin && <th>Post Office</th>}
            <th>Beat</th>
            <th>Deliveries</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {data.map((p) => (
            <tr key={p.id}>
              <td><Link to={`/postmen/${p.id}`}>{p.name}</Link></td>
              <td>{p.employeeId}</td>
              <td>{p.phone}</td>
              {isSuperAdmin && <td>{p.postOffice ? `${p.postOffice.name} (${p.postOffice.code})` : "—"}</td>}
              <td>{p.beat ? `${p.beat.beatNumber} — ${p.beat.name}` : "Unassigned"}</td>
              <td>{p.totals.delivered} / {p.totals.assigned}</td>
              <td><Badge value={p.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>

      {showCreate && (
        <Modal title="Add Postman" onClose={() => setShowCreate(false)}>
          {error && <p className={styles.errorText}>{error}</p>}
          <PostmanForm
            submitLabel="Create Postman"
            requirePostOffice={isSuperAdmin}
            onCancel={() => setShowCreate(false)}
            onSubmit={async (values) => {
              setError(null);
              try {
                await createMutation.mutateAsync(values);
              } catch {
                // error state is already set by the mutation's onError handler
              }
            }}
          />
        </Modal>
      )}
    </div>
  );
}

import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../lib/apiClient";
import { Badge } from "../components/Badge";
import { Modal } from "../components/Modal";
import { PostmanForm, PostmanFormValues } from "../components/PostmanForm";
import styles from "../styles/components.module.css";

export function PostmanDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showEdit, setShowEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["postman", id],
    queryFn: () => apiClient.get(`/postmen/${id}`).then((r) => r.data)
  });

  const updateMutation = useMutation({
    mutationFn: (values: PostmanFormValues) =>
      apiClient.put(`/postmen/${id}`, { ...values, email: values.email || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["postman", id] });
      queryClient.invalidateQueries({ queryKey: ["postmen"] });
      setShowEdit(false);
    },
    onError: (err: any) => setError(err.response?.data?.error?.message ?? "Failed to update postman")
  });

  const { data: beats } = useQuery<{ id: string; beatNumber: string; name: string }[]>({
    queryKey: ["beats"],
    queryFn: () => apiClient.get("/beats").then((r) => r.data)
  });

  const assignBeatMutation = useMutation({
    mutationFn: (beatId: string | null) => apiClient.post(`/postmen/${id}/assign-beat`, { beatId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["postman", id] });
      queryClient.invalidateQueries({ queryKey: ["postmen"] });
      queryClient.invalidateQueries({ queryKey: ["beats"] });
    }
  });

  const deactivateMutation = useMutation({
    mutationFn: () => apiClient.post(`/postmen/${id}/deactivate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["postman", id] });
      queryClient.invalidateQueries({ queryKey: ["postmen"] });
    }
  });

  const activateMutation = useMutation({
    mutationFn: () => apiClient.post(`/postmen/${id}/activate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["postman", id] });
      queryClient.invalidateQueries({ queryKey: ["postmen"] });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiClient.delete(`/postmen/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["postmen"] });
      navigate("/postmen");
    },
    onError: (err: any) => setDeleteError(err.response?.data?.error?.message ?? "Failed to delete postman")
  });

  if (isLoading || !data) return <p>Loading…</p>;

  function handleDelete() {
    setDeleteError(null);
    if (window.confirm(`Permanently delete ${data.name}? This cannot be undone.`)) {
      deleteMutation.mutate();
    }
  }

  return (
    <div className={styles.cardGrid} style={{ gridTemplateColumns: "1fr 1fr" }}>
      <div className={styles.card}>
        <div className={styles.toolbar} style={{ justifyContent: "space-between", marginBottom: 8 }}>
          <h3 className={styles.sectionTitle} style={{ margin: 0 }}>Personal Information</h3>
          <div className={styles.toolbar} style={{ margin: 0 }}>
            <button className={styles.button} onClick={() => { setError(null); setShowEdit(true); }}>Edit</button>
            {data.status !== "INACTIVE" ? (
              <button className={styles.button} onClick={() => deactivateMutation.mutate()} disabled={deactivateMutation.isPending}>
                Deactivate
              </button>
            ) : (
              <button className={styles.button} onClick={() => activateMutation.mutate()} disabled={activateMutation.isPending}>
                Activate
              </button>
            )}
            <button className={styles.buttonDanger} onClick={handleDelete} disabled={deleteMutation.isPending}>
              Delete
            </button>
          </div>
        </div>

        {deleteError && <p className={styles.errorText}>{deleteError}</p>}

        <p><strong>{data.name}</strong> ({data.employeeId})</p>
        <p>Phone: {data.phone}</p>
        <p>Email: {data.email ?? "—"}</p>
        <p>Address: {data.address ?? "—"}</p>
        <p>Emergency contact: {data.emergencyContact ?? "—"}</p>
        <p>Status: <Badge value={data.status} /></p>
        <div className={styles.formGroup}>
          <label htmlFor="assignedBeat">Assigned Beat</label>
          <select
            id="assignedBeat"
            className={styles.input}
            value={data.assignedBeatId ?? ""}
            disabled={assignBeatMutation.isPending}
            onChange={(e) => assignBeatMutation.mutate(e.target.value || null)}
          >
            <option value="">Unassigned</option>
            {beats?.map((b) => (
              <option key={b.id} value={b.id}>{b.beatNumber} — {b.name}</option>
            ))}
          </select>
        </div>
        <p>Last active: {data.lastActiveAt ? new Date(data.lastActiveAt).toLocaleString() : "No location data yet"}</p>
        {data.currentLocation && (
          <p>
            Current location: {data.currentLocation.latitude.toFixed(5)}, {data.currentLocation.longitude.toFixed(5)}
            {data.currentLocation.isMock && <span className={styles.badge + " " + styles.badgeWarning} style={{ marginLeft: 8 }}>MOCK DATA</span>}
          </p>
        )}
      </div>

      <div className={styles.card}>
        <h3 className={styles.sectionTitle}>Historical Performance</h3>
        <table className={styles.table}>
          <tbody>
            <tr><td>Total assigned</td><td>{data.performance.totalAssigned}</td></tr>
            <tr><td>Total delivered</td><td>{data.performance.totalDelivered}</td></tr>
            <tr><td>Total failed</td><td>{data.performance.totalFailed}</td></tr>
            <tr><td>Total rescheduled</td><td>{data.performance.totalRescheduled}</td></tr>
            <tr><td>Success rate</td><td>{data.performance.successRate}%</td></tr>
          </tbody>
        </table>
      </div>

      {showEdit && (
        <Modal title={`Edit ${data.name}`} onClose={() => setShowEdit(false)}>
          {error && <p className={styles.errorText}>{error}</p>}
          <PostmanForm
            submitLabel="Save Changes"
            disableEmployeeId
            defaultValues={{
              employeeId: data.employeeId,
              name: data.name,
              phone: data.phone,
              email: data.email ?? "",
              address: data.address ?? "",
              emergencyContact: data.emergencyContact ?? ""
            }}
            onCancel={() => setShowEdit(false)}
            onSubmit={async (values) => {
              setError(null);
              try {
                await updateMutation.mutateAsync(values);
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

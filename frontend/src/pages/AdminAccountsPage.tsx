import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../lib/apiClient";
import { Badge } from "../components/Badge";
import { Modal } from "../components/Modal";
import { UserForm, UserFormValues } from "../components/UserForm";
import styles from "../styles/components.module.css";

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  lastLoginAt: string | null;
  postOffice: { id: string; name: string; code: string } | null;
}

export function AdminAccountsPage() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery<UserRow[]>({
    queryKey: ["users"],
    queryFn: () => apiClient.get("/users").then((r) => r.data)
  });

  const createMutation = useMutation({
    mutationFn: (values: UserFormValues) =>
      apiClient.post("/users", { ...values, postOfficeId: values.postOfficeId || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setShowCreate(false);
    },
    onError: (err: any) => setError(err.response?.data?.error?.message ?? "Failed to create account")
  });

  const toggleStatusMutation = useMutation({
    mutationFn: ({ id, activate }: { id: string; activate: boolean }) =>
      apiClient.post(`/users/${id}/${activate ? "activate" : "deactivate"}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] })
  });

  if (isError) {
    return <p className={styles.errorText}>Admin account management is only available to Super Admins.</p>;
  }

  if (isLoading || !data) return <p>Loading accounts…</p>;

  return (
    <div>
      <div className={styles.toolbar}>
        <button className={styles.buttonPrimary} onClick={() => { setError(null); setShowCreate(true); }}>
          + Add Admin Account
        </button>
      </div>

      <table className={styles.table}>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>Post Office</th>
            <th>Last Login</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {data.map((u) => (
            <tr key={u.id}>
              <td>{u.name}</td>
              <td>{u.email}</td>
              <td>{u.role.replace("_", " ")}</td>
              <td>{u.postOffice ? `${u.postOffice.name} (${u.postOffice.code})` : "— all post offices —"}</td>
              <td>{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "Never"}</td>
              <td><Badge value={u.status} /></td>
              <td>
                <button
                  className={styles.button}
                  onClick={() => toggleStatusMutation.mutate({ id: u.id, activate: u.status !== "ACTIVE" })}
                >
                  {u.status === "ACTIVE" ? "Deactivate" : "Activate"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {showCreate && (
        <Modal title="Add Admin Account" onClose={() => setShowCreate(false)}>
          {error && <p className={styles.errorText}>{error}</p>}
          <UserForm
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

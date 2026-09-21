import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../lib/apiClient";
import { friendlyError } from "../lib/friendlyError";
import { Avatar } from "../components/Avatar";
import { Modal } from "../components/Modal";
import { PostmanForm, PostmanFormValues } from "../components/PostmanForm";
import { PostmanPhotoDialog } from "../components/PostmanPhotoDialog";
import { PostmanRouteCard } from "../components/PostmanRouteCard";
import { useToast } from "../components/Toast";
import { StatusPill } from "./PostmenPage";
import styles from "../styles/postmen.module.css";

interface PostmanDetail {
  id: string;
  employeeId: string;
  name: string;
  phone: string;
  email: string | null;
  address: string | null;
  emergencyContact: string | null;
  status: "ACTIVE" | "ON_LEAVE" | "INACTIVE";
  assignedBeatId: string | null;
  assignedBeat: { beatNumber: string; name: string } | null;
  postOfficeName: string;
  photoUrl: string | null;
  today: { total: number; completed: number; remaining: number };
  currentLocation: { latitude: number; longitude: number; isMock: boolean; recordedAt: string } | null;
  lastActiveAt: string | null;
  account: { email: string; status: string; lastLoginAt?: string | null } | null;
  performance: { totalAssigned: number; totalDelivered: number; totalFailed: number; totalRescheduled: number; successRate: number };
}

/**
 * The login the postman signs in to the mobile app with (a User with role POSTMAN linked
 * by User.postmanId). Created and reset by the server; the app never chooses which
 * postman an account belongs to.
 */
function AccountCard({ postmanId, account }: { postmanId: string; account: PostmanDetail["account"] }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () => apiClient.post(`/postmen/${postmanId}/account`, { email, password }),
    onSuccess: () => {
      setEmail("");
      setPassword("");
      setError(null);
      toast.success("Login created. The postman can now sign in to the app.");
      queryClient.invalidateQueries({ queryKey: ["postman", postmanId] });
    },
    onError: (err) => setError(friendlyError(err, "The login could not be created."))
  });

  const resetMutation = useMutation({
    mutationFn: () => apiClient.post(`/postmen/${postmanId}/account/password`, { password }),
    onSuccess: () => {
      setPassword("");
      setError(null);
      toast.success("Password changed. Every device this postman was signed in on must sign in again.");
    },
    onError: (err) => setError(friendlyError(err, "The password could not be changed."))
  });

  return (
    <div className={styles.card}>
      <div className={styles.section} style={{ borderTop: 0 }}>
        <h3 className={styles.sectionTitle}>Mobile app login</h3>
        {account ? (
          <>
            <dl className={styles.facts}>
              <dt>Login email</dt><dd>{account.email}</dd>
              <dt>Last sign-in</dt><dd>{account.lastLoginAt ? new Date(account.lastLoginAt).toLocaleString() : "Never"}</dd>
            </dl>
            <div className="field" style={{ margin: "14px 0 10px" }}>
              <label htmlFor="newPassword" style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Set a new password</label>
              <input id="newPassword" type="password" style={{ height: 34, padding: "0 10px", border: "1px solid var(--color-border-strong)", borderRadius: 6, width: "min(320px, 100%)" }} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
            </div>
            <button className={styles.btn} disabled={password.length < 8 || resetMutation.isPending} onClick={() => resetMutation.mutate()}>
              Change password
            </button>
          </>
        ) : (
          <>
            <p style={{ marginTop: 0 }}>This postman has no login yet, so they cannot use the app.</p>
            <div style={{ display: "grid", gap: 10, maxWidth: 320 }}>
              <div>
                <label htmlFor="accountEmail" style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Login email</label>
                <input id="accountEmail" style={{ height: 34, padding: "0 10px", border: "1px solid var(--color-border-strong)", borderRadius: 6, width: "100%" }} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@postal.local" />
              </div>
              <div>
                <label htmlFor="accountPassword" style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Password</label>
                <input id="accountPassword" type="password" style={{ height: 34, padding: "0 10px", border: "1px solid var(--color-border-strong)", borderRadius: 6, width: "100%" }} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
              </div>
              <div>
                <button className={`${styles.btn} ${styles.btnPrimary}`} disabled={!email || password.length < 8 || createMutation.isPending} onClick={() => createMutation.mutate()}>
                  Create login
                </button>
              </div>
            </div>
          </>
        )}
        {error && <p className={styles.errorText}>{error}</p>}
      </div>
    </div>
  );
}

export function PostmanDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [showEdit, setShowEdit] = useState(false);
  const [showPhoto, setShowPhoto] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery<PostmanDetail>({
    queryKey: ["postman", id],
    queryFn: () => apiClient.get(`/postmen/${id}`).then((r) => r.data)
  });

  const { data: beats } = useQuery<{ id: string; beatNumber: string; name: string }[]>({
    queryKey: ["beats"],
    queryFn: () => apiClient.get("/beats").then((r) => r.data)
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["postman", id] });
    queryClient.invalidateQueries({ queryKey: ["postmen"] });
    queryClient.invalidateQueries({ queryKey: ["beats"] });
  };

  const updateMutation = useMutation({
    mutationFn: (values: PostmanFormValues) => apiClient.put(`/postmen/${id}`, { ...values, email: values.email || undefined }),
    onSuccess: () => {
      refresh();
      setShowEdit(false);
      toast.success("Details saved successfully.");
    },
    onError: (err) => setError(friendlyError(err, "The details could not be saved."))
  });

  const assignBeatMutation = useMutation({
    mutationFn: (beatId: string | null) => apiClient.post(`/postmen/${id}/assign-beat`, { beatId }),
    onSuccess: () => {
      refresh();
      toast.success("Beat assigned successfully.");
    },
    onError: (err) => toast.error(friendlyError(err, "The beat could not be assigned."))
  });

  const statusMutation = useMutation({
    mutationFn: (action: "activate" | "deactivate") => apiClient.post(`/postmen/${id}/${action}`),
    onSuccess: refresh
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiClient.delete(`/postmen/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["postmen"] });
      toast.success("The postman was deleted.");
      navigate("/postmen");
    },
    onError: (err) => toast.error(friendlyError(err, "The postman could not be deleted."))
  });

  const removePhoto = useMutation({
    mutationFn: () => apiClient.delete(`/postmen/${id}/photo`),
    onSuccess: () => {
      refresh();
      toast.success("Profile photo removed.");
    },
    onError: (err) => toast.error(friendlyError(err, "The photo could not be removed."))
  });

  if (isError) {
    return (
      <p>
        This postman could not be loaded. <button className={styles.btn} onClick={() => void refetch()}>Try Again</button> <Link to="/postmen">Back to postmen</Link>
      </p>
    );
  }
  if (isLoading || !data) return <p>Loading…</p>;

  function handleDelete() {
    if (window.confirm(`Permanently delete ${data?.name}? This cannot be undone.`)) deleteMutation.mutate();
  }

  const beatLabel = data.assignedBeat ? `${data.assignedBeat.beatNumber} — ${data.assignedBeat.name}` : "No beat assigned";

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div>
          <h1 className={styles.title}>Postman profile</h1>
          <p className={styles.sub}><Link to="/postmen">Postmen</Link> / {data.name}</p>
        </div>
      </div>

      <div className={styles.profile}>
        <div className={styles.card}>
          <div className={styles.identity}>
            <Avatar name={data.name} photoUrl={data.photoUrl} size={112} />
            <h2 className={styles.identityName}>{data.name}</h2>
            <div className={styles.identityMeta}>{data.employeeId}</div>
            <div style={{ marginTop: 6 }}><StatusPill status={data.status} /></div>
            <div className={styles.identityMeta} style={{ marginTop: 10 }}>
              <div>{beatLabel}</div>
              <div>{data.postOfficeName}</div>
            </div>
            <div className={styles.photoActions}>
              <button className={styles.btn} onClick={() => setShowPhoto(true)}>Change Photo</button>
              {data.photoUrl && (
                <button className={`${styles.btn} ${styles.btnDanger}`} onClick={() => removePhoto.mutate()} disabled={removePhoto.isPending}>
                  Remove Photo
                </button>
              )}
            </div>
          </div>
          <div className={styles.workNumbers} data-testid="today-numbers">
            <div className={styles.workNumber}><div className={styles.workValue}>{data.today.total}</div><div className={styles.workLabel}>Today&rsquo;s Deliveries</div></div>
            <div className={styles.workNumber}><div className={styles.workValue}>{data.today.completed}</div><div className={styles.workLabel}>Completed</div></div>
            <div className={styles.workNumber}><div className={styles.workValue}>{data.today.remaining}</div><div className={styles.workLabel}>Remaining</div></div>
          </div>
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Contact</h3>
            <dl className={styles.facts} style={{ gridTemplateColumns: "100px 1fr" }}>
              <dt>Phone</dt><dd>{data.phone}</dd>
              <dt>Email</dt><dd>{data.email ?? "—"}</dd>
            </dl>
          </div>
        </div>

        <div className={styles.stack}>
          <div className={styles.card}>
            <div className={styles.section} style={{ borderTop: 0 }}>
              <h3 className={styles.sectionTitle}>Assignment</h3>
              <div style={{ maxWidth: 360 }}>
                <label htmlFor="assignedBeat" style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Assigned beat</label>
                <select
                  id="assignedBeat"
                  style={{ height: 34, padding: "0 10px", border: "1px solid var(--color-border-strong)", borderRadius: 6, width: "100%" }}
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
              <dl className={styles.facts} style={{ marginTop: 16 }}>
                <dt>Address</dt><dd>{data.address ?? "—"}</dd>
                <dt>Emergency contact</dt><dd>{data.emergencyContact ?? "—"}</dd>
                <dt>Last active</dt><dd>{data.lastActiveAt ? new Date(data.lastActiveAt).toLocaleString() : "No location data yet"}</dd>
              </dl>
            </div>
            <div className={styles.section}>
              <div className={styles.actionsRow}>
                <button className={styles.btn} onClick={() => { setError(null); setShowEdit(true); }}>Edit details</button>
                {data.status !== "INACTIVE" ? (
                  <button className={styles.btn} onClick={() => statusMutation.mutate("deactivate")} disabled={statusMutation.isPending}>Deactivate</button>
                ) : (
                  <button className={styles.btn} onClick={() => statusMutation.mutate("activate")} disabled={statusMutation.isPending}>Activate</button>
                )}
                <button className={`${styles.btn} ${styles.btnDanger}`} onClick={handleDelete} disabled={deleteMutation.isPending}>Delete</button>
              </div>
            </div>
          </div>

          <div className={styles.card}>
            <div className={styles.section} style={{ borderTop: 0 }}>
              <h3 className={styles.sectionTitle}>Performance</h3>
              <dl className={styles.facts}>
                <dt>Total assigned</dt><dd>{data.performance.totalAssigned}</dd>
                <dt>Delivered</dt><dd>{data.performance.totalDelivered}</dd>
                <dt>Failed</dt><dd>{data.performance.totalFailed}</dd>
                <dt>Rescheduled</dt><dd>{data.performance.totalRescheduled}</dd>
                <dt>Success rate</dt><dd>{data.performance.successRate}%</dd>
              </dl>
            </div>
          </div>

          <AccountCard postmanId={data.id} account={data.account} />
        </div>
      </div>

      <PostmanRouteCard postmanId={data.id} />

      {showPhoto && (
        <PostmanPhotoDialog
          postmanId={data.id}
          name={data.name}
          currentUrl={data.photoUrl}
          onClose={() => setShowPhoto(false)}
          onSaved={() => {
            setShowPhoto(false);
            refresh();
          }}
        />
      )}

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
                // the message is already shown: onError above set it
              }
            }}
          />
        </Modal>
      )}
    </div>
  );
}

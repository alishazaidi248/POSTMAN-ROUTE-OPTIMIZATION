import { KeyboardEvent, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { apiClient } from "../lib/apiClient";
import { friendlyError } from "../lib/friendlyError";
import { useAuth } from "../lib/auth";
import { Avatar } from "../components/Avatar";
import { Icon } from "../components/icons";
import { Modal } from "../components/Modal";
import { PostmanForm, PostmanFormValues } from "../components/PostmanForm";
import { useToast } from "../components/Toast";
import styles from "../styles/postmen.module.css";

export interface PostmanRow {
  id: string;
  employeeId: string;
  name: string;
  phone: string;
  status: "ACTIVE" | "ON_LEAVE" | "INACTIVE";
  beat: { beatNumber: string; name: string } | null;
  postOffice: { id: string; name: string; code: string } | null;
  photoUrl: string | null;
  onDelivery: boolean;
  today: { total: number; completed: number; remaining: number };
}

type Filter = "ALL" | "ACTIVE" | "INACTIVE" | "UNASSIGNED";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "ACTIVE", label: "Active" },
  { key: "INACTIVE", label: "Inactive" },
  { key: "UNASSIGNED", label: "Unassigned" }
];

const matches = (p: PostmanRow, filter: Filter) =>
  filter === "ALL" ||
  (filter === "ACTIVE" && p.status === "ACTIVE") ||
  (filter === "INACTIVE" && p.status !== "ACTIVE") ||
  (filter === "UNASSIGNED" && p.beat === null);

const STATUS_LABEL: Record<PostmanRow["status"], string> = { ACTIVE: "Active", ON_LEAVE: "On leave", INACTIVE: "Inactive" };

export function StatusPill({ status }: { status: PostmanRow["status"] }) {
  const tone = status === "ACTIVE" ? styles.badgeActive : status === "ON_LEAVE" ? styles.badgeWarn : styles.badgeMuted;
  return (
    <span className={`${styles.badge} ${tone}`}>
      <span className={styles.dot} aria-hidden="true" />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function PostmenPage() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "SUPER_ADMIN";
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("ALL");

  const { data, isLoading, isError, refetch } = useQuery<PostmanRow[]>({
    queryKey: ["postmen"],
    queryFn: () => apiClient.get("/postmen").then((r) => r.data)
  });

  const createMutation = useMutation({
    mutationFn: (values: PostmanFormValues) =>
      apiClient.post("/postmen", {
        ...values,
        postOfficeId: isSuperAdmin ? values.postOfficeId : user?.postOfficeId,
        email: values.email || undefined
      }),
    onSuccess: (_res, values) => {
      queryClient.invalidateQueries({ queryKey: ["postmen"] });
      setShowCreate(false);
      toast.success(`${values.name} was added successfully.`);
    },
    onError: (err) => setError(friendlyError(err, "The postman could not be added."))
  });

  const people = useMemo(() => data ?? [], [data]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return people.filter(
      (p) =>
        matches(p, filter) &&
        (!q || [p.name, p.employeeId, p.phone, p.beat?.beatNumber ?? "", p.beat?.name ?? ""].some((v) => v.toLowerCase().includes(q)))
    );
  }, [people, query, filter]);

  const stats = {
    total: people.length,
    active: people.filter((p) => p.status === "ACTIVE").length,
    unassigned: people.filter((p) => p.beat === null).length,
    onDelivery: people.filter((p) => p.onDelivery).length
  };

  const open = (p: PostmanRow) => navigate(`/postmen/${p.id}`);
  const onKey = (e: KeyboardEvent, p: PostmanRow) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open(p);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div>
          <h1 className={styles.title}>Postmen</h1>
          <p className={styles.sub}>Manage delivery staff and their assigned beats.</p>
        </div>
        <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => { setError(null); setShowCreate(true); }}>
          <Icon name="plus" size={16} /> Add Postman
        </button>
      </div>

      <div className={styles.stats} data-testid="postmen-stats">
        {[
          ["Total Postmen", stats.total],
          ["Active", stats.active],
          ["Unassigned", stats.unassigned],
          ["On Delivery", stats.onDelivery]
        ].map(([label, value]) => (
          <div key={label} className={styles.stat}>
            <div className={styles.statValue}>{value}</div>
            <div className={styles.statLabel}>{label}</div>
          </div>
        ))}
      </div>

      <div className={styles.controls}>
        <div className={styles.search}>
          <span className={styles.searchIcon}><Icon name="search" size={16} /></span>
          <input className={styles.searchInput} placeholder="Search postmen..." aria-label="Search postmen" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className={styles.filters} role="group" aria-label="Filter postmen">
          {FILTERS.map((f) => (
            <button key={f.key} className={`${styles.filter} ${filter === f.key ? styles.filterActive : ""}`} onClick={() => setFilter(f.key)} aria-pressed={filter === f.key}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.scroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Postman</th>
                <th>Beat</th>
                {isSuperAdmin && <th>Post office</th>}
                <th>Deliveries today</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={isSuperAdmin ? 5 : 4} className={styles.empty}>Loading postmen...</td></tr>
              )}
              {isError && (
                <tr>
                  <td colSpan={isSuperAdmin ? 5 : 4} className={styles.empty}>
                    The postmen could not be loaded. <button className={styles.btn} onClick={() => void refetch()}>Try Again</button>
                  </td>
                </tr>
              )}
              {!isLoading && !isError && visible.length === 0 && (
                <tr>
                  <td colSpan={isSuperAdmin ? 5 : 4} className={styles.empty}>
                    {people.length === 0 ? "No postmen yet. Add your first postman to get started." : "No postmen match your search."}
                  </td>
                </tr>
              )}
              {visible.map((p) => {
                const percent = p.today.total > 0 ? Math.round((p.today.completed / p.today.total) * 100) : 0;
                return (
                  <tr key={p.id} className={styles.row} tabIndex={0} onClick={() => open(p)} onKeyDown={(e) => onKey(e, p)} aria-label={`Open ${p.name}`}>
                    <td>
                      <div className={styles.person}>
                        <Avatar name={p.name} photoUrl={p.photoUrl} size={36} />
                        <div>
                          <div className={styles.personName}>{p.name}</div>
                          <div className={styles.personId}>{p.employeeId}</div>
                        </div>
                      </div>
                    </td>
                    <td>{p.beat ? `${p.beat.beatNumber} — ${p.beat.name}` : <span className={styles.muted}>Unassigned</span>}</td>
                    {isSuperAdmin && <td>{p.postOffice?.name ?? "—"}</td>}
                    <td>
                      {p.today.total > 0 ? (
                        <div className={styles.progress} title={`${p.today.completed} delivered of ${p.today.total} today`}>
                          <span>{p.today.completed} / {p.today.total}</span>
                          <span className={styles.bar}><span className={styles.barFill} style={{ width: `${percent}%`, display: "block" }} /></span>
                        </div>
                      ) : (
                        <span className={styles.muted}>None today</span>
                      )}
                    </td>
                    <td><StatusPill status={p.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

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
                // the message is already shown: onError above set it
              }
            }}
          />
        </Modal>
      )}
    </div>
  );
}

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { apiClient } from "../lib/apiClient";
import { Badge } from "../components/Badge";
import { Modal } from "../components/Modal";
import styles from "../styles/components.module.css";

interface ExceptionRow {
  id: string;
  deliveryId: string;
  reason: string;
  details: string | null;
  createdAt: string;
  delivery: {
    trackingId: string;
    recipient: { name: string; phone: string };
    address: { addressLine1: string; pincode: string; latitude: number | null; longitude: number | null };
  };
}

interface BeatOption {
  id: string;
  beatNumber: string;
  name: string;
}

interface PostmanOption {
  id: string;
  name: string;
  employeeId: string;
}

function CorrectAddressModal({ exception, onClose }: { exception: ExceptionRow; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [lat, setLat] = useState(exception.delivery.address.latitude?.toString() ?? "");
  const [lng, setLng] = useState(exception.delivery.address.longitude?.toString() ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const latitude = Number(lat);
    const longitude = Number(lng);
    if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
      setError("Enter valid numeric coordinates");
      return;
    }
    setSubmitting(true);
    try {
      // The addressId isn't on the exception payload — fetch the delivery once to get it.
      const delivery = await apiClient.get(`/deliveries/${exception.deliveryId}`).then((r) => r.data);
      await apiClient.post(`/geocoding/manual/${delivery.addressId}`, { latitude, longitude });
      queryClient.invalidateQueries({ queryKey: ["assignment-exceptions"] });
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.error?.message ?? "Failed to update coordinates");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`Correct Address — ${exception.delivery.trackingId}`} onClose={onClose}>
      <p style={{ fontSize: 13, marginBottom: 12 }}>{exception.delivery.address.addressLine1}, {exception.delivery.address.pincode}</p>
      <form onSubmit={handleSubmit}>
        <div className={styles.formGroup}>
          <label>Latitude</label>
          <input className={styles.input} value={lat} onChange={(e) => setLat(e.target.value)} placeholder="e.g. 19.1462" />
        </div>
        <div className={styles.formGroup}>
          <label>Longitude</label>
          <input className={styles.input} value={lng} onChange={(e) => setLng(e.target.value)} placeholder="e.g. 72.9339" />
        </div>
        {error && <p className={styles.errorText}>{error}</p>}
        <div className={styles.toolbar} style={{ justifyContent: "flex-end" }}>
          <button type="button" className={styles.button} onClick={onClose}>Cancel</button>
          <button type="submit" className={styles.buttonPrimary} disabled={submitting}>Save & Reassign</button>
        </div>
      </form>
    </Modal>
  );
}

function AssignManuallyModal({ exception, onClose }: { exception: ExceptionRow; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [beatId, setBeatId] = useState("");
  const [postmanId, setPostmanId] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: beats } = useQuery<BeatOption[]>({
    queryKey: ["beats"],
    queryFn: () => apiClient.get("/beats").then((r) => r.data)
  });
  const { data: postmen } = useQuery<PostmanOption[]>({
    queryKey: ["postmen-for-assignment"],
    queryFn: () => apiClient.get("/postmen").then((r) => r.data)
  });

  const resolveMutation = useMutation({
    mutationFn: () =>
      apiClient.post(`/assignments/exceptions/${exception.id}/resolve`, {
        beatId: beatId || undefined,
        postmanId: postmanId || undefined,
        reason: reason || "Manually assigned from Assignment Exceptions"
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assignment-exceptions"] });
      onClose();
    },
    onError: (err: any) => setError(err.response?.data?.error?.message ?? "Failed to assign")
  });

  return (
    <Modal title={`Assign Manually — ${exception.delivery.trackingId}`} onClose={onClose}>
      <div className={styles.formGroup}>
        <label>Beat</label>
        <select className={styles.input} value={beatId} onChange={(e) => setBeatId(e.target.value)}>
          <option value="">No change</option>
          {beats?.map((b) => <option key={b.id} value={b.id}>{b.beatNumber} — {b.name}</option>)}
        </select>
      </div>
      <div className={styles.formGroup}>
        <label>Postman</label>
        <select className={styles.input} value={postmanId} onChange={(e) => setPostmanId(e.target.value)}>
          <option value="">No change</option>
          {postmen?.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.employeeId})</option>)}
        </select>
      </div>
      <div className={styles.formGroup}>
        <label>Reason</label>
        <input className={styles.input} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this being assigned manually?" />
      </div>
      {error && <p className={styles.errorText}>{error}</p>}
      <div className={styles.toolbar} style={{ justifyContent: "flex-end" }}>
        <button type="button" className={styles.button} onClick={onClose}>Cancel</button>
        <button
          className={styles.buttonPrimary}
          disabled={resolveMutation.isPending || (!beatId && !postmanId)}
          onClick={() => resolveMutation.mutate()}
        >
          Assign
        </button>
      </div>
    </Modal>
  );
}

export function AssignmentExceptionsPage() {
  const queryClient = useQueryClient();
  const [correctingId, setCorrectingId] = useState<string | null>(null);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);

  const { data, isLoading } = useQuery<ExceptionRow[]>({
    queryKey: ["assignment-exceptions"],
    queryFn: () => apiClient.get("/assignments/exceptions").then((r) => r.data)
  });

  const ignoreMutation = useMutation({
    mutationFn: (id: string) => apiClient.post(`/assignments/exceptions/${id}/ignore`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["assignment-exceptions"] })
  });

  async function retryGeocoding(exception: ExceptionRow) {
    setRetryError(null);
    try {
      const delivery = await apiClient.get(`/deliveries/${exception.deliveryId}`).then((r) => r.data);
      await apiClient.post(`/geocoding/retry/${delivery.addressId}`);
      queryClient.invalidateQueries({ queryKey: ["assignment-exceptions"] });
    } catch (err: any) {
      setRetryError(err.response?.data?.error?.message ?? "Retry failed");
    }
  }

  if (isLoading || !data) return <p>Loading…</p>;

  const activeException = data.find((e) => e.id === correctingId || e.id === assigningId);

  return (
    <div>
      <p style={{ fontSize: 13, color: "var(--color-ink-500)", marginBottom: 12 }}>
        Deliveries that could not be auto-assigned to a beat/postman — geocoding failures, no beat covering the
        address, multiple overlapping beats, or no postman on the matched beat. Resolve, retry, or ignore each one.
      </p>
      {retryError && <p className={styles.errorText}>{retryError}</p>}

      <table className={styles.table}>
        <thead>
          <tr>
            <th>Tracking ID</th>
            <th>Recipient</th>
            <th>Address</th>
            <th>Reason</th>
            <th>Raised</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {data.length === 0 && (
            <tr><td colSpan={6}>No open exceptions. Everything auto-assigned cleanly.</td></tr>
          )}
          {data.map((exc) => (
            <tr key={exc.id}>
              <td><Link to={`/deliveries/${exc.deliveryId}`}>{exc.delivery.trackingId}</Link></td>
              <td>{exc.delivery.recipient.name}<br /><small>{exc.delivery.recipient.phone}</small></td>
              <td>{exc.delivery.address.addressLine1}<br /><small>{exc.delivery.address.pincode}</small></td>
              <td><Badge value={exc.reason} /></td>
              <td>{new Date(exc.createdAt).toLocaleString()}</td>
              <td>
                <div className={styles.toolbar} style={{ margin: 0 }}>
                  <button className={styles.button} onClick={() => retryGeocoding(exc)}>Retry Geocode</button>
                  <button className={styles.button} onClick={() => setCorrectingId(exc.id)}>Correct Address</button>
                  <button className={styles.button} onClick={() => setAssigningId(exc.id)}>Assign Manually</button>
                  <button className={styles.button} onClick={() => ignoreMutation.mutate(exc.id)}>Ignore</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {correctingId && activeException && (
        <CorrectAddressModal exception={activeException} onClose={() => setCorrectingId(null)} />
      )}
      {assigningId && activeException && (
        <AssignManuallyModal exception={activeException} onClose={() => setAssigningId(null)} />
      )}
    </div>
  );
}

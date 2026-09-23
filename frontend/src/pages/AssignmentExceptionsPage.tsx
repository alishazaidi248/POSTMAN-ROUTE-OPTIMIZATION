import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { apiClient } from "../lib/apiClient";
import { friendlyError } from "../lib/friendlyError";
import { useToast } from "../components/Toast";
import { Badge } from "../components/Badge";
import { Modal } from "../components/Modal";
import styles from "../styles/components.module.css";

interface RetryGeocodeAllSummary {
  processed: number;
  succeeded: number;
  failed: number;
  resolved: number;
  stillUnresolved: number;
}

interface ExceptionRow {
  id: string;
  deliveryId: string;
  reason: string;
  details: string | null;
  createdAt: string;
  suggestedBeat: { id: string; beatNumber: string; name: string } | null;
  confidence: number | null;
  confidenceLevel: "High" | "Medium" | "Low" | "Ambiguous" | null;
  locationQuality: string | null;
  locationQualityLabel: string | null;
  evidence: { evidence?: string[]; contenders?: string[] } | null;
  delivery: {
    trackingId: string;
    recipient: { name: string; phone: string };
    address: { addressLine1: string; addressLine2: string | null; area: string | null; city: string; pincode: string; latitude: number | null; longitude: number | null };
  };
}

/** "B20 — Farid Nagar": the beat number and the descriptive part of its name (never "Beat 20 — Beat 20"). */
function beatLabel(b: { beatNumber: string; name: string }) {
  const rest = b.name.replace(/^\s*beat\s*[-#]?\s*\d+\s*[-:–—]?\s*/i, "").trim();
  return rest ? `B${b.beatNumber} — ${rest}` : `B${b.beatNumber}`;
}

/** Address lines without repeating a part another line already contains. */
function addressLines(a: ExceptionRow["delivery"]["address"]): string[] {
  const out: string[] = [];
  for (const part of [a.addressLine1, a.addressLine2, a.area, a.city]) {
    const t = part?.trim();
    if (t && !out.some((o) => o.toLowerCase().includes(t.toLowerCase()))) out.push(t);
  }
  return out;
}

interface BeatOption {
  id: string;
  beatNumber: string;
  name: string;
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
    <Modal title={`Correct Location — ${exception.delivery.trackingId}`} onClose={onClose}>
      <p style={{ fontSize: 13, marginBottom: 12 }}>{addressLines(exception.delivery.address).join(", ")} — {exception.delivery.address.pincode}</p>
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

function ChooseBeatModal({ exception, onClose }: { exception: ExceptionRow; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [beatId, setBeatId] = useState(exception.suggestedBeat?.id ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: beats } = useQuery<BeatOption[]>({
    queryKey: ["beats"],
    queryFn: () => apiClient.get("/beats").then((r) => r.data)
  });

  const resolveMutation = useMutation({
    mutationFn: () =>
      apiClient.post(`/assignments/exceptions/${exception.id}/resolve`, {
        beatId,
        reason: reason || "Beat chosen from Assignment Exceptions"
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assignment-exceptions"] });
      onClose();
    },
    onError: (err: any) => setError(err.response?.data?.error?.message ?? "Failed to assign")
  });

  return (
    <Modal title={`Choose Beat — ${exception.delivery.trackingId}`} onClose={onClose}>
      <p style={{ fontSize: 13, marginBottom: 12 }}>{addressLines(exception.delivery.address).join(", ")}</p>
      <div className={styles.formGroup}>
        <label>Beat</label>
        <select className={styles.input} value={beatId} onChange={(e) => setBeatId(e.target.value)}>
          <option value="">Select a beat…</option>
          {beats?.map((b) => <option key={b.id} value={b.id}>{beatLabel(b)}</option>)}
        </select>
        <small>The delivery goes to the postman who covers this beat.</small>
      </div>
      <div className={styles.formGroup}>
        <label>Reason (optional)</label>
        <input className={styles.input} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this beat?" />
      </div>
      {error && <p className={styles.errorText}>{error}</p>}
      <div className={styles.toolbar} style={{ justifyContent: "flex-end" }}>
        <button type="button" className={styles.button} onClick={onClose}>Cancel</button>
        <button className={styles.buttonPrimary} disabled={resolveMutation.isPending || !beatId} onClick={() => resolveMutation.mutate()}>
          Assign
        </button>
      </div>
    </Modal>
  );
}

export function AssignmentExceptionsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [correctingId, setCorrectingId] = useState<string | null>(null);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [retryAllBusy, setRetryAllBusy] = useState(false);
  const [retryAllSummary, setRetryAllSummary] = useState<RetryGeocodeAllSummary | null>(null);

  const { data, isLoading } = useQuery<ExceptionRow[]>({
    queryKey: ["assignment-exceptions"],
    queryFn: () => apiClient.get("/assignments/exceptions").then((r) => r.data)
  });

  const ignoreMutation = useMutation({
    mutationFn: (id: string) => apiClient.post(`/assignments/exceptions/${id}/ignore`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["assignment-exceptions"] })
  });

  const acceptMutation = useMutation({
    mutationFn: (exc: ExceptionRow) =>
      apiClient.post(`/assignments/exceptions/${exc.id}/resolve`, {
        beatId: exc.suggestedBeat!.id,
        reason: `Suggested beat accepted (${exc.confidence ?? "?"}% confidence)`
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["assignment-exceptions"] }),
    onError: (err: unknown) => toast.error(friendlyError(err, "Failed to assign"))
  });

  async function retryGeocoding(exception: ExceptionRow) {
    setRetryingId(exception.id);
    try {
      const delivery = await apiClient.get(`/deliveries/${exception.deliveryId}`).then((r) => r.data);
      await apiClient.post(`/geocoding/retry/${delivery.addressId}`);
      queryClient.invalidateQueries({ queryKey: ["assignment-exceptions"] });
    } catch (err) {
      toast.error(friendlyError(err, "Retry failed"));
    } finally {
      setRetryingId(null);
    }
  }

  async function retryAllGeocoding() {
    setRetryAllBusy(true);
    setRetryAllSummary(null);
    try {
      const res = await apiClient.post<RetryGeocodeAllSummary>("/assignments/exceptions/retry-geocode-all");
      setRetryAllSummary(res.data);
      const { processed, resolved, stillUnresolved } = res.data;
      toast.success(
        processed === 0
          ? "No exceptions needed a geocoding retry."
          : `Retried ${processed} exception${processed === 1 ? "" : "s"}: ${resolved} resolved, ${stillUnresolved} still need review.`
      );
      queryClient.invalidateQueries({ queryKey: ["assignment-exceptions"] });
    } catch (err) {
      toast.error(friendlyError(err, "Retry Geocode All failed"));
    } finally {
      setRetryAllBusy(false);
    }
  }

  if (isLoading || !data) return <p>Loading…</p>;

  const activeException = data.find((e) => e.id === correctingId || e.id === assigningId);

  return (
    <div>
      <p style={{ fontSize: 13, color: "var(--color-ink-500)", marginBottom: 12 }}>
        Deliveries the system would not assign on its own: the address does not identify one beat clearly enough, the
        location is too imprecise to decide, or the beat has no postman. <b>Assign</b> accepts the suggested beat,
        <b>Choose Beat</b> picks another, <b>Ignore</b> dismisses the item.
      </p>
      <div className={styles.toolbar} style={{ marginBottom: 12 }}>
        <button className={styles.button} disabled={retryAllBusy || data.length === 0} onClick={retryAllGeocoding}>
          {retryAllBusy ? "Retrying All…" : "Retry Geocode All"}
        </button>
      </div>
      {retryAllSummary && (
        <p style={{ fontSize: 13, color: "var(--color-ink-500)", marginBottom: 12 }} data-testid="retry-all-summary">
          Processed {retryAllSummary.processed}: {retryAllSummary.succeeded} succeeded, {retryAllSummary.failed} failed
          ({retryAllSummary.resolved} newly assigned, {retryAllSummary.stillUnresolved} still need review).
        </p>
      )}

      <table className={styles.table}>
        <thead>
          <tr>
            <th>Delivery</th>
            <th>Recipient</th>
            <th>Address</th>
            <th>Suggested beat</th>
            <th>Confidence</th>
            <th>Reason</th>
            <th>Location quality</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {data.length === 0 && (
            <tr><td colSpan={8}>No open exceptions. Everything was assigned with enough confidence.</td></tr>
          )}
          {data.map((exc) => {
            const contenders = exc.evidence?.contenders;
            return (
              <tr key={exc.id}>
                <td><Link to={`/deliveries/${exc.deliveryId}`}>{exc.delivery.trackingId}</Link><br /><small>{new Date(exc.createdAt).toLocaleString()}</small></td>
                <td>{exc.delivery.recipient.name}<br /><small>{exc.delivery.recipient.phone}</small></td>
                <td>
                  {addressLines(exc.delivery.address).map((line) => <div key={line}>{line}</div>)}
                  <small>{exc.delivery.address.pincode}</small>
                </td>
                <td>
                  {exc.suggestedBeat ? beatLabel(exc.suggestedBeat) : "—"}
                  {contenders && contenders.length > 1 && <><br /><small>Also fits beats {contenders.join(", ")}</small></>}
                </td>
                <td>
                  {exc.confidence != null && exc.confidenceLevel ? <>{exc.confidence}% — <Badge value={exc.confidenceLevel} /></> : "—"}
                </td>
                <td>
                  <Badge value={exc.reason} />
                  {exc.details && <div style={{ fontSize: 12, marginTop: 4 }}>{exc.details}</div>}
                  {exc.evidence?.evidence && exc.evidence.evidence.length > 0 && (
                    <details style={{ fontSize: 12 }}>
                      <summary>Evidence</summary>
                      <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>{exc.evidence.evidence.map((line) => <li key={line}>{line}</li>)}</ul>
                    </details>
                  )}
                </td>
                <td>{exc.locationQualityLabel ?? "—"}</td>
                <td>
                  <div className={styles.toolbar} style={{ margin: 0, flexWrap: "wrap" }}>
                    {exc.suggestedBeat && exc.reason !== "NO_POSTMAN_ASSIGNED" && (
                      <button className={styles.buttonPrimary} disabled={acceptMutation.isPending} onClick={() => acceptMutation.mutate(exc)}>Assign</button>
                    )}
                    <button className={styles.button} onClick={() => setAssigningId(exc.id)}>Choose Beat</button>
                    <button className={styles.button} onClick={() => ignoreMutation.mutate(exc.id)}>Ignore</button>
                    {exc.reason !== "NO_POSTMAN_ASSIGNED" && (
                      <>
                        <button className={styles.button} disabled={retryingId === exc.id} onClick={() => retryGeocoding(exc)}>
                          {retryingId === exc.id ? "Retrying…" : "Retry Geocode"}
                        </button>
                        <button className={styles.button} onClick={() => setCorrectingId(exc.id)}>Correct Location</button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {correctingId && activeException && (
        <CorrectAddressModal exception={activeException} onClose={() => setCorrectingId(null)} />
      )}
      {assigningId && activeException && (
        <ChooseBeatModal exception={activeException} onClose={() => setAssigningId(null)} />
      )}
    </div>
  );
}

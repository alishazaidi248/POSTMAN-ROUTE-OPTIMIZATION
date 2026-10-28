import { FormEvent, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiClient } from "../../lib/apiClient";
import { friendlyError, overlapConflict } from "../../lib/friendlyError";
import { useAuth } from "../../lib/auth";
import { Modal } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { TerritoryPreview } from "./TerritoryPreview";
import { VerificationBadge } from "./StatusBadge";
import { BeatRecord } from "./beatTypes";
import styles from "./beats.module.css";

interface PostmanOption {
  id: string;
  name: string;
  employeeId: string;
  postOffice?: { id: string };
}

/** Confirm that a beat's territory is right. The state is saved by the server, with who and when. */
export function VerifyBeatDialog({ beat, onClose, onDone }: { beat: BeatRecord; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [acknowledged, setAcknowledged] = useState(false);
  const verify = useMutation({
    mutationFn: () => apiClient.post(`/beats/${beat.id}/verify`, { acknowledgeOverlap: acknowledged }).then((r) => r.data as { overlaps?: { beatNumber: string }[] }),
    onSuccess: (data) => {
      toast.success(`Beat ${beat.beatNumber} verified successfully.`);
      if (data.overlaps && data.overlaps.length > 0) {
        toast.info(`This territory overlaps beat ${data.overlaps.map((o) => o.beatNumber).join(", ")}. Parcels inside the overlap will need to be assigned by hand.`);
      }
      onDone();
    }
  });
  const overlap = verify.isError ? overlapConflict(verify.error) : null;

  return (
    <Modal title="Verify beat" onClose={onClose} width={460}>
      <div className={styles.summaryGrid}>
        <div><span>Beat number</span>{beat.beatNumber}</div>
        <div><span>Beat name</span>{beat.name}</div>
        <div><span>Post office</span>{beat.postOfficeName}</div>
        <div><span>Now</span><VerificationBadge value={beat.verificationStatus} /></div>
      </div>
      <TerritoryPreview polygon={beat.boundary} status={beat.verificationStatus} />
      <p style={{ fontSize: 13, color: "var(--color-ink-500)", margin: "10px 0 0" }}>
        Look at the highlighted territory on the map. If the outline covers the right streets, verify the beat. If not, choose &ldquo;Edit Territory&rdquo; first.
      </p>
      {verify.isError && !overlap && <p className={styles.errorText}>{friendlyError(verify.error, "The beat could not be verified.")}</p>}
      {overlap && (
        <p className={styles.errorText} role="alert" data-testid="overlap-confirm">
          {overlap}
          <label style={{ display: "block", marginTop: 6 }}>
            <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} /> The overlap is intended. Verify anyway.
          </label>
        </p>
      )}
      <div className={styles.actions}>
        <button className={styles.btn} onClick={onClose}>Cancel</button>
        <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => verify.mutate()} disabled={verify.isPending || (!!overlap && !acknowledged)}>
          {verify.isError ? "Try Again" : verify.isPending ? "Verifying..." : "Verify Beat"}
        </button>
      </div>
    </Modal>
  );
}

/**
 * Who covers a beat. More than one postman can cover the same beat at once - its deliveries then split
 * between them (by geography, roughly evenly) - so this adds and removes postmen individually rather than
 * replacing a single choice.
 */
export function AssignPostmanDialog({ beat, onClose, onDone }: { beat: BeatRecord; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [postmanId, setPostmanId] = useState("");
  const postmen = useQuery<PostmanOption[]>({ queryKey: ["postmen-for-assignment"], queryFn: () => apiClient.get("/postmen").then((r) => r.data) });
  const assignedIds = new Set(beat.assignedPostmen.map((p) => p.id));
  const options = (postmen.data ?? []).filter((p) => (!p.postOffice || p.postOffice.id === beat.postOfficeId) && !assignedIds.has(p.id));

  const add = useMutation({
    mutationFn: (id: string) => apiClient.post(`/beats/${beat.id}/assign-postman`, { postmanId: id }),
    onSuccess: () => {
      toast.success("Postman added to this beat.");
      setPostmanId("");
      onDone();
    }
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiClient.post(`/postmen/${id}/assign-beat`, { beatId: null }),
    onSuccess: () => {
      toast.success("Postman removed from this beat.");
      onDone();
    }
  });

  return (
    <Modal title={`Postmen for beat ${beat.beatNumber}`} onClose={onClose} width={440}>
      {beat.assignedPostmen.length > 0 ? (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {beat.assignedPostmen.map((p) => (
            <li key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0" }}>
              <span>{p.name} ({p.employeeId})</span>
              <button className={`${styles.btn} ${styles.btnSmall}`} onClick={() => remove.mutate(p.id)} disabled={remove.isPending}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p style={{ fontSize: 13, color: "var(--color-ink-500)", margin: 0 }}>Not assigned.</p>
      )}

      <div className={styles.field} style={{ marginTop: 12 }}>
        <label htmlFor="assign-postman">Add a postman</label>
        <select id="assign-postman" className={styles.input} value={postmanId} onChange={(e) => setPostmanId(e.target.value)}>
          <option value="">Choose a postman</option>
          {options.map((p) => (
            <option key={p.id} value={p.id}>{p.name} ({p.employeeId})</option>
          ))}
        </select>
      </div>
      <p style={{ fontSize: 13, color: "var(--color-ink-500)", margin: 0 }}>
        Adding a second (or third) postman splits the beat&rsquo;s parcels between everyone covering it, by
        geography, roughly evenly; removing one hands their share to whoever is left.
      </p>
      {(add.isError || remove.isError) && (
        <p className={styles.errorText}>{friendlyError(add.error ?? remove.error, "That could not be saved.")}</p>
      )}
      <div className={styles.actions}>
        <button className={styles.btn} onClick={onClose}>Close</button>
        <button
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={() => postmanId && add.mutate(postmanId)}
          disabled={!postmanId || add.isPending}
        >
          {add.isPending ? "Adding..." : "Add"}
        </button>
      </div>
    </Modal>
  );
}

/** Change a beat's number or name. */
export function EditBeatDialog({ beat, onClose, onDone }: { beat: BeatRecord; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [beatNumber, setBeatNumber] = useState(beat.beatNumber);
  const [name, setName] = useState(beat.name);

  const save = useMutation({
    mutationFn: () => apiClient.put(`/beats/${beat.id}`, { beatNumber: beatNumber.trim(), name: name.trim() }),
    onSuccess: () => {
      toast.success(`Beat ${beatNumber.trim()} updated successfully.`);
      onDone();
    }
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (beatNumber.trim() && name.trim()) save.mutate();
  };

  return (
    <Modal title="Edit beat" onClose={onClose} width={420}>
      <form onSubmit={submit}>
        <div className={styles.field}>
          <label htmlFor="edit-beat-number">Beat number</label>
          <input id="edit-beat-number" className={styles.input} value={beatNumber} onChange={(e) => setBeatNumber(e.target.value)} />
        </div>
        <div className={styles.field}>
          <label htmlFor="edit-beat-name">Beat name</label>
          <input id="edit-beat-name" className={styles.input} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        {save.isError && <p className={styles.errorText}>{friendlyError(save.error, "The beat could not be saved.")}</p>}
        <div className={styles.actions}>
          <button type="button" className={styles.btn} onClick={onClose}>Cancel</button>
          <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={save.isPending || !beatNumber.trim() || !name.trim()}>
            {save.isError ? "Try Again" : save.isPending ? "Saving..." : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Name a freshly drawn territory and save it as a new beat. */
export function NewBeatDialog({ polygon, onClose, onDone }: { polygon: GeoJSON.Polygon; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { user } = useAuth();
  const [beatNumber, setBeatNumber] = useState("");
  const [name, setName] = useState("");
  const [postmanId, setPostmanId] = useState("");
  const [officeId, setOfficeId] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);

  const postmen = useQuery<PostmanOption[]>({ queryKey: ["postmen-for-assignment"], queryFn: () => apiClient.get("/postmen").then((r) => r.data) });
  const offices = useQuery<{ id: string; name: string }[]>({
    queryKey: ["post-offices"],
    queryFn: () => apiClient.get("/post-offices").then((r) => r.data),
    enabled: !user?.postOfficeId
  });
  const targetOffice = user?.postOfficeId ?? officeId;

  const create = useMutation({
    mutationFn: () =>
      apiClient.post("/beats", {
        postOfficeId: targetOffice || undefined,
        beatNumber: beatNumber.trim(),
        name: name.trim(),
        boundary: polygon,
        postmanId: postmanId || null,
        acknowledgeOverlap: acknowledged || undefined
      }),
    onSuccess: () => {
      toast.success(`Beat ${beatNumber.trim()} added successfully.`);
      onDone();
    }
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (beatNumber.trim() && name.trim() && targetOffice) create.mutate();
  };

  return (
    <Modal title="New beat" onClose={onClose} width={440}>
      <form onSubmit={submit}>
        <TerritoryPreview polygon={polygon} status="VERIFIED" />
        <div style={{ height: 12 }} />
        {!user?.postOfficeId && (
          <div className={styles.field}>
            <label htmlFor="new-beat-office">Post office</label>
            <select id="new-beat-office" className={styles.input} value={officeId} onChange={(e) => setOfficeId(e.target.value)}>
              <option value="">Choose a post office</option>
              {offices.data?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
        )}
        <div className={styles.field}>
          <label htmlFor="new-beat-number">Beat number</label>
          <input id="new-beat-number" className={styles.input} value={beatNumber} onChange={(e) => setBeatNumber(e.target.value)} placeholder="e.g. B03" />
        </div>
        <div className={styles.field}>
          <label htmlFor="new-beat-name">Beat name</label>
          <input id="new-beat-name" className={styles.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sector 3" />
        </div>
        <div className={styles.field}>
          <label htmlFor="new-beat-postman">Assign postman (optional)</label>
          <select id="new-beat-postman" className={styles.input} value={postmanId} onChange={(e) => setPostmanId(e.target.value)}>
            <option value="">Leave unassigned</option>
            {postmen.data?.filter((p) => !targetOffice || !p.postOffice || p.postOffice.id === targetOffice).map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({p.employeeId})</option>
            ))}
          </select>
        </div>
        {create.isError && overlapConflict(create.error) && (
          <p className={styles.errorText} role="alert" data-testid="overlap-confirm">
            {overlapConflict(create.error)}
            <label style={{ display: "block", marginTop: 6 }}>
              <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} /> The overlap is intended. Save anyway.
            </label>
          </p>
        )}
        {create.isError && !overlapConflict(create.error) && (
          <p className={styles.errorText}>{friendlyError(create.error, "The territory could not be saved.")}</p>
        )}
        <div className={styles.actions}>
          <button type="button" className={styles.btn} onClick={onClose}>Cancel</button>
          <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={create.isPending || !beatNumber.trim() || !name.trim() || !targetOffice || (create.isError && !!overlapConflict(create.error) && !acknowledged)}>
            {create.isError ? "Try Again" : create.isPending ? "Saving..." : "Save beat"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

import { DragEvent, ReactNode, useRef, useState } from "react";
import { apiClient } from "../../lib/apiClient";
import { friendlyError } from "../../lib/friendlyError";
import { Modal } from "../../components/Modal";
import { Icon } from "../../components/icons";
import { useToast } from "../../components/Toast";
import styles from "./beats.module.css";

type RowStatus = "READY" | "WARNING" | "ERROR";

interface CheckedRow {
  rowNumber: number;
  beatNumber: string;
  name: string;
  locality: string;
  mainArea: string;
  postOfficeName: string;
  territoryState: "PRESENT" | "MISSING" | "INVALID";
  status: RowStatus;
  action: "NEW_BEAT" | "ADD_LOCALITY" | "SKIPPED";
  messages: string[];
}

interface Preview {
  id: string;
  fileName: string;
  fileSize: number;
  destinationPostOffice: string;
  columns: string[];
  mapping: Record<string, string | null>;
  fields: { key: string; label: string; required: boolean }[];
  rows: CheckedRow[];
  fileProblems: string[];
  summary: {
    totalRows: number;
    importable: number;
    ready: number;
    warnings: number;
    errors: number;
    duplicates: number;
    missingTerritory: number;
    invalidTerritory: number;
    structured: boolean;
    newBeats: number;
    existingBeats: number;
    localityRecords: number;
    duplicateLocalityRows: number;
    unknownPostOffices: number;
    missingBeatNumbers: number;
    beatsWithoutLocality: number;
  };
}

const STEPS = ["Upload", "Validate", "Review", "Import"];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const size = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

/**
 * Upload -> Validate -> Review -> Import. The uploaded list is held by the server (nothing is
 * imported) until the last step; every check here is the server's, so what is shown is exactly
 * what will be imported.
 */
export function UploadBeatListWizard({ onClose, onImported }: { onClose: () => void; onImported: (importedIds: string[]) => void }) {
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [reviewFilter, setReviewFilter] = useState<"ALL" | "ATTENTION" | "ERRORS">("ALL");
  const [done, setDone] = useState<{ imported: number; skipped: number; ids: string[]; localityRecords: number; rematch: { checked: number; changed: number } } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setError(null);
    setPreview(null);
    if (!/\.(xlsx|csv)$/i.test(file.name)) {
      setError("Please choose an Excel (.xlsx) or CSV (.csv) beat list.");
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await apiClient.post<Preview>("/beats/import", form);
      setPreview(res.data);
    } catch (err) {
      setError(friendlyError(err, "This file could not be read."));
    } finally {
      setBusy(false);
    }
  }

  async function changeMapping(field: string, column: string) {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiClient.put<Preview>(`/beats/import/${preview.id}/mapping`, { mapping: { ...preview.mapping, [field]: column || null } });
      setPreview(res.data);
    } catch (err) {
      setError(friendlyError(err, "The column could not be changed."));
    } finally {
      setBusy(false);
    }
  }

  async function downloadErrors() {
    if (!preview) return;
    try {
      const res = await apiClient.get(`/beats/import/${preview.id}/errors.csv`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "beat-list-problems.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(friendlyError(err, "The error report could not be downloaded."));
    }
  }

  async function runImport() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiClient.post<{ imported: number; skipped: number; beatIds: string[]; localityRecords: number; rematch: { checked: number; changed: number } }>(`/beats/import/${preview.id}/confirm`);
      setDone({ imported: res.data.imported, skipped: res.data.skipped, ids: res.data.beatIds, localityRecords: res.data.localityRecords, rematch: res.data.rematch });
      toast.success(`${plural(res.data.imported, "beat")} imported successfully.`);
      onImported(res.data.beatIds);
    } catch (err) {
      setError(friendlyError(err, "The beats could not be imported."));
    } finally {
      setBusy(false);
    }
  }

  async function close() {
    // A list that was uploaded but never imported is cancelled, so it does not linger.
    if (preview && !done) await apiClient.post(`/beats/import/${preview.id}/cancel`).catch(() => undefined);
    onClose();
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void upload(file);
  };

  const s = preview?.summary;
  const beatNumberColumn = preview?.mapping.beatNumber;
  const officeColumn = preview?.mapping.postOffice;
  const canContinue = !!preview && preview.fileProblems.length === 0 && (s?.importable ?? 0) > 0;

  return (
    <Modal title="Upload beat list" onClose={close} width={760}>
      <ol className={styles.steps} style={{ listStyle: "none", padding: 0, margin: "0 0 16px" }}>
        {STEPS.map((label, i) => (
          <li key={label} className={`${styles.step} ${i === step ? styles.stepActive : ""} ${i < step || done ? styles.stepDone : ""}`}>
            <span className={styles.stepNum}>{i < step || done ? "✓" : i + 1}</span>
            {label}
          </li>
        ))}
      </ol>

      {/* ── 1. upload ── */}
      {step === 0 && (
        <>
          <div
            className={`${styles.drop} ${dragging ? styles.dropActive : ""}`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <span className={styles.dropIcon}><Icon name="upload" size={30} /></span>
            <div><strong>Drop your Beat List here</strong></div>
            <div className={styles.muted} style={{ margin: "4px 0 10px" }}>or</div>
            <button className={styles.btn} onClick={() => fileInput.current?.click()} disabled={busy}>Choose File</button>
            <input
              ref={fileInput}
              type="file"
              accept=".xlsx,.csv"
              hidden
              data-testid="beat-file-input"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
                e.target.value = "";
              }}
            />
            <div className={styles.muted} style={{ marginTop: 10 }}>Excel (.xlsx) or CSV (.csv)</div>
          </div>

          {busy && <p className={styles.muted} style={{ marginTop: 12 }}>Reading the file...</p>}
          {preview && !busy && (
            <div className={styles.fileInfo}>
              <Icon name="file" size={22} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong data-testid="file-name">{preview.fileName}</strong>
                <div className={styles.muted}>{size(preview.fileSize)} · {plural(preview.summary.totalRows, "row")} found</div>
              </div>
            </div>
          )}
          {error && (
            <p className={styles.errorText} role="alert">
              {error} <button className={`${styles.btn} ${styles.btnSmall}`} onClick={() => fileInput.current?.click()}>Try Again</button>
            </p>
          )}
          <div className={styles.actions}>
            <button className={styles.btn} onClick={close}>Cancel</button>
            <button className={`${styles.btn} ${styles.btnPrimary}`} disabled={!preview || busy} onClick={() => setStep(1)}>Continue</button>
          </div>
        </>
      )}

      {/* ── 2. validate ── */}
      {step === 1 && preview && s && (
        <>
          <h3 style={{ margin: "0 0 10px", fontSize: 15 }}>Beat list validation</h3>
          <ul className={styles.checks} data-testid="validation-checks">
            <Check ok={s.totalRows > 0}>{plural(s.totalRows, "row")} found</Check>
            <Check ok={!!beatNumberColumn}>{beatNumberColumn ? `Beat numbers detected (column “${beatNumberColumn}”)` : "No column for the beat number was found. Choose it below."}</Check>
            <Check ok={!!officeColumn} warn={!officeColumn}>
              {officeColumn ? `Post office detected (column “${officeColumn}”)` : `No post office column: every beat will be added to ${preview.destinationPostOffice}`}
            </Check>
            <Check ok={!!beatNumberColumn}>{beatNumberColumn ? "Required fields present" : "A required field is missing"}</Check>
            <Check ok={s.ready + s.warnings > 0}>
              {s.structured
                ? `${plural(s.newBeats, "new beat")}${s.existingBeats ? ` and ${plural(s.existingBeats, "existing beat")}` : ""} with ${plural(s.localityRecords, "locality record")} can be imported`
                : `${plural(s.importable, "beat")} can be imported`}{" "}
              ({s.ready} ready{s.warnings ? `, ${s.warnings} with a warning` : ""})
            </Check>
            {s.structured && s.beatsWithoutLocality > 0 && <Check warn>{plural(s.beatsWithoutLocality, "beat")} {s.beatsWithoutLocality === 1 ? "has" : "have"} no locality, so addresses cannot be matched to {s.beatsWithoutLocality === 1 ? "it" : "them"} by name</Check>}
            {s.duplicateLocalityRows > 0 && <Check warn>{plural(s.duplicateLocalityRows, "row")} repeat{s.duplicateLocalityRows === 1 ? "s" : ""} a locality already listed for the beat (reported, nothing added)</Check>}
            {s.missingBeatNumbers > 0 && <Check bad>{plural(s.missingBeatNumbers, "row")} {s.missingBeatNumbers === 1 ? "has" : "have"} no beat number and will not be imported</Check>}
            {s.unknownPostOffices > 0 && <Check bad>{plural(s.unknownPostOffices, "row")} name{s.unknownPostOffices === 1 ? "s" : ""} a post office that is not in the system</Check>}
            {s.duplicates > 0 && <Check warn>{plural(s.duplicates, "beat")} {s.duplicates === 1 ? "has" : "have"} a duplicate number and will not be imported</Check>}
            {s.missingTerritory > 0 && <Check warn>{plural(s.missingTerritory, "beat")} {s.missingTerritory === 1 ? "is" : "are"} missing a territory boundary (you can draw {s.missingTerritory === 1 ? "it" : "them"} later)</Check>}
            {s.invalidTerritory > 0 && <Check bad>{plural(s.invalidTerritory, "row")} ha{s.invalidTerritory === 1 ? "s" : "ve"} a territory that could not be read</Check>}
            {s.errors - s.duplicates - s.invalidTerritory - s.missingBeatNumbers - s.unknownPostOffices > 0 && <Check bad>{plural(s.errors - s.duplicates - s.invalidTerritory - s.missingBeatNumbers - s.unknownPostOffices, "row")} cannot be imported (see Review)</Check>}
            {preview.fileProblems.map((p) => <Check key={p} bad>{p}</Check>)}
          </ul>

          <details className={styles.mapping} open={!beatNumberColumn}>
            <summary>Columns in your file</summary>
            <div className={styles.mappingGrid}>
              {preview.fields.map((f) => (
                <FieldRow key={f.key} label={`${f.label}${f.required ? " *" : ""}`}>
                  <select
                    className={styles.input}
                    aria-label={f.label}
                    value={preview.mapping[f.key] ?? ""}
                    disabled={busy}
                    onChange={(e) => void changeMapping(f.key, e.target.value)}
                  >
                    <option value="">{f.required ? "Choose a column" : "Not in my file"}</option>
                    {preview.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </FieldRow>
              ))}
            </div>
          </details>

          {error && <p className={styles.errorText} role="alert">{error}</p>}
          <div className={styles.actions}>
            {s.errors + s.warnings > 0 && (
              <button className={styles.btn} onClick={downloadErrors} style={{ marginRight: "auto" }}>
                <Icon name="download" size={15} /> Download Error Report
              </button>
            )}
            <button className={styles.btn} onClick={close}>Cancel</button>
            <button className={styles.btn} onClick={() => setStep(0)}>Back</button>
            <button className={`${styles.btn} ${styles.btnPrimary}`} disabled={!canContinue || busy} onClick={() => setStep(2)}>Continue</button>
          </div>
        </>
      )}

      {/* ── 3. review ── */}
      {step === 2 && preview && s && (
        <>
          <div className={styles.reviewFilters}>
            {([["ALL", `All (${s.totalRows})`], ["ATTENTION", `Needs attention (${s.warnings + s.errors})`], ["ERRORS", `Will not be imported (${s.errors})`]] as const).map(([key, label]) => (
              <button key={key} className={`${styles.chip} ${reviewFilter === key ? styles.chipActive : ""}`} onClick={() => setReviewFilter(key)}>{label}</button>
            ))}
          </div>
          <div className={styles.reviewScroll}>
            <table className={styles.beatTable} data-testid="review-table">
              <thead>
                <tr><th>Row</th><th>Beat</th><th>{s.structured ? "Locality" : "Name"}</th>{s.structured && <th>Main area</th>}<th>Post office</th><th>Result</th>{!s.structured && <th>Territory</th>}<th>Notes</th></tr>
              </thead>
              <tbody>
                {preview.rows
                  .filter((r) => reviewFilter === "ALL" || (reviewFilter === "ATTENTION" ? r.status !== "READY" : r.status === "ERROR"))
                  .map((r) => (
                    <tr key={r.rowNumber} className={r.status === "ERROR" ? styles.rowError : r.status === "WARNING" ? styles.rowWarn : undefined}>
                      <td>{r.rowNumber}</td>
                      <td><strong>{r.beatNumber || "—"}</strong></td>
                      <td>{(s.structured ? r.locality : r.name) || "—"}</td>
                      {s.structured && <td>{r.mainArea || "—"}</td>}
                      <td>{r.postOfficeName || "—"}</td>
                      <td>{r.status === "ERROR" ? "Will not import" : r.action === "SKIPPED" ? "Skipped" : r.status === "WARNING" ? "Warning" : "Ready"}</td>
                      {!s.structured && <td>{r.territoryState === "PRESENT" ? "Provided" : r.territoryState === "MISSING" ? "Missing" : "Not readable"}</td>}
                      <td className={styles.rowNote}>{r.messages.join(" ")}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <div className={styles.actions}>
            {s.errors + s.warnings > 0 && (
              <button className={styles.btn} onClick={downloadErrors} style={{ marginRight: "auto" }}>
                <Icon name="download" size={15} /> Download Error Report
              </button>
            )}
            <button className={styles.btn} onClick={close}>Cancel</button>
            <button className={styles.btn} onClick={() => setStep(1)}>Back</button>
            <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => setStep(3)} disabled={!canContinue}>Continue</button>
          </div>
        </>
      )}

      {/* ── 4. import ── */}
      {step === 3 && preview && s && !done && (
        <>
          <p style={{ fontSize: 16, margin: "0 0 4px" }}>You are about to add</p>
          <div className={styles.bigNumber} data-testid="import-count">{plural(s.structured ? s.newBeats : s.importable, "beat")}</div>
          <p className={styles.muted} style={{ fontSize: 13 }}>to {preview.destinationPostOffice}{s.structured ? `, with ${plural(s.localityRecords, "locality record")} for matching addresses to beats` : ""}.</p>
          <ul style={{ fontSize: 13, color: "var(--color-ink-700)", paddingLeft: 18 }}>
            {s.existingBeats > 0 && <li>{plural(s.existingBeats, "beat")} already exist{s.existingBeats === 1 ? "s" : ""} and only receive their new localities.</li>}
            {s.duplicateLocalityRows > 0 && <li>{plural(s.duplicateLocalityRows, "repeated row")} add nothing (they are listed in the error report).</li>}
            <li>Beats with a territory will be marked <strong>Pending verification</strong>. You verify each one on the map.</li>
            {s.missingTerritory > 0 && <li>{plural(s.missingTerritory, "beat")} without a territory will be marked <strong>Needs review</strong> until you draw it.</li>}
            {s.errors > 0 && <li>{plural(s.errors, "row")} with problems will <strong>not</strong> be imported.</li>}
          </ul>
          {error && <p className={styles.errorText} role="alert">{error}</p>}
          <div className={styles.actions}>
            <button className={styles.btn} onClick={close}>Cancel</button>
            <button className={styles.btn} onClick={() => setStep(2)}>Back</button>
            <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={runImport} disabled={busy}>
              {error ? "Try Again" : busy ? "Importing..." : "Import Beats"}
            </button>
          </div>
        </>
      )}

      {step === 3 && done && (
        <>
          <p style={{ fontSize: 16, margin: "0 0 4px" }} data-testid="import-done">{plural(done.imported, "beat")} imported successfully.</p>
          <p className={styles.muted} style={{ fontSize: 13 }}>
            {done.localityRecords > 0 ? `${plural(done.localityRecords, "locality record")} added to the beat directory. ` : ""}
            {done.rematch.checked > 0 ? `${done.rematch.changed} of ${done.rematch.checked} waiting deliveries were matched to a beat. ` : ""}
            {done.skipped > 0 ? `${plural(done.skipped, "row")} could not be imported. ` : ""}Open each beat to check its territory and verify it.
          </p>
          <div className={styles.actions}>
            <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={onClose}>View on Map</button>
          </div>
        </>
      )}
    </Modal>
  );
}

function Check({ children, ok, warn, bad }: { children: ReactNode; ok?: boolean; warn?: boolean; bad?: boolean }) {
  const tone = bad || (ok === false && !warn) ? "bad" : warn ? "warn" : "ok";
  const mark = tone === "ok" ? "✓" : tone === "warn" ? "⚠" : "✕";
  const cls = tone === "ok" ? styles.tickOk : tone === "warn" ? styles.tickWarn : styles.tickBad;
  return (
    <li>
      <span className={`${styles.tick} ${cls}`} aria-hidden="true">{mark}</span>
      <span>{children}</span>
    </li>
  );
}

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <span>{label}</span>
      {children}
    </>
  );
}

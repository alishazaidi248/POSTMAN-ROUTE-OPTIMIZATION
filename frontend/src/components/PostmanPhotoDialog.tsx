import { ChangeEvent, useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiClient } from "../lib/apiClient";
import { friendlyError } from "../lib/friendlyError";
import { Avatar } from "./Avatar";
import { Modal } from "./Modal";
import { useToast } from "./Toast";
import styles from "../styles/postmen.module.css";

const MAX_MB = 2;
const TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * Choose a picture, see it in the circle it will be shown in, then save. The server re-checks everything
 * (real file type, size, permission); this only saves the administrator a round trip.
 */
export function PostmanPhotoDialog({
  postmanId,
  name,
  currentUrl,
  onClose,
  onSaved
}: {
  postmanId: string;
  name: string;
  currentUrl: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const choose = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (!picked) return;
    if (!TYPES.includes(picked.type)) {
      setProblem("Please choose a JPEG, PNG or WebP photo.");
      return;
    }
    if (picked.size > MAX_MB * 1024 * 1024) {
      setProblem(`This photo is too large. Please choose one under ${MAX_MB} MB.`);
      return;
    }
    setProblem(null);
    setFile(picked);
  };

  const save = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.append("photo", file as File);
      return apiClient.put(`/postmen/${postmanId}/photo`, form);
    },
    onSuccess: () => {
      toast.success("Profile photo updated successfully.");
      onSaved();
    }
  });

  return (
    <Modal title="Profile photo" onClose={onClose} width={400}>
      <div className={styles.photoPreview}>
        <Avatar name={name} photoUrl={preview ?? currentUrl} size={120} />
        <strong>{name}</strong>
        <button className={styles.btn} onClick={() => input.current?.click()} disabled={save.isPending}>
          {file ? "Choose a different photo" : currentUrl ? "Choose a new photo" : "Choose a photo"}
        </button>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={choose} data-testid="photo-input" />
        <span className={styles.hint}>JPEG, PNG or WebP, up to {MAX_MB} MB. A square photo of the face works best.</span>
      </div>
      {problem && <p className={styles.errorText} role="alert">{problem}</p>}
      {save.isError && <p className={styles.errorText} role="alert">{friendlyError(save.error, "The photo could not be uploaded.")}</p>}
      <div className={styles.dialogActions}>
        <button className={styles.btn} onClick={onClose}>Cancel</button>
        <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => save.mutate()} disabled={!file || save.isPending}>
          {save.isError ? "Try Again" : save.isPending ? "Saving..." : "Save Photo"}
        </button>
      </div>
    </Modal>
  );
}

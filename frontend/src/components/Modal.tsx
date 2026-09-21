import { ReactNode, useEffect } from "react";
import styles from "../styles/components.module.css";

export function Modal({
  title,
  onClose,
  children,
  width = 480
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(17,24,39,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        padding: 12
      }}
      onClick={onClose}
    >
      <div
        className={styles.card}
        role="dialog"
        aria-label={title}
        style={{ width, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", boxShadow: "var(--shadow-pop)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 className={styles.sectionTitle} style={{ margin: 0, fontSize: 16 }}>{title}</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "var(--color-ink-500)" }}
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

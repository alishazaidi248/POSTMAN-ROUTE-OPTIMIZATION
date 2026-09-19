import { ReactNode } from "react";
import styles from "../styles/components.module.css";

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(28,28,30,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100
      }}
      onClick={onClose}
    >
      <div
        className={styles.card}
        style={{ width: 480, maxHeight: "85vh", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 className={styles.sectionTitle} style={{ margin: 0 }}>{title}</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "var(--color-ink-500)" }}
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

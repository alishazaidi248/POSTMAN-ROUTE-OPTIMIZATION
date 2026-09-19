import styles from "../styles/components.module.css";

export function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className={styles.card}>
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.statValue}>{value}</div>
    </div>
  );
}

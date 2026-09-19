import styles from "../styles/components.module.css";

const STATUS_TONE: Record<string, keyof typeof styles> = {
  DELIVERED: "badgeSuccess",
  ASSIGNED: "badgeInfo",
  OUT_FOR_DELIVERY: "badgeInfo",
  RECEIVED: "badgeNeutral",
  SORTED: "badgeNeutral",
  RESCHEDULED: "badgeWarning",
  RECIPIENT_UNAVAILABLE: "badgeWarning",
  FAILED: "badgeDanger",
  REJECTED: "badgeDanger",
  WRONG_ADDRESS: "badgeDanger",
  ADDRESS_NOT_FOUND: "badgeDanger",
  RETURNED: "badgeDanger",
  CANCELLED: "badgeNeutral",
  ACTIVE: "badgeSuccess",
  INACTIVE: "badgeNeutral",
  AVAILABLE: "badgeSuccess",
  CHARGING: "badgeWarning",
  MAINTENANCE: "badgeDanger",
  INFO: "badgeInfo",
  WARNING: "badgeWarning",
  CRITICAL: "badgeDanger"
};

export function Badge({ value }: { value: string }) {
  const tone = STATUS_TONE[value] ?? "badgeNeutral";
  return <span className={`${styles.badge} ${styles[tone]}`}>{value.replace(/_/g, " ")}</span>;
}

import { BeatRecord, Verification, VERIFICATION_LABEL, isOverlapping, overlapLabel } from "./beatTypes";
import styles from "./beats.module.css";

const TONE: Record<Verification, string> = {
  VERIFIED: styles.badgeVerified,
  PENDING_VERIFICATION: styles.badgePending,
  NEEDS_REVIEW: styles.badgeReview
};

/** Verification state as a small pill: a dot and plain words. */
export function VerificationBadge({ value }: { value: Verification }) {
  return (
    <span className={`${styles.badge} ${TONE[value]}`}>
      <span className={styles.dot} aria-hidden="true" />
      {VERIFICATION_LABEL[value]}
    </span>
  );
}

/** Shown next to the verification pill when this territory overlaps another beat. */
export function OverlapBadge({ beat }: { beat: BeatRecord }) {
  if (!isOverlapping(beat)) return null;
  return (
    <span className={`${styles.badge} ${styles.badgeReview}`} title="Addresses inside the overlap cannot be assigned automatically">
      {overlapLabel(beat)}
    </span>
  );
}

export function ActiveBadge({ active }: { active: boolean }) {
  return (
    <span className={`${styles.badge} ${active ? styles.badgeActive : styles.badgeInactive}`}>
      <span className={styles.dot} aria-hidden="true" />
      {active ? "Active" : "Inactive"}
    </span>
  );
}

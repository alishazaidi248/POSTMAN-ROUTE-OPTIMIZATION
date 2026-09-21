import { ActiveBadge, VerificationBadge } from "./StatusBadge";
import { BeatRecord, deliveriesOf, formatWhen, territoryLabel } from "./beatTypes";
import { OtherFeature } from "./BeatMap";
import { Icon } from "../../components/icons";
import styles from "./beats.module.css";

interface BeatPanelProps {
  beat: BeatRecord;
  onClose: () => void;
  onEditBeat: () => void;
  onAssign: () => void;
  onVerify: () => void;
  onEditTerritory: () => void;
  onDrawTerritory: () => void;
}

/** What an administrator needs to know about one beat, in plain words (no ids, no raw fields). */
export function BeatDetailsPanel({ beat, onClose, onEditBeat, onAssign, onVerify, onEditTerritory, onDrawTerritory }: BeatPanelProps) {
  const deliveries = deliveriesOf(beat);

  return (
    <aside className={styles.panel} aria-label="Beat details" data-testid="beat-details">
      <div className={styles.panelHead}>
        <div style={{ minWidth: 0 }}>
          <div className={styles.eyebrow}>Beat details</div>
          <h2 className={styles.panelTitle}>Beat {beat.beatNumber}</h2>
          <p className={styles.panelSub}>{beat.name}</p>
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            <VerificationBadge value={beat.verificationStatus} />
            <ActiveBadge active={beat.status === "ACTIVE"} />
          </div>
        </div>
        <button className={styles.close} onClick={onClose} aria-label="Close details">
          <Icon name="close" />
        </button>
      </div>

      <div className={styles.panelBody}>
        {!beat.hasTerritory && (
          <p className={`${styles.callout} ${styles.calloutReview}`}>
            This beat has no territory yet. Draw its territory on the map so it can be verified.
          </p>
        )}
        {beat.hasTerritory && beat.verificationStatus === "PENDING_VERIFICATION" && (
          <p className={styles.callout}>Check this beat&rsquo;s territory on the map, then verify it.</p>
        )}
        {beat.verificationStatus === "VERIFIED" && (
          <p className={`${styles.callout} ${styles.calloutGood}`}>
            Verified{beat.verifiedByName ? ` by ${beat.verifiedByName}` : ""} · {formatWhen(beat.verifiedAt)}
          </p>
        )}

        <dl className={styles.facts}>
          <div className={styles.fact}><dt>Post office</dt><dd>{beat.postOfficeName}</dd></div>
          <div className={styles.fact}><dt>Territory</dt><dd>{territoryLabel(beat)}</dd></div>
          <div className={styles.fact}><dt>Assigned postman</dt><dd>{beat.assignedPostmanName ?? "Not assigned"}</dd></div>
          <div className={styles.fact}><dt>Deliveries</dt><dd>{deliveries}</dd></div>
          <div className={styles.fact}><dt>Last updated</dt><dd>{formatWhen(beat.updatedAt)}</dd></div>
        </dl>

        <details className={styles.advanced}>
          <summary>Advanced details</summary>
          <dl>
            <dt>Beat ID</dt><dd>{beat.id}</dd>
            <dt>Post office ID</dt><dd>{beat.postOfficeId}</dd>
            <dt>Created</dt><dd>{formatWhen(beat.createdAt)}</dd>
          </dl>
        </details>
      </div>

      <div className={styles.panelFoot}>
        {beat.hasTerritory && beat.verificationStatus !== "VERIFIED" && (
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={onVerify}>Verify Beat</button>
        )}
        {beat.hasTerritory ? (
          <button className={styles.btn} onClick={onEditTerritory}>Edit Territory</button>
        ) : (
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={onDrawTerritory}>Draw Territory</button>
        )}
        <button className={styles.btn} onClick={onEditBeat}>Edit Beat</button>
        <button className={styles.btn} onClick={onAssign}>Assign Postman</button>
      </div>
    </aside>
  );
}

const STATUS_WORDS: Record<string, string> = {
  RECEIVED: "Received", SORTED: "Waiting for a beat", ASSIGNED: "Assigned", OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered", RESCHEDULED: "Rescheduled", RECIPIENT_UNAVAILABLE: "Recipient unavailable", FAILED: "Failed",
  REJECTED: "Rejected", WRONG_ADDRESS: "Wrong address", ADDRESS_NOT_FOUND: "Address not found", RETURNED: "Returned", CANCELLED: "Cancelled"
};

const text = (v: unknown, fallback = "—") => (v === null || v === undefined || v === "" ? fallback : String(v));

/** A parcel, a postman or the post office clicked on the map: a few readable facts. */
export function OtherFeaturePanel({ feature, onClose }: { feature: OtherFeature; onClose: () => void }) {
  const p = feature.properties;
  const rows: [string, string][] =
    feature.kind === "delivery"
      ? [
          ["Tracking number", text(p.trackingId)],
          ["Recipient", text(p.recipient)],
          ["Status", STATUS_WORDS[String(p.status)] ?? text(p.status)],
          ["Beat", text(p.beat, "Not in a beat")],
          ["Postman", text(p.postman, "Not assigned")],
          ["Pincode", text(p.pincode)]
        ]
      : feature.kind === "postman"
        ? [
            ["Name", text(p.name)],
            ["Beat", text(p.beat, "No beat")],
            ["Last seen", formatWhen(typeof p.recordedAt === "string" ? p.recordedAt : null)]
          ]
        : [["Name", text(p.name)], ["Office code", text(p.code)]];
  const title = feature.kind === "delivery" ? "Delivery" : feature.kind === "postman" ? "Postman" : "Post office";

  return (
    <aside className={styles.panel} aria-label={`${title} details`} data-testid="other-details">
      <div className={styles.panelHead}>
        <div>
          <div className={styles.eyebrow}>{title}</div>
          <h2 className={styles.panelTitle}>{rows[0][1]}</h2>
        </div>
        <button className={styles.close} onClick={onClose} aria-label="Close details">
          <Icon name="close" />
        </button>
      </div>
      <div className={styles.panelBody}>
        <dl className={styles.facts}>
          {rows.slice(1).map(([label, value]) => (
            <div key={label} className={styles.fact}><dt>{label}</dt><dd>{value}</dd></div>
          ))}
        </dl>
      </div>
    </aside>
  );
}

export function EmptyPanel({ hasBeats, needAttention }: { hasBeats: boolean; needAttention: number }) {
  return (
    <aside className={styles.panel} aria-label="Beat details">
      <div className={styles.emptyPanel}>
        <strong>{hasBeats ? "Select a beat" : "No beats yet"}</strong>
        {hasBeats ? (
          <>
            <span>Click a beat on the map, or search for one, to see who is assigned and how many deliveries it has.</span>
            {needAttention > 0 && <span>{needAttention} beat{needAttention === 1 ? "" : "s"} still need{needAttention === 1 ? "s" : ""} to be verified.</span>}
          </>
        ) : (
          <span>Upload a beat list, or draw a territory on the map, to add your first beat.</span>
        )}
      </div>
    </aside>
  );
}

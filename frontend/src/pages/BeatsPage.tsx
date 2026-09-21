import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../lib/apiClient";
import { ActiveBadge, VerificationBadge } from "../features/beats/StatusBadge";
import { BeatRecord, deliveriesOf, formatWhen } from "../features/beats/beatTypes";
import styles from "../styles/components.module.css";

function groupByPostOffice(beats: BeatRecord[]) {
  const groups = new Map<string, { postOfficeName: string; beats: BeatRecord[] }>();
  for (const beat of beats) {
    const group = groups.get(beat.postOfficeId);
    if (group) group.beats.push(beat);
    else groups.set(beat.postOfficeId, { postOfficeName: beat.postOfficeName, beats: [beat] });
  }
  return Array.from(groups.values());
}

function BeatTable({ beats }: { beats: BeatRecord[] }) {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>Beat</th>
          <th>Name</th>
          <th>Verification</th>
          <th>Assigned Postman</th>
          <th>Deliveries</th>
          <th>Status</th>
          <th>Last updated</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {beats.map((b) => (
          <tr key={b.id}>
            <td><strong>{b.beatNumber}</strong></td>
            <td>{b.name}</td>
            <td><VerificationBadge value={b.verificationStatus} /></td>
            <td>{b.assignedPostmanName ?? "Not assigned"}</td>
            <td>{deliveriesOf(b)}</td>
            <td><ActiveBadge active={b.status === "ACTIVE"} /></td>
            <td>{formatWhen(b.updatedAt)}</td>
            <td><Link to={`/map?beat=${b.id}`}>View on map</Link></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function BeatsPage() {
  const { data, isLoading } = useQuery<BeatRecord[]>({
    queryKey: ["beats"],
    queryFn: () => apiClient.get("/beats").then((r) => r.data)
  });

  if (isLoading || !data) return <p>Loading beats…</p>;

  const groups = groupByPostOffice(data);

  // A single-post-office admin has exactly one group, so the office heading only appears
  // when there is more than one office to tell apart (a Super Admin).
  if (groups.length <= 1) {
    return (
      <div className={styles.card}>
        <div className={styles.toolbar} style={{ justifyContent: "space-between" }}>
          <h3 className={styles.sectionTitle} style={{ margin: 0 }}>{data.length} beats</h3>
          <Link to="/map">Manage on the Operations Map</Link>
        </div>
        <BeatTable beats={data} />
      </div>
    );
  }

  return (
    <div>
      {groups.map((group) => (
        <div key={group.postOfficeName} className={styles.card} style={{ marginBottom: "var(--space-4)" }}>
          <h3 className={styles.sectionTitle}>
            {group.postOfficeName} <span style={{ fontWeight: 400, color: "var(--color-ink-500)" }}>({group.beats.length} beats)</span>
          </h3>
          <BeatTable beats={group.beats} />
        </div>
      ))}
    </div>
  );
}

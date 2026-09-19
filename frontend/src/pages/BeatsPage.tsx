import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../lib/apiClient";
import { Badge } from "../components/Badge";
import styles from "../styles/components.module.css";

interface BeatRow {
  id: string;
  postOfficeId: string;
  postOfficeName: string;
  beatNumber: string;
  name: string;
  status: string;
  centerLatitude: number;
  centerLongitude: number;
  deliveryCount: string | number;
  assignedPostmanName: string | null;
}

function groupByPostOffice(beats: BeatRow[]) {
  const groups = new Map<string, { postOfficeName: string; beats: BeatRow[] }>();
  for (const beat of beats) {
    const group = groups.get(beat.postOfficeId);
    if (group) {
      group.beats.push(beat);
    } else {
      groups.set(beat.postOfficeId, { postOfficeName: beat.postOfficeName, beats: [beat] });
    }
  }
  return Array.from(groups.values());
}

function BeatTable({ beats }: { beats: BeatRow[] }) {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>Beat</th>
          <th>Name</th>
          <th>Center</th>
          <th>Assigned Postman</th>
          <th>Deliveries</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {beats.map((b) => (
          <tr key={b.id}>
            <td>{b.beatNumber}</td>
            <td>{b.name}</td>
            <td>{b.centerLatitude.toFixed(4)}, {b.centerLongitude.toFixed(4)}</td>
            <td>{b.assignedPostmanName ?? "Unassigned"}</td>
            <td>{b.deliveryCount}</td>
            <td><Badge value={b.status} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function BeatsPage() {
  const { data, isLoading } = useQuery<BeatRow[]>({
    queryKey: ["beats"],
    queryFn: () => apiClient.get("/beats").then((r) => r.data)
  });

  if (isLoading || !data) return <p>Loading beats…</p>;

  const groups = groupByPostOffice(data);

  // A single-post-office admin has exactly one group — showing a redundant
  // header for "their own" post office adds noise without adding
  // information, so the grouped headings only appear once there's more than
  // one post office to tell apart (i.e. viewing as Super Admin).
  if (groups.length <= 1) {
    return <BeatTable beats={data} />;
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

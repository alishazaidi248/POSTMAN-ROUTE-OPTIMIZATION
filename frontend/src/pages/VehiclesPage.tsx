import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../lib/apiClient";
import { Badge } from "../components/Badge";
import styles from "../styles/components.module.css";

interface VehicleRow {
  id: string;
  assetId: string;
  model: string;
  batteryCapacityWh: number;
  currentBatteryPercentage: number;
  status: string;
  assignedPostman: { id: string; name: string } | null;
}

export function VehiclesPage() {
  const { data, isLoading } = useQuery<VehicleRow[]>({
    queryKey: ["vehicles"],
    queryFn: () => apiClient.get("/vehicles").then((r) => r.data)
  });

  if (isLoading || !data) return <p>Loading e-bikes…</p>;

  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>Asset ID</th>
          <th>Model</th>
          <th>Battery</th>
          <th>Assigned Postman</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {data.map((v) => (
          <tr key={v.id}>
            <td>{v.assetId}</td>
            <td>{v.model}</td>
            <td>{v.currentBatteryPercentage}% of {v.batteryCapacityWh}Wh</td>
            <td>{v.assignedPostman?.name ?? "—"}</td>
            <td><Badge value={v.status} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

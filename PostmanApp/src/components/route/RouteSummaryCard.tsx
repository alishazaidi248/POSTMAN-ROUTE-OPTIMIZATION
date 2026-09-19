import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors } from "../../theme/colors";
import { radius, spacing } from "../../theme/spacing";
import { typography } from "../../theme/typography";
import { ActiveRouteResponse, OptimizationStop } from "../../types/route";
import { formatDistance } from "../../utils/distance";
import { formatDurationMinutes } from "../../utils/formatting";

interface Props {
  route: ActiveRouteResponse;
  completed: number;
  total: number;
  currentStop: OptimizationStop | null;
  nextStop: OptimizationStop | null;
  recipientNameByDeliveryId: Record<string, string>;
}

// Deliberately says "Optimized Route" / "Generated Route", never "optimal
// route" — the backend's optimizer is a placeholder pending the research
// engine, and the app must not fabricate a claim the system can't back
// (spec §15, §49).
export function RouteSummaryCard({ route, completed, total, currentStop, nextStop, recipientNameByDeliveryId }: Props) {
  const remaining = total - completed;
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Today&rsquo;s Optimized Route</Text>
      <Text style={styles.count}>{total} Deliveries</Text>

      <View style={styles.row}>
        <Stat label="Completed" value={String(completed)} />
        <Stat label="Remaining" value={String(remaining)} />
      </View>
      <View style={styles.row}>
        <Stat label="Distance" value={formatDistance(route.solution.totalDistanceMeters)} />
        <Stat label="Est. Time" value={formatDurationMinutes(route.solution.estimatedDurationMinutes)} />
      </View>

      {currentStop ? (
        <View style={styles.stopBlock}>
          <Text style={styles.stopLabel}>Current Stop</Text>
          <Text style={styles.stopValue}>
            #{currentStop.sequence} · {recipientNameByDeliveryId[currentStop.deliveryId] ?? "Delivery"}
          </Text>
        </View>
      ) : null}
      {nextStop ? (
        <View style={styles.stopBlock}>
          <Text style={styles.stopLabel}>Next</Text>
          <Text style={styles.stopValue}>
            #{nextStop.sequence} · {recipientNameByDeliveryId[nextStop.deliveryId] ?? "Delivery"}
          </Text>
        </View>
      ) : null}

      <Text style={styles.version}>Route v{route.version} · {route.solution.algorithm}</Text>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.sm },
  title: { ...typography.label, color: colors.textSecondary },
  count: { ...typography.screenTitle, color: colors.textPrimary },
  row: { flexDirection: "row", gap: spacing.xl, marginTop: spacing.xs },
  stat: { gap: 2 },
  statValue: { ...typography.sectionTitle, color: colors.textPrimary },
  statLabel: { ...typography.caption, color: colors.textSecondary },
  stopBlock: { marginTop: spacing.sm },
  stopLabel: { ...typography.label, color: colors.textSecondary },
  stopValue: { ...typography.bodyStrong, color: colors.textPrimary },
  version: { ...typography.caption, color: colors.textDisabled, marginTop: spacing.sm }
});

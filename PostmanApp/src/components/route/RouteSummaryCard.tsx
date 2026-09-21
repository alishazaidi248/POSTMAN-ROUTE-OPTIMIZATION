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
  /** True when the backend returned real road-network geometry (OSRM or
   * equivalent) for this route. When false the map's dashed line is only a
   * straight-line guide between stops, not a road path, and that must never
   * be presented as a real route. */
  hasRoadGeometry: boolean;
  /** One-line version for the Map tab, where the map itself is the focus. */
  compact?: boolean;
}

// Deliberately says "Optimized Route", never "optimal route": the backend's planner is a
// good heuristic, not a proof of optimality, and the app must not claim more than the
// system can back. The app never names or offers an algorithm.
export function RouteSummaryCard({
  route,
  completed,
  total,
  currentStop,
  nextStop,
  recipientNameByDeliveryId,
  hasRoadGeometry,
  compact = false
}: Props) {
  const remaining = total - completed;

  if (compact) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Today&rsquo;s Optimized Route</Text>
        <Text style={styles.compactLine}>
          {`${completed} of ${total} done · ${remaining} to go · ${formatDistance(route.solution.totalDistanceMeters)} · ~${formatDurationMinutes(route.solution.estimatedDurationMinutes)}`}
        </Text>
        {!hasRoadGeometry ? (
          <Text style={styles.roadWarning}>
            Road route unavailable — the dashed line is a straight-line guide, and distances are estimates.
          </Text>
        ) : null}
        <Text style={styles.version}>{versionLine(route)}</Text>
      </View>
    );
  }

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

      {!hasRoadGeometry ? (
        <Text style={styles.roadWarning}>
          Road route unavailable — the dashed line is a straight-line guide between stops, not a driving/walking path.
        </Text>
      ) : null}

      <Text style={styles.version}>{versionLine(route)}</Text>
    </View>
  );
}

function versionLine(route: ActiveRouteResponse): string {
  return `Route v${route.version}`;
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
  compactLine: { ...typography.bodyStrong, color: colors.textPrimary },
  row: { flexDirection: "row", gap: spacing.xl, marginTop: spacing.xs },
  stat: { gap: 2 },
  statValue: { ...typography.sectionTitle, color: colors.textPrimary },
  statLabel: { ...typography.caption, color: colors.textSecondary },
  stopBlock: { marginTop: spacing.sm },
  stopLabel: { ...typography.label, color: colors.textSecondary },
  stopValue: { ...typography.bodyStrong, color: colors.textPrimary },
  roadWarning: { ...typography.caption, color: colors.warning, marginTop: spacing.sm },
  version: { ...typography.caption, color: colors.textDisabled, marginTop: spacing.sm }
});

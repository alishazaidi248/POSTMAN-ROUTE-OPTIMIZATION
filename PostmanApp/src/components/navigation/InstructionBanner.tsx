import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Directions } from "../../types/navigation";
import { ARRIVAL_RADIUS_M, formatDistance, maneuverArrow, Progress } from "../../utils/navigationProgress";
import { colors } from "../../theme/colors";
import { radius, spacing } from "../../theme/spacing";
import { typography } from "../../theme/typography";

interface Props {
  directions: Directions;
  progress: Progress | null;
  rerouting: boolean;
}

/**
 * The next thing to do, big enough to read on a moving bicycle: an arrow, how far, and what. Under it, what to do
 * until then. Before the first GPS fix it shows the first instruction from the start of the route.
 */
export function InstructionBanner({ directions, progress, rerouting }: Props) {
  const steps = directions.steps;
  const current = steps[progress?.currentStepIndex ?? 0] ?? null;
  const nextIndex = progress ? progress.nextStepIndex : steps.length > 1 ? 1 : null;
  const next = nextIndex !== null ? steps[nextIndex] : null;
  const distance = progress ? progress.distanceToNextManeuverMeters : (current?.distanceMeters ?? 0);
  const straightLine = directions.source === "STRAIGHT_LINE";
  // At the door: just "You have arrived", without a countdown of "0 m" or the last turn under it.
  const atDoor = next?.maneuverType === "arrive" && distance <= ARRIVAL_RADIUS_M;

  return (
    <View style={styles.banner} accessibilityRole="header" accessibilityLiveRegion="polite">
      <View style={styles.row}>
        <Text style={styles.arrow} accessibilityElementsHidden importantForAccessibility="no">
          {maneuverArrow(next ?? current)}
        </Text>
        <View style={styles.text}>
          {next && !atDoor ? <Text style={styles.distance}>{formatDistance(distance)}</Text> : null}
          <Text style={styles.instruction} numberOfLines={2}>
            {next?.instruction ?? current?.instruction ?? "Follow the route"}
          </Text>
        </View>
      </View>
      {current && next && !atDoor ? (
        <Text style={styles.now} numberOfLines={1}>
          Now: {current.instruction}
        </Text>
      ) : null}
      {rerouting ? <Text style={styles.note}>Finding a new route from here…</Text> : null}
      {straightLine ? (
        <Text style={styles.note}>No street directions right now - follow the direct line. Retrying automatically.</Text>
      ) : null}
      {!straightLine && directions.warnings.length > 0 ? <Text style={styles.note}>{directions.warnings[0]}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { backgroundColor: colors.mapSelf, borderRadius: radius.lg, padding: spacing.md, gap: spacing.xs },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  arrow: { fontSize: 44, lineHeight: 50, color: "#FFFFFF", width: 52, textAlign: "center" },
  text: { flex: 1 },
  distance: { fontSize: 28, fontWeight: "700", color: "#FFFFFF" },
  instruction: { fontSize: 18, fontWeight: "600", color: "#FFFFFF", lineHeight: 23 },
  now: { ...typography.caption, color: "#D1D5DB" },
  note: { ...typography.caption, color: "#FCD34D" }
});

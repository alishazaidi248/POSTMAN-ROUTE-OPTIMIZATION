import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { StopView, legLabel } from "../../utils/routeView";
import { formatAddress, formatTime } from "../../utils/formatting";
import { openNavigation } from "../../utils/navigation";
import { notify } from "../../utils/alerts";
import { colors } from "../../theme/colors";
import { radius, spacing, touchTarget } from "../../theme/spacing";
import { typography } from "../../theme/typography";

interface Props {
  next: StopView | null;
  /** Stops on the route in total (the Y of "STOP X OF Y"). */
  total: number;
  /** Everything on the round is done or failed. */
  allDone: boolean;
  recalculating: boolean;
  onRecalculate: () => void;
  onFocusNext: () => void;
}

/**
 * The strip across the top of the map answering "what is next, how far, and
 * how do I get there?" without touching the map. The next stop is also the
 * blue marker on the map itself.
 */
export function NextStopBanner({ next, total, allDone, recalculating, onRecalculate, onFocusNext }: Props) {
  if (!next) {
    return (
      <View style={styles.banner}>
        <Text style={styles.done}>{allDone ? "All deliveries on this round are done ✓" : "No stops left on the route"}</Text>
      </View>
    );
  }

  const leg = legLabel(next);
  const name = next.delivery.recipient.name;

  const navigate = async () => {
    const ok = await openNavigation({
      latitude: next.latitude,
      longitude: next.longitude,
      address: next.delivery.address,
      label: name
    });
    if (!ok) notify("Couldn't open maps", "No maps app could be opened on this device.");
  };

  return (
    <View style={styles.banner}>
      <Pressable onPress={onFocusNext} accessibilityRole="button" accessibilityLabel={`Next stop ${name}. Show on map`} style={styles.info}>
        <Text style={styles.eyebrow}>{`NEXT — STOP ${next.sequence ?? "?"} OF ${total}`}</Text>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.address} numberOfLines={1}>
          {formatAddress(next.delivery.address)}
        </Text>
        <Text style={styles.meta}>{[leg, next.eta ? `ETA ${formatTime(next.eta)}` : null].filter(Boolean).join(" · ")}</Text>
      </Pressable>

      <View style={styles.actions}>
        <Pressable onPress={navigate} accessibilityRole="button" accessibilityLabel="Navigate" style={styles.navigate}>
          <Text style={styles.navigateText}>Navigate</Text>
        </Pressable>
        <Pressable
          onPress={onRecalculate}
          disabled={recalculating}
          accessibilityRole="button"
          accessibilityLabel="Recalculate route"
          style={styles.recalc}
        >
          {recalculating ? <ActivityIndicator size="small" color={colors.info} /> : <Text style={styles.recalcText}>Recalculate</Text>}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.mapCurrent,
    padding: spacing.md
  },
  info: { flex: 1, gap: 2 },
  eyebrow: { ...typography.label, color: colors.mapCurrent },
  name: { ...typography.sectionTitle, color: colors.textPrimary },
  address: { ...typography.caption, color: colors.textSecondary },
  meta: { ...typography.caption, color: colors.textPrimary, fontWeight: "600" },
  done: { ...typography.bodyStrong, color: colors.success, flex: 1, textAlign: "center" },
  actions: { gap: spacing.xs, alignItems: "stretch" },
  navigate: {
    minHeight: touchTarget.minHeight,
    minWidth: 96,
    borderRadius: radius.md,
    backgroundColor: colors.mapCurrent,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md
  },
  navigateText: { ...typography.button, color: colors.onPrimary },
  recalc: { alignItems: "center", justifyContent: "center", paddingVertical: spacing.xs, minHeight: 28 },
  recalcText: { ...typography.label, color: colors.info }
});

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { TravelMode } from "../../types/navigation";
import { formatDistance, formatDuration } from "../../utils/navigationProgress";
import { formatTime } from "../../utils/formatting";
import { colors } from "../../theme/colors";
import { radius, spacing, touchTarget } from "../../theme/spacing";
import { typography } from "../../theme/typography";

interface Props {
  recipientName: string;
  remainingMeters: number | null;
  remainingSeconds: number | null;
  /** Expected arrival, epoch ms. */
  arrivalAt: number | null;
  mode: TravelMode;
  onModeChange: (mode: TravelMode) => void;
  onOpenGoogleMaps: () => void;
  onEnd: () => void;
}

const MODES: { mode: TravelMode; label: string }[] = [
  { mode: "BIKE", label: "Cycle" },
  { mode: "FOOT", label: "Walk" }
];

/** Time and distance left, how the postman is travelling, and the ways out: Google Maps, or end navigation. */
export function NavigationFooter({ recipientName, remainingMeters, remainingSeconds, arrivalAt, mode, onModeChange, onOpenGoogleMaps, onEnd }: Props) {
  const arrival = arrivalAt != null ? formatTime(new Date(arrivalAt).toISOString()) : null;

  return (
    <View style={styles.footer}>
      <View style={styles.summary}>
        <View style={styles.flex}>
          <Text style={styles.big}>
            {remainingSeconds != null ? formatDuration(remainingSeconds) : "—"}
            {remainingMeters != null ? <Text style={styles.small}>{`  ·  ${formatDistance(remainingMeters)}`}</Text> : null}
          </Text>
          <Text style={styles.small} numberOfLines={1}>
            {arrival ? `Arrive ${arrival} · ` : ""}
            {recipientName}
          </Text>
        </View>
        <View style={styles.modes} accessibilityRole="radiogroup" accessibilityLabel="Travelling by">
          {MODES.map((m) => {
            const selected = m.mode === mode;
            return (
              <Pressable
                key={m.mode}
                onPress={() => !selected && onModeChange(m.mode)}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={m.label}
                style={[styles.mode, selected && styles.modeSelected]}
              >
                <Text style={[styles.modeText, selected && styles.modeTextSelected]}>{m.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <View style={styles.buttons}>
        <Pressable onPress={onOpenGoogleMaps} accessibilityRole="button" accessibilityLabel="Open in Google Maps" style={[styles.button, styles.secondary]}>
          <Text style={styles.secondaryText}>Open in Google Maps</Text>
        </Pressable>
        <Pressable onPress={onEnd} accessibilityRole="button" accessibilityLabel="End navigation" style={[styles.button, styles.end]}>
          <Text style={styles.endText}>End</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: { backgroundColor: colors.surface, padding: spacing.md, gap: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  summary: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  flex: { flex: 1 },
  big: { fontSize: 22, fontWeight: "700", color: colors.success },
  small: { ...typography.caption, color: colors.textSecondary, fontWeight: "400" },
  modes: { flexDirection: "row", backgroundColor: colors.neutralBg, borderRadius: radius.pill, padding: 3 },
  mode: { paddingHorizontal: spacing.md, minHeight: 36, justifyContent: "center", borderRadius: radius.pill },
  modeSelected: { backgroundColor: colors.surface, shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  modeText: { ...typography.bodyStrong, color: colors.textSecondary },
  modeTextSelected: { color: colors.textPrimary },
  buttons: { flexDirection: "row", gap: spacing.sm },
  button: { minHeight: touchTarget.minHeight, borderRadius: radius.md, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.lg },
  secondary: { flex: 1, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  secondaryText: { ...typography.button, color: colors.textPrimary },
  end: { backgroundColor: colors.dangerBg },
  endText: { ...typography.button, color: colors.danger }
});

import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { TurnByTurnPhase } from "../../hooks/useTurnByTurn";
import { colors } from "../../theme/colors";
import { radius, spacing } from "../../theme/spacing";
import { typography } from "../../theme/typography";

interface Props {
  phase: TurnByTurnPhase;
  error: string | null;
  hasDelivery: boolean;
  deliveryLoading: boolean;
  onRetry: () => void;
  onOpenGoogleMaps: () => void;
  onEnd: () => void;
}

/** Before directions are on screen: finding them, or why they couldn't be found - always with Google Maps as a way out. */
export function TurnByTurnStatus({ phase, error, hasDelivery, deliveryLoading, onRetry, onOpenGoogleMaps, onEnd }: Props) {
  if (phase === "LOADING") {
    return (
      <View style={styles.card}>
        <ActivityIndicator color="#FFFFFF" />
        <Text style={styles.text}>Finding the way…</Text>
      </View>
    );
  }

  return (
    <View style={[styles.card, styles.column]}>
      <Text style={styles.text}>{error ?? "Couldn't load directions."}</Text>
      <View style={styles.actions}>
        {hasDelivery ? (
          <Pressable onPress={onOpenGoogleMaps} accessibilityRole="button" accessibilityLabel="Open in Google Maps" style={styles.action}>
            <Text style={styles.actionText}>Open in Google Maps</Text>
          </Pressable>
        ) : null}
        {hasDelivery || deliveryLoading ? (
          <Pressable onPress={onRetry} accessibilityRole="button" accessibilityLabel="Try again" style={styles.action}>
            <Text style={styles.actionText}>Try again</Text>
          </Pressable>
        ) : (
          <Pressable onPress={onEnd} accessibilityRole="button" accessibilityLabel="Back" style={styles.action}>
            <Text style={styles.actionText}>Back</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.mapSelf, borderRadius: radius.lg, padding: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.md },
  column: { flexDirection: "column", alignItems: "stretch" },
  text: { ...typography.bodyStrong, color: "#FFFFFF", flexShrink: 1 },
  actions: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  action: { backgroundColor: "#FFFFFF", borderRadius: radius.md, paddingHorizontal: spacing.md, minHeight: 40, justifyContent: "center" },
  actionText: { ...typography.bodyStrong, color: colors.textPrimary }
});

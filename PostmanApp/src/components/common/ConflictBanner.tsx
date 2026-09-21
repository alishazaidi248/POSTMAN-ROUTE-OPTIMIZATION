import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SyncConflict } from "../../store/offlineStore";
import { colors } from "../../theme/colors";
import { radius, spacing } from "../../theme/spacing";
import { typography } from "../../theme/typography";
import { statusLabel } from "../../utils/status";

interface Props {
  conflicts: SyncConflict[];
  nameByDeliveryId: Record<string, string>;
  onDismiss: (deliveryId: string) => void;
}

/**
 * Shown when the server rejected a status change that was queued offline
 * (someone — an admin, another attempt — had already moved the delivery on).
 * The app never overwrites the server: it drops the stale change and tells the
 * postman what the server says now.
 */
export function ConflictBanner({ conflicts, nameByDeliveryId, onDismiss }: Props) {
  if (conflicts.length === 0) return null;

  return (
    <View style={styles.wrap} accessibilityLiveRegion="polite">
      {conflicts.map((c) => (
        <View key={c.deliveryId} style={styles.banner}>
          <Text style={styles.text}>
            {`Couldn't apply "${statusLabel(c.attemptedStatus)}" for ${nameByDeliveryId[c.deliveryId] ?? "a delivery"}: it is now `}
            <Text style={styles.strong}>{statusLabel(c.serverStatus)}</Text>
            {" on the server."}
          </Text>
          <Pressable
            onPress={() => onDismiss(c.deliveryId)}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
            hitSlop={8}
          >
            <Text style={styles.dismiss}>Dismiss</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs, padding: spacing.sm },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.warningBg,
    borderRadius: radius.md,
    padding: spacing.md
  },
  text: { ...typography.caption, color: colors.textPrimary, flex: 1 },
  strong: { fontWeight: "700" },
  dismiss: { ...typography.label, color: colors.warning }
});

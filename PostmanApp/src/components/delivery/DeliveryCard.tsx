import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Delivery } from "../../types/delivery";
import { formatAddress } from "../../utils/formatting";
import { colors } from "../../theme/colors";
import { radius, spacing } from "../../theme/spacing";
import { typography } from "../../theme/typography";
import { StatusBadge } from "../status/StatusBadge";

interface Props {
  delivery: Delivery;
  sequence?: number;
  distanceLabel?: string;
  onPress: () => void;
}

export function DeliveryCard({ delivery, sequence, distanceLabel, onPress }: Props) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Delivery for ${delivery.recipient.name}, ${delivery.status}`}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.headerRow}>
        {sequence != null ? <Text style={styles.sequence}>{sequence}</Text> : null}
        <Text style={styles.name} numberOfLines={1}>
          {delivery.recipient.name}
        </Text>
        {delivery.priority !== "NORMAL" ? <Text style={styles.priority}>{delivery.priority}</Text> : null}
      </View>
      <Text style={styles.address} numberOfLines={2}>
        {formatAddress(delivery.address)}
      </Text>
      <View style={styles.footerRow}>
        <StatusBadge status={delivery.status} />
        {distanceLabel ? <Text style={styles.distance}>{distanceLabel}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs
  },
  pressed: { opacity: 0.8 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  sequence: {
    ...typography.bodyStrong,
    color: colors.onPrimary,
    backgroundColor: colors.primary,
    width: 24,
    height: 24,
    borderRadius: 12,
    textAlign: "center",
    lineHeight: 24,
    overflow: "hidden"
  },
  name: { ...typography.bodyStrong, color: colors.textPrimary, flex: 1 },
  priority: { ...typography.label, color: colors.danger },
  address: { ...typography.caption, color: colors.textSecondary },
  footerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.xs },
  distance: { ...typography.caption, color: colors.textSecondary }
});

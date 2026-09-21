import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../../theme/colors";
import { radius, spacing } from "../../theme/spacing";
import { typography } from "../../theme/typography";
import { FinishedDelivery } from "../../types/delivery";
import { formatAddressShort, formatTime } from "../../utils/formatting";
import { StatusBadge } from "../status/StatusBadge";

interface Props {
  delivery: FinishedDelivery;
  onPress: () => void;
}

/** One finished delivery: who it was for, where, how it ended and at what time. Tap for the full details and history. */
export function HistoryRow({ delivery, onPress }: Props) {
  const address = formatAddressShort(delivery.address);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${delivery.recipient.name}, ${delivery.status === "DELIVERED" ? "delivered" : "returned"} at ${formatTime(delivery.finishedAt)}. Open details`}
      style={styles.row}
    >
      <View style={styles.main}>
        <View style={styles.top}>
          <Text style={styles.name} numberOfLines={1}>
            {delivery.recipient.name}
          </Text>
          <Text style={styles.time}>{formatTime(delivery.finishedAt)}</Text>
        </View>
        <Text style={styles.address} numberOfLines={2}>
          {address}
        </Text>
        <View style={styles.bottom}>
          <StatusBadge status={delivery.status} />
          <Text style={styles.meta}>
            {delivery.parcelCount} parcel{delivery.parcelCount === 1 ? "" : "s"}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  main: { gap: spacing.xs },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: spacing.md },
  name: { ...typography.bodyStrong, color: colors.textPrimary, flex: 1 },
  time: { ...typography.caption, color: colors.textSecondary },
  address: { ...typography.caption, color: colors.textSecondary },
  bottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.xs },
  meta: { ...typography.caption, color: colors.textSecondary }
});

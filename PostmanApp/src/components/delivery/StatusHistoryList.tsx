import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, StatusTone } from "../../theme/colors";
import { spacing } from "../../theme/spacing";
import { typography } from "../../theme/typography";
import { DeliveryStatusHistoryEntry } from "../../types/delivery";
import { formatDateTime, formatRelativeTime } from "../../utils/formatting";
import { statusLabel, statusTone } from "../../utils/status";

const TONE_FG: Record<StatusTone, string> = {
  success: colors.success,
  warning: colors.warning,
  danger: colors.danger,
  info: colors.info,
  neutral: colors.neutral
};

/**
 * What happened to this delivery, newest first: WHO it is for, WHAT happened (in the status colour, with the
 * reason the postman gave, if any) and WHEN (the actual date and time, then how long ago).
 */
export function StatusHistoryList({ entries, recipientName }: { entries: DeliveryStatusHistoryEntry[]; recipientName: string }) {
  return (
    <View>
      {entries.map((entry, i) => {
        const color = TONE_FG[statusTone(entry.toStatus)];
        return (
          <View
            key={entry.id}
            style={[styles.row, i < entries.length - 1 && styles.divider]}
            accessibilityLabel={`${recipientName}, ${statusLabel(entry.toStatus)}, ${formatDateTime(entry.createdAt)}`}
          >
            <View style={[styles.dot, { backgroundColor: color }]} />
            <View style={styles.main}>
              <Text style={styles.name} numberOfLines={1}>
                {recipientName}
              </Text>
              <Text style={[styles.status, { color }]}>{statusLabel(entry.toStatus)}</Text>
              {entry.reason ? <Text style={styles.reason}>{entry.reason}</Text> : null}
            </View>
            <View style={styles.when}>
              <Text style={styles.time}>{formatDateTime(entry.createdAt)}</Text>
              <Text style={styles.ago}>{formatRelativeTime(entry.createdAt)}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, paddingVertical: spacing.md },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.divider },
  dot: { width: 10, height: 10, borderRadius: 5, marginTop: 6 },
  main: { flex: 1, gap: 2 },
  name: { ...typography.bodyStrong, color: colors.textPrimary },
  status: { ...typography.body },
  reason: { ...typography.caption, color: colors.textSecondary },
  when: { alignItems: "flex-end", gap: 2 },
  time: { ...typography.caption, color: colors.textPrimary },
  ago: { ...typography.caption, color: colors.textSecondary }
});

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../../theme/colors";
import { radius, spacing } from "../../theme/spacing";
import { typography } from "../../theme/typography";
import { SyncItem, syncSummary } from "../../utils/syncStatus";
import { formatDateTime } from "../../utils/formatting";
import { statusLabel } from "../../utils/status";

interface Props {
  items: readonly SyncItem[];
  isOnline: boolean;
  /** The list below is the copy saved on the phone, not the server's current one. */
  fromCache: boolean;
  /** Recipient name for a delivery id, when the phone has it. */
  nameOf: (deliveryId: string) => string | undefined;
  onOpenSync: () => void;
}

/**
 * The top of History: whether the phone is online, whether the list is the saved copy, and every change that has not yet
 * reached the server (waiting to sync, or refused with a reason). Nothing the postman did disappears without a word.
 */
export function HistorySyncSection({ items, isOnline, fromCache, nameOf, onOpenSync }: Props) {
  if (isOnline && !fromCache && items.length === 0) return null;
  return (
    <View style={styles.wrap} testID="history-sync">
      {!isOnline || fromCache ? (
        <Text style={styles.notice}>
          {!isOnline ? "You are offline." : "Showing the copy saved on this phone."} {fromCache ? "This is the history as it was when you last had a connection." : ""}
        </Text>
      ) : null}
      {items.length > 0 ? (
        <Pressable onPress={onOpenSync} accessibilityRole="button" accessibilityLabel={`${syncSummary(items)}. Open offline sync`} style={styles.card}>
          <Text style={styles.title}>Not on the server yet</Text>
          <Text style={styles.caption}>{syncSummary(items)}</Text>
          {items.slice(0, 5).map((item) => (
            <View key={`${item.deliveryId}-${item.state}`} style={styles.row}>
              <Text style={styles.name} numberOfLines={1}>{nameOf(item.deliveryId) ?? "A delivery"}</Text>
              <Text style={item.state === "CONFLICT" ? styles.conflict : styles.queued}>
                {item.state === "CONFLICT" ? "Conflict" : "Waiting to sync"}
              </Text>
              <Text style={styles.caption}>
                {statusLabel(item.status)} \u00b7 {formatDateTime(item.at)}
                {item.hasPhoto ? " \u00b7 photo saved" : ""}
                {item.state === "CONFLICT" && item.reason ? `\n${item.reason}` : item.state === "CONFLICT" && item.serverStatus ? `\nThe server says: ${statusLabel(item.serverStatus)}` : ""}
              </Text>
            </View>
          ))}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm, marginBottom: spacing.md },
  notice: { ...typography.caption, color: colors.textSecondary, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.xs },
  title: { ...typography.bodyStrong, color: colors.textPrimary },
  caption: { ...typography.caption, color: colors.textSecondary },
  row: { gap: 2, paddingTop: spacing.sm },
  name: { ...typography.bodyStrong, color: colors.textPrimary },
  queued: { ...typography.label, color: colors.warning },
  conflict: { ...typography.label, color: colors.danger }
});

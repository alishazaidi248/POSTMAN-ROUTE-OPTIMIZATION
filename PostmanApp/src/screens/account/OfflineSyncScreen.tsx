import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useOfflineSync } from "../../hooks/useOfflineSync";
import { useOfflineStore } from "../../store/offlineStore";
import { Icon } from "../../components/common/Icon";
import { PrimaryButton } from "../../components/common/PrimaryButton";
import { colors } from "../../theme/colors";
import { radius, spacing } from "../../theme/spacing";
import { typography } from "../../theme/typography";
import { formatRelativeTime } from "../../utils/formatting";
import { statusLabel } from "../../utils/status";

/**
 * What is waiting to reach the server. A delivery you update with no signal is kept on the phone and sent
 * automatically when you are back online; this screen shows that queue and lets you send it now.
 */
export function OfflineSyncScreen() {
  const { isOnline, queueLength, conflicts, clearConflict, sync } = useOfflineSync();
  const queue = useOfflineStore((s) => s.queue);
  const isSyncing = useOfflineStore((s) => s.isSyncing);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <View style={styles.statusRow}>
          <Icon name={isOnline ? "check" : "offline"} size={22} color={isOnline ? colors.success : colors.warning} />
          <View style={styles.statusText}>
            <Text style={styles.title}>{isOnline ? "You are online" : "You are offline"}</Text>
            <Text style={styles.caption}>
              {isOnline
                ? queueLength === 0
                  ? "Everything is up to date."
                  : `${queueLength} update${queueLength === 1 ? "" : "s"} waiting to be sent.`
                : "Updates are saved on this phone and sent when you are back online."}
            </Text>
          </View>
        </View>
        {queueLength > 0 && isOnline ? <PrimaryButton label="Sync now" onPress={() => void sync()} loading={isSyncing} /> : null}
      </View>

      {queue.length > 0 ? (
        <View style={styles.card}>
          <Text style={styles.eyebrow}>Waiting to sync</Text>
          {queue.map((item) => (
            <View key={item.id} style={styles.row}>
              <Text style={styles.rowTitle}>{statusLabel(item.status)}</Text>
              <Text style={styles.caption}>Saved {formatRelativeTime(item.queuedAt)}{item.attempts > 0 ? ` · tried ${item.attempts} time${item.attempts === 1 ? "" : "s"}` : ""}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {conflicts.length > 0 ? (
        <View style={styles.card}>
          <Text style={styles.eyebrow}>Could not be applied</Text>
          {conflicts.map((c) => (
            <View key={c.deliveryId} style={styles.row}>
              <Text style={styles.rowTitle}>{statusLabel(c.attemptedStatus)} was not applied</Text>
              <Text style={styles.caption}>The delivery is now &ldquo;{statusLabel(c.serverStatus)}&rdquo; on the server.</Text>
              <Text style={styles.link} onPress={() => clearConflict(c.deliveryId)} accessibilityRole="button">Dismiss</Text>
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.md },
  statusRow: { flexDirection: "row", gap: spacing.md, alignItems: "center" },
  statusText: { flex: 1, gap: 2 },
  title: { ...typography.sectionTitle, color: colors.textPrimary },
  caption: { ...typography.caption, color: colors.textSecondary },
  eyebrow: { ...typography.label, color: colors.textSecondary },
  row: { gap: 2, paddingVertical: spacing.xs },
  rowTitle: { ...typography.bodyStrong, color: colors.textPrimary },
  link: { ...typography.caption, color: colors.primary, fontWeight: "600", paddingVertical: spacing.xs }
});

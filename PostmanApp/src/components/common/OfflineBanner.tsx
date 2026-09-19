import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors } from "../../theme/colors";
import { spacing } from "../../theme/spacing";
import { typography } from "../../theme/typography";

interface Props {
  isOnline: boolean;
  queueLength: number;
}

export function OfflineBanner({ isOnline, queueLength }: Props) {
  if (isOnline && queueLength === 0) return null;

  const message = !isOnline
    ? "You're offline. Showing the latest available data."
    : `Syncing ${queueLength} update${queueLength === 1 ? "" : "s"}...`;

  return (
    <View style={[styles.banner, !isOnline ? styles.offline : styles.syncing]} accessibilityLiveRegion="polite">
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, alignItems: "center" },
  offline: { backgroundColor: colors.neutralBg },
  syncing: { backgroundColor: colors.infoBg },
  text: { ...typography.caption, color: colors.textPrimary }
});

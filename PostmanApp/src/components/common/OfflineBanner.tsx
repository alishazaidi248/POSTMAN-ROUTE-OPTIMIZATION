import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors } from "../../theme/colors";
import { radius, spacing } from "../../theme/spacing";
import { typography } from "../../theme/typography";
import { Icon } from "./Icon";

interface Props {
  isOnline: boolean;
  queueLength: number;
}

export function OfflineBanner({ isOnline, queueLength }: Props) {
  if (isOnline && queueLength === 0) return null;

  const message = !isOnline
    ? queueLength > 0
      ? `You are offline. ${queueLength} update${queueLength === 1 ? " is" : "s are"} saved and will be sent when you are back online.`
      : "You are offline. Showing the latest available data."
    : `Sending ${queueLength} update${queueLength === 1 ? "" : "s"}...`;

  return (
    <View style={[styles.banner, !isOnline ? styles.offline : styles.syncing]} accessibilityLiveRegion="polite">
      <Icon name={isOnline ? "sync" : "offline"} size={16} color={!isOnline ? colors.warning : colors.info} />
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.md, marginHorizontal: spacing.sm, marginTop: spacing.sm },
  offline: { backgroundColor: colors.warningBg },
  syncing: { backgroundColor: colors.infoBg },
  text: { ...typography.caption, color: colors.textPrimary, flex: 1 }
});

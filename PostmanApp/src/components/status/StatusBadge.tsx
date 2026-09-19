import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, StatusTone } from "../../theme/colors";
import { radius, spacing } from "../../theme/spacing";
import { typography } from "../../theme/typography";
import { DeliveryStatus } from "../../types/delivery";
import { statusLabel, statusTone } from "../../utils/status";

const TONE_BG: Record<StatusTone, string> = {
  success: colors.successBg,
  warning: colors.warningBg,
  danger: colors.dangerBg,
  info: colors.infoBg,
  neutral: colors.neutralBg
};

const TONE_FG: Record<StatusTone, string> = {
  success: colors.success,
  warning: colors.warning,
  danger: colors.danger,
  info: colors.info,
  neutral: colors.neutral
};

export function StatusBadge({ status }: { status: DeliveryStatus }) {
  const tone = statusTone(status);
  return (
    <View
      style={[styles.badge, { backgroundColor: TONE_BG[tone] }]}
      accessibilityLabel={`Status: ${statusLabel(status)}`}
    >
      <Text style={[styles.text, { color: TONE_FG[tone] }]}>{statusLabel(status)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { paddingVertical: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: radius.pill, alignSelf: "flex-start" },
  text: { ...typography.label, textTransform: "none" }
});

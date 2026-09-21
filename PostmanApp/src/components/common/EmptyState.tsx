import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors } from "../../theme/colors";
import { spacing } from "../../theme/spacing";
import { typography } from "../../theme/typography";
import { Icon } from "./Icon";

interface Props {
  title: string;
  message?: string;
}

export function EmptyState({ title, message }: Props) {
  return (
    <View style={styles.container}>
      <View style={styles.icon}>
        <Icon name="package" size={26} color={colors.textDisabled} />
      </View>
      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xxl, gap: spacing.sm },
  icon: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.neutralBg, alignItems: "center", justifyContent: "center", marginBottom: spacing.xs },
  title: { ...typography.sectionTitle, color: colors.textPrimary, textAlign: "center" },
  message: { ...typography.body, color: colors.textSecondary, textAlign: "center" }
});

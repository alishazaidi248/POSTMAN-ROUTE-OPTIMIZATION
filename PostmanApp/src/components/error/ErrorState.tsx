import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors } from "../../theme/colors";
import { radius, spacing } from "../../theme/spacing";
import { typography } from "../../theme/typography";
import { Icon } from "../common/Icon";
import { PrimaryButton } from "../common/PrimaryButton";

interface Props {
  title?: string;
  message: string;
  onRetry?: () => void;
}

// A generic, user-safe error surface. Callers pass a plain-language message; raw backend errors and stack
// traces must never reach here.
export function ErrorState({ title = "Something went wrong", message, onRetry }: Props) {
  return (
    <View style={styles.container} accessibilityRole="alert">
      <View style={styles.icon}>
        <Icon name="alert" size={26} color={colors.danger} />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      {onRetry ? <PrimaryButton label="Try Again" onPress={onRetry} style={styles.button} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xxl, gap: spacing.sm, backgroundColor: colors.background },
  icon: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.dangerBg, alignItems: "center", justifyContent: "center", marginBottom: spacing.xs },
  title: { ...typography.sectionTitle, color: colors.textPrimary, textAlign: "center" },
  message: { ...typography.body, color: colors.textSecondary, textAlign: "center" },
  button: { marginTop: spacing.md, minWidth: 160, borderRadius: radius.md }
});

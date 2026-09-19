import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors } from "../../theme/colors";
import { spacing } from "../../theme/spacing";
import { typography } from "../../theme/typography";
import { PrimaryButton } from "../common/PrimaryButton";

interface Props {
  title?: string;
  message: string;
  onRetry?: () => void;
}

// A generic, user-safe error surface. Callers pass a plain-language
// message; raw backend errors/stack traces must never reach here (spec §27).
export function ErrorState({ title = "Something went wrong", message, onRetry }: Props) {
  return (
    <View style={styles.container} accessibilityRole="alert">
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      {onRetry ? <PrimaryButton label="Try Again" onPress={onRetry} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  title: { ...typography.sectionTitle, color: colors.textPrimary },
  message: { ...typography.body, color: colors.textSecondary, textAlign: "center" }
});

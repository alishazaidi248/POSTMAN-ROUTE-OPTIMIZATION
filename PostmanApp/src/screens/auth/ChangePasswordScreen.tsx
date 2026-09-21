import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useAuthStore } from "../../store/authStore";
import { colors } from "../../theme/colors";
import { radius, spacing } from "../../theme/spacing";
import { typography } from "../../theme/typography";
import { PrimaryButton } from "../../components/common/PrimaryButton";

/**
 * Shown instead of the app while the account still has the temporary password an administrator set. The password rules are
 * the server's - it says what is wrong; this screen only asks for the two passwords and that the new one is typed twice.
 */
export function ChangePasswordScreen() {
  const changePassword = useAuthStore((s) => s.changePassword);
  const logout = useAuthStore((s) => s.logout);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    if (next !== again) {
      setError("The two new passwords are not the same.");
      return;
    }
    setBusy(true);
    try {
      await changePassword(current, next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The password could not be changed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView style={styles.flex} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Choose a new password</Text>
        <Text style={styles.subtitle}>You are using a temporary password. Choose your own to continue.</Text>
        <View style={styles.form}>
          <Text style={styles.label}>Temporary password</Text>
          <TextInput style={styles.input} value={current} onChangeText={setCurrent} secureTextEntry autoCapitalize="none" accessibilityLabel="Temporary password" />
          <Text style={styles.label}>New password</Text>
          <TextInput style={styles.input} value={next} onChangeText={setNext} secureTextEntry autoCapitalize="none" accessibilityLabel="New password" />
          <Text style={styles.label}>New password again</Text>
          <TextInput style={styles.input} value={again} onChangeText={setAgain} secureTextEntry autoCapitalize="none" accessibilityLabel="New password again" onSubmitEditing={() => void submit()} />
          {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
          <PrimaryButton label="Save new password" onPress={() => void submit()} loading={busy} disabled={!current || !next || !again} />
          <Text style={styles.link} onPress={() => void logout()} accessibilityRole="button">Sign out</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { flexGrow: 1, justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  title: { ...typography.title, color: colors.textPrimary },
  subtitle: { ...typography.body, color: colors.textSecondary },
  form: { gap: spacing.sm, marginTop: spacing.lg },
  label: { ...typography.label, color: colors.textSecondary },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, ...typography.body, color: colors.textPrimary },
  error: { ...typography.caption, color: colors.danger },
  link: { ...typography.bodyStrong, color: colors.primary, textAlign: "center", paddingVertical: spacing.md }
});

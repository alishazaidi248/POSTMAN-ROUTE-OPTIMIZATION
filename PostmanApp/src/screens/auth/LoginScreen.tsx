import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuthStore } from "../../store/authStore";
import { loginSchema, LoginFormValues } from "../../utils/validation";
import { colors } from "../../theme/colors";
import { radius, spacing } from "../../theme/spacing";
import { typography } from "../../theme/typography";
import { Icon } from "../../components/common/Icon";
import { PrimaryButton } from "../../components/common/PrimaryButton";

export function LoginScreen() {
  const login = useAuthStore((s) => s.login);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const {
    control,
    handleSubmit,
    formState: { errors }
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" }
  });

  const onSubmit = async (values: LoginFormValues) => {
    setSubmitError(null);
    setSubmitting(true);
    try {
      await login(values);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "We could not sign you in. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView style={styles.flex} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.brand}>
          <View style={styles.mark}>
            <Icon name="package" size={30} color={colors.onPrimary} />
          </View>
          <Text style={styles.title}>Postman App</Text>
          <Text style={styles.subtitle}>Sign in to see today&rsquo;s deliveries.</Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.label}>Email</Text>
          <Controller
            control={control}
            name="email"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                style={[styles.input, errors.email && styles.inputError]}
                value={value}
                onChangeText={onChange}
                onBlur={onBlur}
                placeholder="you@postal.local"
                placeholderTextColor={colors.textDisabled}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="emailAddress"
                accessibilityLabel="Email"
              />
            )}
          />
          {errors.email ? <Text style={styles.fieldError}>{errors.email.message}</Text> : null}

          <Text style={[styles.label, styles.spacedLabel]}>Password</Text>
          <View style={[styles.passwordRow, errors.password && styles.inputError]}>
            <Controller
              control={control}
              name="password"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInput
                  style={styles.passwordInput}
                  value={value}
                  onChangeText={onChange}
                  onBlur={onBlur}
                  placeholder="Password"
                  placeholderTextColor={colors.textDisabled}
                  secureTextEntry={!showPassword}
                  textContentType="password"
                  accessibilityLabel="Password"
                  onSubmitEditing={handleSubmit(onSubmit)}
                />
              )}
            />
            <Pressable onPress={() => setShowPassword((v) => !v)} hitSlop={8} accessibilityRole="button" accessibilityLabel={showPassword ? "Hide password" : "Show password"}>
              <Text style={styles.toggle}>{showPassword ? "Hide" : "Show"}</Text>
            </Pressable>
          </View>
          {errors.password ? <Text style={styles.fieldError}>{errors.password.message}</Text> : null}

          {submitError ? (
            <View style={styles.errorBox} accessibilityRole="alert">
              <Text style={styles.submitError}>{submitError}</Text>
            </View>
          ) : null}

          <PrimaryButton label="Sign In" onPress={handleSubmit(onSubmit)} loading={submitting} style={styles.button} />
        </View>

        <Text style={styles.help}>Need help signing in? Ask your post office administrator.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { flexGrow: 1, justifyContent: "center", padding: spacing.xl, gap: spacing.xl, maxWidth: 460, width: "100%", alignSelf: "center" },
  brand: { alignItems: "center", gap: spacing.sm },
  mark: { width: 64, height: 64, borderRadius: 18, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  title: { ...typography.display, color: colors.textPrimary, marginTop: spacing.xs },
  subtitle: { ...typography.body, color: colors.textSecondary, textAlign: "center" },
  form: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.xl, gap: spacing.xs },
  label: { ...typography.label, color: colors.textSecondary },
  spacedLabel: { marginTop: spacing.md },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: 50,
    backgroundColor: colors.background,
    color: colors.textPrimary,
    ...typography.body
  },
  inputError: { borderColor: colors.danger },
  passwordRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: 50,
    backgroundColor: colors.background
  },
  passwordInput: { flex: 1, color: colors.textPrimary, ...typography.body, minHeight: 48 },
  toggle: { ...typography.caption, color: colors.primary, fontWeight: "600" },
  fieldError: { ...typography.caption, color: colors.danger },
  errorBox: { backgroundColor: colors.dangerBg, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.sm },
  submitError: { ...typography.caption, color: colors.danger },
  button: { marginTop: spacing.lg },
  help: { ...typography.caption, color: colors.textSecondary, textAlign: "center" }
});

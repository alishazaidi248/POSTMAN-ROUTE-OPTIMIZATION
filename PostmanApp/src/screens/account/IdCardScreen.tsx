import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { postmanApi } from "../../api/postmanApi";
import { useAuthStore } from "../../store/authStore";
import { LoadingState } from "../../components/loading/LoadingState";
import { ErrorState } from "../../components/error/ErrorState";
import { colors } from "../../theme/colors";
import { radius, spacing } from "../../theme/spacing";
import { typography } from "../../theme/typography";

/**
 * On-screen ID card built entirely from the postman's own backend-verified
 * profile — no scannable code is rendered, since this app has no backend
 * support for issuing/validating one and a fake barcode/QR would imply a
 * capability that doesn't exist (spec §49: don't fabricate functionality).
 * This is a display aid for field identification, not a security credential.
 */
export function IdCardScreen() {
  const user = useAuthStore((s) => s.user);
  const profileQuery = useQuery({ queryKey: ["postmanProfile"], queryFn: () => postmanApi.getProfile() });

  if (profileQuery.isLoading) return <LoadingState message="Loading ID card..." />;
  if (profileQuery.isError || !profileQuery.data) {
    return <ErrorState message="Unable to load your ID card. Try again." onRetry={() => profileQuery.refetch()} />;
  }

  const { postman, beat } = profileQuery.data;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Postal Delivery Service</Text>
          <Text style={styles.headerSubtitle}>Postman Identity Card</Text>
        </View>

        <View style={styles.body}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{postman.name.charAt(0)}</Text>
          </View>

          <Text style={styles.name}>{postman.name}</Text>
          <Text style={styles.role}>POSTMAN</Text>

          <View style={styles.divider} />

          <Field label="Employee ID" value={postman.employeeId} />
          <Field label="Phone" value={postman.phone} />
          <Field label="Beat" value={beat ? `${beat.beatNumber} · ${beat.name}` : "Unassigned"} />
          <Field label="Status" value={postman.status} />
          {user?.email ? <Field label="Login" value={user.email} /> : null}
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Valid only while the holder is an active employee. This card is generated from live account data and
            carries no independent authority — verify identity through your post office if in doubt.
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, alignItems: "center" },
  card: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden"
  },
  header: { backgroundColor: colors.primary, padding: spacing.lg, alignItems: "center", gap: 2 },
  headerTitle: { ...typography.bodyStrong, color: colors.onPrimary },
  headerSubtitle: { ...typography.caption, color: colors.onPrimary },
  body: { padding: spacing.lg, alignItems: "center", gap: spacing.xs },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm
  },
  avatarText: { ...typography.screenTitle, color: colors.onPrimary },
  name: { ...typography.sectionTitle, color: colors.textPrimary },
  role: { ...typography.label, color: colors.primary },
  divider: { height: 1, backgroundColor: colors.border, width: "100%", marginVertical: spacing.md },
  fieldRow: { flexDirection: "row", justifyContent: "space-between", width: "100%", paddingVertical: 6 },
  fieldLabel: { ...typography.caption, color: colors.textSecondary },
  fieldValue: { ...typography.bodyStrong, color: colors.textPrimary },
  footer: { backgroundColor: colors.neutralBg, padding: spacing.md },
  footerText: { ...typography.caption, color: colors.textSecondary, textAlign: "center" }
});

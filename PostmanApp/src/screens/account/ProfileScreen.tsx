import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { postmanApi } from "../../api/postmanApi";
import { LoadingState } from "../../components/loading/LoadingState";
import { ErrorState } from "../../components/error/ErrorState";
import { colors } from "../../theme/colors";
import { radius, spacing } from "../../theme/spacing";
import { typography } from "../../theme/typography";
import { formatRelativeTime } from "../../utils/formatting";

// Read-only: postman profile fields are admin-controlled (spec §21) — this
// app has no endpoint to edit them, so it never offers to.
export function ProfileScreen() {
  const profileQuery = useQuery({ queryKey: ["postmanProfile"], queryFn: () => postmanApi.getProfile() });

  if (profileQuery.isLoading) return <LoadingState message="Loading profile..." />;
  if (profileQuery.isError || !profileQuery.data) {
    return <ErrorState message="Unable to load your profile. Try again." onRetry={() => profileQuery.refetch()} />;
  }

  const { postman, beat, lastKnownLocation } = profileQuery.data;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Field label="Name" value={postman.name} />
      <Field label="Employee ID" value={postman.employeeId} />
      <Field label="Phone" value={postman.phone} />
      <Field label="Email" value={postman.email ?? "—"} />
      <Field label="Status" value={postman.status} />
      <Field label="Assigned Beat" value={beat ? `${beat.beatNumber} · ${beat.name}` : "None"} />
      <Field
        label="Last Known Location"
        value={
          lastKnownLocation
            ? `${lastKnownLocation.latitude.toFixed(5)}, ${lastKnownLocation.longitude.toFixed(5)} (${formatRelativeTime(lastKnownLocation.recordedAt)})`
            : "No location recorded yet"
        }
      />
      <Text style={styles.note}>Profile details are managed by your post office admin.</Text>
    </ScrollView>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.md },
  field: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: 2 },
  label: { ...typography.label, color: colors.textSecondary },
  value: { ...typography.bodyStrong, color: colors.textPrimary },
  note: { ...typography.caption, color: colors.textDisabled, textAlign: "center", marginTop: spacing.sm }
});

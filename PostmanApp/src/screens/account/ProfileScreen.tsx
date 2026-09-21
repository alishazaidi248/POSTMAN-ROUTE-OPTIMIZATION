import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { AccountStackParamList } from "../../navigation/types";
import { usePostmanProfile } from "../../hooks/usePostmanProfile";
import { useDeliveryStats } from "../../hooks/useDeliveries";
import { Avatar } from "../../components/common/Avatar";
import { Icon } from "../../components/common/Icon";
import { LoadingState } from "../../components/loading/LoadingState";
import { ErrorState } from "../../components/error/ErrorState";
import { colors } from "../../theme/colors";
import { radius, spacing } from "../../theme/spacing";
import { typography } from "../../theme/typography";
import { formatRelativeTime } from "../../utils/formatting";

type Nav = NativeStackNavigationProp<AccountStackParamList, "Profile">;

const STATUS_LABEL = { ACTIVE: "Active", ON_LEAVE: "On leave", INACTIVE: "Inactive" } as const;

// Read-only: profile details and the photo are managed by the post office administrator, so the app has
// no way to edit them and never offers to.
export function ProfileScreen() {
  const navigation = useNavigation<Nav>();
  const profileQuery = usePostmanProfile();
  const statsQuery = useDeliveryStats();

  if (profileQuery.isLoading) return <LoadingState message="Loading profile..." />;
  if (profileQuery.isError || !profileQuery.data) {
    return <ErrorState message="We could not load your profile. Check your connection and try again." onRetry={() => void profileQuery.refetch()} />;
  }

  const { postman, beat, postOffice, lastKnownLocation } = profileQuery.data;
  const today = statsQuery.data?.today;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.identity}>
        <Avatar name={postman.name} photoUrl={postman.profilePhotoUrl} size={96} />
        <Text style={styles.name}>{postman.name}</Text>
        <Text style={styles.meta}>{postman.employeeId}</Text>
        <View style={[styles.status, postman.status !== "ACTIVE" && styles.statusMuted]}>
          <Text style={[styles.statusText, postman.status !== "ACTIVE" && styles.statusTextMuted]}>● {STATUS_LABEL[postman.status]}</Text>
        </View>
      </View>

      {today ? (
        <View style={styles.numbers}>
          <Metric value={today.total} label="Today" />
          <Metric value={today.completed} label="Completed" />
          <Metric value={today.remaining} label="Remaining" />
        </View>
      ) : null}

      <View style={styles.card}>
        <Field label="Assigned beat" value={beat ? `${beat.beatNumber} — ${beat.name}` : "None"} />
        <Field label="Post office" value={postOffice?.name ?? "—"} />
        <Field label="Phone" value={postman.phone} />
        <Field label="Email" value={postman.email ?? "—"} />
        <Field
          label="Last seen"
          value={lastKnownLocation ? formatRelativeTime(lastKnownLocation.recordedAt) : "No location recorded yet"}
          last
        />
      </View>

      <Pressable style={({ pressed }) => [styles.link, pressed && styles.pressed]} onPress={() => navigation.navigate("IdCard")} accessibilityRole="button" accessibilityLabel="ID Card">
        <Text style={styles.linkText}>View ID Card</Text>
        <Icon name="chevron" size={18} color={colors.textDisabled} />
      </Pressable>

      <Text style={styles.note}>Your details and photo are managed by your post office administrator.</Text>
    </ScrollView>
  );
}

function Metric({ value, label }: { value: number; label: string }) {
  return (
    <View style={styles.number}>
      <Text style={styles.numberValue}>{value}</Text>
      <Text style={styles.numberLabel}>{label}</Text>
    </View>
  );
}

function Field({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.field, !last && styles.fieldDivider]}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  identity: { alignItems: "center", gap: 3, paddingVertical: spacing.sm },
  name: { ...typography.screenTitle, color: colors.textPrimary, marginTop: spacing.sm },
  meta: { ...typography.caption, color: colors.textSecondary },
  status: { marginTop: spacing.xs, backgroundColor: colors.successBg, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 3 },
  statusMuted: { backgroundColor: colors.neutralBg },
  statusText: { ...typography.caption, color: colors.success, fontWeight: "600" },
  statusTextMuted: { color: colors.neutral },
  numbers: { flexDirection: "row", backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border },
  number: { flex: 1, alignItems: "center", paddingVertical: spacing.md },
  numberValue: { ...typography.screenTitle, color: colors.textPrimary },
  numberLabel: { ...typography.caption, color: colors.textSecondary },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.lg },
  field: { paddingVertical: spacing.md, gap: 2 },
  fieldDivider: { borderBottomWidth: 1, borderBottomColor: colors.divider },
  label: { ...typography.label, color: colors.textSecondary },
  value: { ...typography.body, color: colors.textPrimary },
  link: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.lg, minHeight: 52 },
  linkText: { ...typography.body, color: colors.textPrimary },
  pressed: { backgroundColor: colors.background },
  note: { ...typography.caption, color: colors.textDisabled, textAlign: "center" }
});

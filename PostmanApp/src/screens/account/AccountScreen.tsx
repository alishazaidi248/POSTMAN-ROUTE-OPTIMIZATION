import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import Constants from "expo-constants";
import { AccountStackParamList } from "../../navigation/types";
import { postmanApi } from "../../api/postmanApi";
import { useAuthStore } from "../../store/authStore";
import { LoadingState } from "../../components/loading/LoadingState";
import { ErrorState } from "../../components/error/ErrorState";
import { colors } from "../../theme/colors";
import { radius, spacing } from "../../theme/spacing";
import { typography } from "../../theme/typography";
import { PrimaryButton } from "../../components/common/PrimaryButton";
import { confirmAction } from "../../utils/alerts";

type Nav = NativeStackNavigationProp<AccountStackParamList, "AccountHome">;

export function AccountScreen() {
  const navigation = useNavigation<Nav>();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const statsQuery = useQuery({ queryKey: ["deliveryStats"], queryFn: () => postmanApi.getStats() });
  const profileQuery = useQuery({ queryKey: ["postmanProfile"], queryFn: () => postmanApi.getProfile() });

  if (profileQuery.isLoading) return <LoadingState message="Loading your profile..." />;
  if (profileQuery.isError || !profileQuery.data) {
    return <ErrorState message="Unable to load your profile. Try again." onRetry={() => profileQuery.refetch()} />;
  }

  const { postman, beat } = profileQuery.data;

  const handleLogout = async () => {
    const confirmed = await confirmAction("Log out", "Are you sure you want to log out?", "Log Out");
    if (confirmed) {
      await logout();
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.headerCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{postman.name.charAt(0)}</Text>
        </View>
        <View style={styles.headerText}>
          <Text style={styles.name}>{postman.name}</Text>
          <Text style={styles.caption}>{postman.employeeId}</Text>
          <Text style={styles.caption}>{beat ? `${beat.beatNumber} · ${beat.name}` : "No beat assigned"}</Text>
        </View>
      </View>

      {statsQuery.data ? (
        <View style={styles.statsCard}>
          <Text style={styles.sectionTitle}>Today</Text>
          <View style={styles.statsRow}>
            <Stat label="Completed" value={statsQuery.data.today.completed} />
            <Stat label="Pending" value={statsQuery.data.today.remaining} />
            <Stat label="Failed" value={statsQuery.data.today.failed} />
            <Stat label="Rate" value={`${Math.round(statsQuery.data.completionRate * 100)}%`} />
          </View>
        </View>
      ) : null}

      <View style={styles.list}>
        <ListItem label="ID Card" onPress={() => navigation.navigate("IdCard")} />
        <ListItem label="Profile" onPress={() => navigation.navigate("Profile")} />
        <ListItem label="Settings" onPress={() => navigation.navigate("Settings")} />
      </View>

      <PrimaryButton label="Log Out" variant="danger" onPress={handleLogout} />

      <Text style={styles.version}>
        App version {Constants.expoConfig?.version ?? "1.0.0"} · User: {user?.email}
      </Text>
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.caption}>{label}</Text>
    </View>
  );
}

function ListItem({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.listItem} accessibilityRole="button" accessibilityLabel={label}>
      <Text style={styles.listItemText}>{label}</Text>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xxl },
  headerCard: { flexDirection: "row", gap: spacing.md, alignItems: "center", backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  avatarText: { ...typography.screenTitle, color: colors.onPrimary },
  headerText: { flex: 1, gap: 2 },
  name: { ...typography.sectionTitle, color: colors.textPrimary },
  caption: { ...typography.caption, color: colors.textSecondary },
  statsCard: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.sm },
  sectionTitle: { ...typography.label, color: colors.textSecondary },
  statsRow: { flexDirection: "row", justifyContent: "space-between" },
  stat: { alignItems: "center", gap: 2 },
  statValue: { ...typography.sectionTitle, color: colors.textPrimary },
  list: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  listItem: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing.md, minHeight: 48, borderBottomWidth: 1, borderBottomColor: colors.border },
  listItemText: { ...typography.body, color: colors.textPrimary },
  chevron: { ...typography.sectionTitle, color: colors.textDisabled },
  version: { ...typography.caption, color: colors.textDisabled, textAlign: "center" }
});

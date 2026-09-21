import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { AccountStackParamList } from "../../navigation/types";
import { usePostmanProfile } from "../../hooks/usePostmanProfile";
import { useRefreshStaleOnFocus } from "../../hooks/useRefreshStaleOnFocus";
import { useOfflineSync } from "../../hooks/useOfflineSync";
import { useAuthStore } from "../../store/authStore";
import { Avatar } from "../../components/common/Avatar";
import { Icon, IconName } from "../../components/common/Icon";
import { LoadingState } from "../../components/loading/LoadingState";
import { ErrorState } from "../../components/error/ErrorState";
import { PrimaryButton } from "../../components/common/PrimaryButton";
import { colors } from "../../theme/colors";
import { radius, spacing } from "../../theme/spacing";
import { typography } from "../../theme/typography";
import { confirmAction } from "../../utils/alerts";

type Nav = NativeStackNavigationProp<AccountStackParamList, "AccountHome">;

const REFRESH_ON_FOCUS = [["postmanProfile"], ["deliveryStats"]] as const;

export function AccountScreen() {
  const navigation = useNavigation<Nav>();
  useRefreshStaleOnFocus(REFRESH_ON_FOCUS);
  const logout = useAuthStore((s) => s.logout);
  const profileQuery = usePostmanProfile();
  const { queueLength, isOnline } = useOfflineSync();

  if (profileQuery.isLoading) return <LoadingState message="Loading your profile..." />;
  if (profileQuery.isError || !profileQuery.data) {
    return <ErrorState message="We could not load your profile. Check your connection and try again." onRetry={() => void profileQuery.refetch()} />;
  }

  const { postman, beat, postOffice } = profileQuery.data;

  const handleLogout = async () => {
    const confirmed = await confirmAction("Log out", "Are you sure you want to log out?", "Log Out");
    if (confirmed) await logout();
  };

  const syncNote = !isOnline ? "Offline" : queueLength > 0 ? `${queueLength} waiting` : undefined;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.identity}>
        <Avatar name={postman.name} photoUrl={postman.profilePhotoUrl} size={88} />
        <Text style={styles.name}>{postman.name}</Text>
        <Text style={styles.meta}>{postman.employeeId}</Text>
        <Text style={styles.meta}>{beat ? `${beat.beatNumber} — ${beat.name}` : "No beat assigned"}</Text>
        {postOffice ? <Text style={styles.meta}>{postOffice.name}</Text> : null}
      </View>

      <View style={styles.list}>
        <Row icon="user" label="Profile" onPress={() => navigation.navigate("Profile")} />
        <Row icon="bell" label="Notifications" onPress={() => navigation.navigate("Notifications")} />
        <Row icon="sync" label="Offline Sync" note={syncNote} onPress={() => navigation.navigate("OfflineSync")} />
        <Row icon="info" label="App Information" onPress={() => navigation.navigate("Settings")} last />
      </View>

      <PrimaryButton label="Log Out" variant="secondary" onPress={handleLogout} />
    </ScrollView>
  );
}

function Row({ icon, label, note, onPress, last }: { icon: IconName; label: string; note?: string; onPress: () => void; last?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, !last && styles.rowDivider, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={label}>
      <View style={styles.rowIcon}>
        <Icon name={icon} size={20} color={colors.textSecondary} />
      </View>
      <Text style={styles.rowLabel}>{label}</Text>
      {note ? <Text style={styles.rowNote}>{note}</Text> : null}
      <Icon name="chevron" size={18} color={colors.textDisabled} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  identity: { alignItems: "center", gap: 3, paddingVertical: spacing.md },
  name: { ...typography.screenTitle, color: colors.textPrimary, marginTop: spacing.sm },
  meta: { ...typography.caption, color: colors.textSecondary },
  list: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, minHeight: 56 },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: colors.divider },
  rowIcon: { width: 28, alignItems: "center" },
  rowLabel: { ...typography.body, color: colors.textPrimary, flex: 1 },
  rowNote: { ...typography.caption, color: colors.warning },
  pressed: { backgroundColor: colors.background }
});

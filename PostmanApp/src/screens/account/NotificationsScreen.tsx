import React from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppNotification, notificationApi } from "../../api/notificationApi";
import { EmptyState } from "../../components/common/EmptyState";
import { ErrorState } from "../../components/error/ErrorState";
import { LoadingState } from "../../components/loading/LoadingState";
import { colors } from "../../theme/colors";
import { radius, spacing } from "../../theme/spacing";
import { typography } from "../../theme/typography";
import { formatRelativeTime } from "../../utils/formatting";

const TONE = {
  INFO: { bg: colors.infoBg, fg: colors.info },
  WARNING: { bg: colors.warningBg, fg: colors.warning },
  CRITICAL: { bg: colors.dangerBg, fg: colors.danger }
} as const;

/** Messages from your post office. Unread ones are marked; tapping one marks it read. */
export function NotificationsScreen() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["notifications"], queryFn: () => notificationApi.list(), staleTime: 30_000 });
  const markRead = useMutation({
    mutationFn: (id: string) => notificationApi.markRead(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] })
  });
  const markAll = useMutation({
    mutationFn: () => notificationApi.markAllRead(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] })
  });

  if (query.isLoading) return <LoadingState message="Loading notifications..." />;
  if (query.isError || !query.data) {
    return <ErrorState message="We could not load your notifications. Check your connection and try again." onRetry={() => void query.refetch()} />;
  }

  const unread = query.data.filter((n) => !n.readAt).length;

  return (
    <View style={styles.container}>
      {unread > 0 ? (
        <Pressable onPress={() => markAll.mutate()} style={styles.markAll} accessibilityRole="button" accessibilityLabel="Mark all as read">
          <Text style={styles.markAllText}>Mark all as read ({unread})</Text>
        </Pressable>
      ) : null}
      <FlatList
        data={query.data}
        keyExtractor={(n) => n.id}
        style={styles.list}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} />}
        ListEmptyComponent={<EmptyState title="No notifications" message="Messages from your post office will appear here." />}
        renderItem={({ item }) => <Row item={item} onPress={() => !item.readAt && markRead.mutate(item.id)} />}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
      />
    </View>
  );
}

function Row({ item, onPress }: { item: AppNotification; onPress: () => void }) {
  const tone = TONE[item.severity];
  return (
    <Pressable onPress={onPress} style={[styles.row, !item.readAt && styles.unread]} accessibilityRole="button" accessibilityLabel={item.title ?? item.message}>
      <View style={[styles.tag, { backgroundColor: tone.bg }]}>
        <Text style={[styles.tagText, { color: tone.fg }]}>{item.severity === "CRITICAL" ? "Urgent" : item.severity === "WARNING" ? "Notice" : "Info"}</Text>
      </View>
      {item.title ? <Text style={styles.title}>{item.title}</Text> : null}
      <Text style={styles.message}>{item.message}</Text>
      <Text style={styles.time}>{formatRelativeTime(item.createdAt)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  list: { flex: 1 },
  content: { padding: spacing.lg, flexGrow: 1 },
  markAll: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, alignItems: "flex-end" },
  markAllText: { ...typography.caption, color: colors.primary, fontWeight: "600" },
  row: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.xs },
  unread: { borderLeftWidth: 4, borderLeftColor: colors.primary },
  tag: { alignSelf: "flex-start", borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  tagText: { ...typography.caption, fontWeight: "600" },
  title: { ...typography.bodyStrong, color: colors.textPrimary },
  message: { ...typography.body, color: colors.textPrimary },
  time: { ...typography.caption, color: colors.textSecondary }
});

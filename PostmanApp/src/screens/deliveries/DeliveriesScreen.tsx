import React, { useMemo, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { DeliveriesStackParamList } from "../../navigation/types";
import { useDeliveries, useDeliveryStats } from "../../hooks/useDeliveries";
import { useOfflineSync } from "../../hooks/useOfflineSync";
import { DeliveryCard } from "../../components/delivery/DeliveryCard";
import { FilterChips } from "../../components/delivery/FilterChips";
import { LoadingState } from "../../components/loading/LoadingState";
import { ErrorState } from "../../components/error/ErrorState";
import { EmptyState } from "../../components/common/EmptyState";
import { OfflineBanner } from "../../components/common/OfflineBanner";
import { colors } from "../../theme/colors";
import { spacing } from "../../theme/spacing";
import { typography } from "../../theme/typography";
import { formatDate } from "../../utils/formatting";
import { matchesFilter } from "../../utils/status";
import { DeliveryFilter } from "../../types/delivery";
import { useAuthStore } from "../../store/authStore";

type Nav = NativeStackNavigationProp<DeliveriesStackParamList, "DeliveriesList">;

export function DeliveriesScreen() {
  const navigation = useNavigation<Nav>();
  const [filter, setFilter] = useState<DeliveryFilter>("ALL");
  const deliveriesQuery = useDeliveries();
  const statsQuery = useDeliveryStats();
  const { isOnline, queueLength } = useOfflineSync();
  const user = useAuthStore((s) => s.user);

  const filteredRows = useMemo(
    () => (deliveriesQuery.data?.rows ?? []).filter((d) => matchesFilter(d.status, filter)),
    [deliveriesQuery.data, filter]
  );

  if (deliveriesQuery.isLoading) {
    return <LoadingState message="Loading today's deliveries..." />;
  }

  if (deliveriesQuery.isError && !deliveriesQuery.data) {
    return (
      <ErrorState
        message="Unable to load deliveries. Try again."
        onRetry={() => deliveriesQuery.refetch()}
      />
    );
  }

  return (
    <View style={styles.container}>
      <OfflineBanner isOnline={isOnline} queueLength={queueLength} />

      <View style={styles.header}>
        <Text style={styles.date}>{formatDate(new Date().toISOString())}</Text>
        <Text style={styles.name}>{user?.name ?? "Postman"}</Text>
        {statsQuery.data ? (
          <View style={styles.statsRow}>
            <StatChip label="Total" value={statsQuery.data.today.total} />
            <StatChip label="Completed" value={statsQuery.data.today.completed} />
            <StatChip label="Remaining" value={statsQuery.data.today.remaining} />
            <StatChip label="Failed" value={statsQuery.data.today.failed} />
          </View>
        ) : null}
      </View>

      <FilterChips value={filter} onChange={setFilter} />

      <FlatList
        data={filteredRows}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={deliveriesQuery.isRefetching} onRefresh={() => deliveriesQuery.refetch()} />
        }
        ListEmptyComponent={
          <EmptyState
            title="No deliveries assigned for today."
            message={filter !== "ALL" ? "Try a different filter." : undefined}
          />
        }
        renderItem={({ item }) => (
          <DeliveryCard delivery={item} onPress={() => navigation.navigate("DeliveryDetails", { deliveryId: item.id })} />
        )}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        initialNumToRender={12}
        windowSize={7}
        removeClippedSubviews
      />
    </View>
  );
}

function StatChip({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.statChip}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { padding: spacing.md, gap: spacing.xs, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  date: { ...typography.caption, color: colors.textSecondary },
  name: { ...typography.screenTitle, color: colors.textPrimary },
  statsRow: { flexDirection: "row", gap: spacing.lg, marginTop: spacing.sm },
  statChip: { alignItems: "center" },
  statValue: { ...typography.sectionTitle, color: colors.textPrimary },
  statLabel: { ...typography.caption, color: colors.textSecondary },
  listContent: { padding: spacing.md, flexGrow: 1 }
});

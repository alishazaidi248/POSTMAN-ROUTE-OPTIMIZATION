import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { DeliveriesStackParamList } from "../../navigation/types";
import { useDeliveries, useDeliveryStats, usePendingStatusOverrides } from "../../hooks/useDeliveries";
import { useCurrentRoute } from "../../hooks/useRoute";
import { useOfflineSync } from "../../hooks/useOfflineSync";
import { useRefreshStaleOnFocus } from "../../hooks/useRefreshStaleOnFocus";
import { DeliveryCard } from "../../components/delivery/DeliveryCard";
import { FilterChips } from "../../components/delivery/FilterChips";
import { LoadingState } from "../../components/loading/LoadingState";
import { ErrorState } from "../../components/error/ErrorState";
import { EmptyState } from "../../components/common/EmptyState";
import { OfflineBanner } from "../../components/common/OfflineBanner";
import { ConflictBanner } from "../../components/common/ConflictBanner";
import { colors } from "../../theme/colors";
import { spacing } from "../../theme/spacing";
import { typography } from "../../theme/typography";
import { formatDate, formatDurationMinutes } from "../../utils/formatting";
import { formatDistance } from "../../utils/distance";
import { matchesFilter } from "../../utils/status";
import { buildStopViews, StopView } from "../../utils/routeView";
import { DeliveryFilter } from "../../types/delivery";
import { hasRoadGeometry } from "../../types/route";
import { useRouteStore } from "../../store/routeStore";
import { SegmentedControl } from "../../components/common/SegmentedControl";
import { isPastFinished } from "../../utils/history";
import { DeliveryHistoryView } from "./DeliveryHistoryView";

type Nav = NativeStackNavigationProp<DeliveriesStackParamList, "DeliveriesList">;

const REFRESH_ON_FOCUS = [["deliveries"], ["deliveryStats"], ["route"]] as const;

function TodayDeliveries() {
  const navigation = useNavigation<Nav>();
  useRefreshStaleOnFocus(REFRESH_ON_FOCUS);
  const [filter, setFilter] = useState<DeliveryFilter>("ALL");
  const deliveriesQuery = useDeliveries();
  const routeQuery = useCurrentRoute();
  const statsQuery = useDeliveryStats();
  const overrides = usePendingStatusOverrides();
  const { isOnline, queueLength, conflicts, clearConflict } = useOfflineSync();
  const selectedId = useRouteStore((s) => s.selectedDeliveryId);
  const selectionSource = useRouteStore((s) => s.selectionSource);
  const selectDelivery = useRouteStore((s) => s.selectDelivery);
  const listRef = useRef<FlatList<StopView>>(null);

  const route = routeQuery.data ?? null;
  // Deliveries finished on an earlier day are in History; this list is today's work.
  const rows = useMemo(() => deliveriesQuery.data?.rows.filter((d) => !isPastFinished(d)), [deliveriesQuery.data]);

  // Route order first (numbered), then unrouted, then finished — see buildStopViews.
  const views = useMemo(() => buildStopViews(rows ?? [], route, overrides), [rows, route, overrides]);
  const filtered = useMemo(() => views.filter((v) => matchesFilter(v.status, filter)), [views, filter]);

  const nameById = useMemo(
    () => Object.fromEntries(views.map((v) => [v.delivery.id, v.delivery.recipient.name])),
    [views]
  );

  // A marker tapped on the Map tab expands (and scrolls to) its card here.
  useEffect(() => {
    if (!selectedId || selectionSource !== "map") return;
    const index = filtered.findIndex((v) => v.delivery.id === selectedId);
    if (index < 0) return;
    const timer = setTimeout(() => {
      try {
        listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.1 });
      } catch {
        /* row not measured yet — onScrollToIndexFailed retries */
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [selectedId, selectionSource, filtered]);

  const refresh = useCallback(() => {
    void deliveriesQuery.refetch();
    void routeQuery.refetch();
    void statsQuery.refetch();
  }, [deliveriesQuery, routeQuery, statsQuery]);

  if (deliveriesQuery.isLoading) {
    return <LoadingState message="Loading your deliveries..." />;
  }

  if (deliveriesQuery.isError && !deliveriesQuery.data) {
    return <ErrorState message="We could not load your deliveries. Check your connection and try again." onRetry={() => deliveriesQuery.refetch()} />;
  }

  const routeSummary = route
    ? [
        `${route.solution.stops.length} stop${route.solution.stops.length === 1 ? "" : "s"} to go`,
        formatDistance(route.solution.totalDistanceMeters),
        `~${formatDurationMinutes(route.solution.estimatedDurationMinutes)}`
      ].join(" · ")
    : null;

  return (
    <View style={styles.container}>
      <OfflineBanner isOnline={isOnline} queueLength={queueLength} />
      <ConflictBanner conflicts={conflicts} nameByDeliveryId={nameById} onDismiss={clearConflict} />

      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Text style={styles.date}>{formatDate(new Date().toISOString())}</Text>
          {statsQuery.data ? (
            <Text style={styles.count}>
              {statsQuery.data.today.completed} of {statsQuery.data.today.total} completed
            </Text>
          ) : null}
        </View>
        {statsQuery.data && statsQuery.data.today.total > 0 ? (
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.round((statsQuery.data.today.completed / statsQuery.data.today.total) * 100)}%` }]} />
          </View>
        ) : null}
        {routeSummary ? (
          <Text style={styles.routeLine}>
            Route: {routeSummary}
            {route && !hasRoadGeometry(route) ? " (estimated distances)" : ""}
          </Text>
        ) : null}
      </View>

      <FilterChips value={filter} onChange={setFilter} />

      <FlatList
        ref={listRef}
        data={filtered}
        keyExtractor={(item) => item.delivery.id}
        extraData={selectedId}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={deliveriesQuery.isRefetching} onRefresh={refresh} />}
        ListEmptyComponent={
          <EmptyState
            title="No deliveries for today"
            message={filter !== "ALL" ? "Try a different filter." : "New deliveries will appear here as soon as they are assigned to you."}
          />
        }
        renderItem={({ item }) => (
          <DeliveryCard
            view={item}
            expanded={selectedId === item.delivery.id}
            onToggle={() => selectDelivery(selectedId === item.delivery.id ? null : item.delivery.id, "list")}
            onOpenDetails={() => navigation.navigate("DeliveryDetails", { deliveryId: item.delivery.id })}
          />
        )}
        onScrollToIndexFailed={(info) => {
          setTimeout(() => {
            listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: true });
          }, 100);
        }}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        initialNumToRender={12}
        windowSize={7}
      />
    </View>
  );
}

type Mode = "TODAY" | "HISTORY";
const MODES = [
  { value: "TODAY", label: "Today" },
  { value: "HISTORY", label: "History" }
] as const;

/** The Deliveries tab: today's work, or the postman's past deliveries. */
export function DeliveriesScreen() {
  const [mode, setMode] = useState<Mode>("TODAY");
  return (
    <View style={styles.container}>
      <SegmentedControl value={mode} options={MODES} onChange={setMode} />
      {mode === "TODAY" ? <TodayDeliveries /> : <DeliveryHistoryView />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.xs, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  date: { ...typography.caption, color: colors.textSecondary },
  count: { ...typography.bodyStrong, color: colors.textPrimary },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.divider, overflow: "hidden", marginTop: spacing.xs },
  fill: { height: "100%", backgroundColor: colors.success, borderRadius: 3 },
  routeLine: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  // FlatList/ScrollView need an explicit `flex: 1` on `style` (not just
  // `contentContainerStyle`) on web — without it, react-native-web doesn't
  // bound the list's height, so its full content grows the whole page
  // instead of scrolling internally, pushing the bottom tab bar off-screen.
  // Native platforms are more forgiving here, which is why this only
  // surfaced on the web build.
  list: { flex: 1 },
  listContent: { padding: spacing.lg, flexGrow: 1 }
});

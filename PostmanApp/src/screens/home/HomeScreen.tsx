import React, { useMemo, useState } from "react";
import { Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { MainTabParamList } from "../../navigation/types";
import { useDeliveryStats } from "../../hooks/useDeliveries";
import { useOfflineSync } from "../../hooks/useOfflineSync";
import { usePostmanProfile } from "../../hooks/usePostmanProfile";
import { useRefreshStaleOnFocus } from "../../hooks/useRefreshStaleOnFocus";
import { useLocation } from "../../hooks/useLocation";
import { useMapScreenData } from "../map/useMapScreenData";
import { Avatar } from "../../components/common/Avatar";
import { Icon } from "../../components/common/Icon";
import { OfflineBanner } from "../../components/common/OfflineBanner";
import { ConflictBanner } from "../../components/common/ConflictBanner";
import { DeliveryCard } from "../../components/delivery/DeliveryCard";
import { LoadingState } from "../../components/loading/LoadingState";
import { ErrorState } from "../../components/error/ErrorState";
import { colors } from "../../theme/colors";
import { radius, spacing } from "../../theme/spacing";
import { typography } from "../../theme/typography";
import { formatDate, formatDurationMinutes } from "../../utils/formatting";
import { formatDistance } from "../../utils/distance";
import { nearestFirst, NearbyStop } from "../../utils/nearestFirst";
import { todayCounts } from "../../utils/todayCounts";
import { StopView } from "../../utils/routeView";
import { isPastFinished } from "../../utils/history";

type Nav = BottomTabNavigationProp<MainTabParamList, "HomeTab">;
type Row = { kind: "open"; stop: NearbyStop } | { kind: "done"; view: StopView };

const REFRESH_ON_FOCUS = [["deliveries"], ["deliveryStats"], ["route"], ["postmanProfile"]] as const;

/** Good morning / afternoon / evening, from the phone's clock. */
export function greeting(date: Date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** "Ramesh Kadam" -> "Ramesh". */
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/**
 * Today at a glance, then every delivery of the day in one scrolling list: the ones still to do nearest first (from
 * the phone's location; route order when it isn't known), and what is already done below. Each card is the same as
 * on the Deliveries tab - tap to expand, Navigate, Start / Mark Delivered - so nothing behaves differently here.
 */
export function HomeScreen() {
  const navigation = useNavigation<Nav>();
  useRefreshStaleOnFocus(REFRESH_ON_FOCUS);
  const data = useMapScreenData();
  const statsQuery = useDeliveryStats();
  const profileQuery = usePostmanProfile();
  const { fix } = useLocation("ACTIVE_ROUTE");
  const { isOnline, queueLength, conflicts, clearConflict } = useOfflineSync();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const hereLat = fix?.latitude ?? null;
  const hereLng = fix?.longitude ?? null;
  const list = useMemo(
    () =>
      nearestFirst(
        // Like the Deliveries tab: something finished on an earlier day is history, not part of today.
        (data.views ?? []).filter((v) => !isPastFinished(v.delivery)),
        hereLat !== null && hereLng !== null ? { latitude: hereLat, longitude: hereLng } : null
      ),
    [data.views, hereLat, hereLng]
  );

  if (profileQuery.isLoading || data.isLoading) return <LoadingState message="Loading your day..." />;
  if (profileQuery.isError || !profileQuery.data) {
    return <ErrorState message="We could not load your details. Check your connection and try again." onRetry={() => void profileQuery.refetch()} />;
  }

  const { postman, beat } = profileQuery.data;
  const counts = todayCounts(statsQuery.data, { completed: data.doneCount, remaining: data.remaining });
  const percent = counts.total > 0 ? Math.round((counts.completed / counts.total) * 100) : 0;
  const route = data.route;

  const sections: { key: string; title: string; hint?: string; data: Row[] }[] = [];
  if (list.open.length > 0) {
    sections.push({
      key: "open",
      title: list.sortedByDistance ? "To deliver · nearest first" : "To deliver · in route order",
      hint: list.sortedByDistance ? undefined : "Turn on location to see the closest delivery first.",
      data: list.open.map((stop) => ({ kind: "open" as const, stop }))
    });
  }
  if (list.finished.length > 0) {
    sections.push({ key: "done", title: `Done today · ${list.finished.length}`, data: list.finished.map((view) => ({ kind: "done" as const, view })) });
  }

  const openDetails = (deliveryId: string) =>
    navigation.navigate("DeliveriesTab", { screen: "DeliveryDetails", params: { deliveryId } });

  const renderCard = (view: StopView, distanceFromMe?: number | null) => (
    <DeliveryCard
      view={view}
      expanded={expandedId === view.delivery.id}
      onToggle={() => setExpandedId(expandedId === view.delivery.id ? null : view.delivery.id)}
      onOpenDetails={() => openDetails(view.delivery.id)}
      distanceFromMe={distanceFromMe}
    />
  );

  return (
    <SectionList
      style={styles.container}
      contentContainerStyle={styles.content}
      sections={sections}
      keyExtractor={(row) => (row.kind === "open" ? row.stop.view.delivery.id : row.view.delivery.id)}
      stickySectionHeadersEnabled={false}
      refreshControl={
        <RefreshControl
          refreshing={data.isRefreshing}
          onRefresh={() => {
            void data.refetch();
            void statsQuery.refetch();
            void profileQuery.refetch();
          }}
        />
      }
      ListHeaderComponent={
        <View style={styles.header}>
          <OfflineBanner isOnline={isOnline} queueLength={queueLength} />
          <ConflictBanner conflicts={conflicts} nameByDeliveryId={data.recipientNameByDeliveryId} onDismiss={clearConflict} />

          <View style={styles.hello}>
            <Avatar name={postman.name} photoUrl={postman.profilePhotoUrl} size={48} />
            <View style={styles.helloText}>
              <Text style={styles.date}>{formatDate(new Date().toISOString())}</Text>
              <Text style={styles.greeting}>
                {greeting()}, {firstName(postman.name)}
              </Text>
              <Text style={styles.beat}>{beat ? `${beat.beatNumber} — ${beat.name}` : "No beat assigned yet"}</Text>
            </View>
          </View>

          <View style={styles.summary}>
            <View style={styles.summaryTop}>
              <View>
                <Text style={styles.summaryEyebrow}>Today</Text>
                <Text style={styles.summaryBig} accessibilityLabel={`${counts.remaining} deliveries to go`}>
                  {counts.remaining} to go
                </Text>
              </View>
              <View style={styles.summaryNumbers}>
                <Text style={styles.summaryValue}>
                  {counts.completed}
                  <Text style={styles.summaryOf}> / {counts.total}</Text>
                </Text>
                <Text style={styles.summaryLabel}>delivered</Text>
              </View>
            </View>
            <View style={styles.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: percent }}>
              <View style={[styles.fill, { width: `${percent}%` }]} />
            </View>
            {counts.failed > 0 ? <Text style={styles.summaryNote}>{counts.failed} could not be delivered today</Text> : null}
            <Pressable
              style={({ pressed }) => [styles.routeRow, pressed && styles.pressed]}
              onPress={() => navigation.navigate("MapTab", { screen: "MapHome" })}
              accessibilityRole="button"
              accessibilityLabel="View route"
            >
              <Icon name="route" size={18} color="#FFFFFF" />
              <Text style={styles.routeText} numberOfLines={1}>
                {route
                  ? `${formatDistance(route.solution.totalDistanceMeters)} · ~${formatDurationMinutes(route.solution.estimatedDurationMinutes)} round`
                  : "Route not ready yet"}
              </Text>
              <Text style={styles.routeLink}>View map →</Text>
            </Pressable>
          </View>

          {list.open.length === 0 ? (
            <View style={styles.doneCard}>
              <Icon name="check" size={22} color={colors.success} />
              <Text style={styles.doneText}>{counts.total > 0 ? "All done for today. Nice work." : "No deliveries assigned for today."}</Text>
            </View>
          ) : null}
        </View>
      }
      renderSectionHeader={({ section }) => (
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{section.title}</Text>
          {section.hint ? <Text style={styles.sectionHint}>{section.hint}</Text> : null}
        </View>
      )}
      renderItem={({ item }) =>
        item.kind === "open"
          ? // Only a list sorted by distance shows "350 m away"; in route order the card keeps "from the previous stop".
            renderCard(item.stop.view, list.sortedByDistance ? item.stop.distanceMeters : undefined)
          : renderCard(item.view)
      }
      ItemSeparatorComponent={() => <View style={styles.separator} />}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  header: { gap: spacing.md, marginBottom: spacing.xs },
  hello: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingTop: spacing.sm },
  helloText: { flex: 1, gap: 1 },
  date: { ...typography.caption, color: colors.textSecondary },
  greeting: { ...typography.screenTitle, color: colors.textPrimary },
  beat: { ...typography.caption, color: colors.textSecondary },
  summary: { backgroundColor: colors.primary, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  summaryTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  summaryEyebrow: { ...typography.label, color: "#F7D4D6" },
  summaryBig: { fontSize: 30, fontWeight: "700", color: colors.onPrimary },
  summaryNumbers: { alignItems: "flex-end" },
  summaryValue: { fontSize: 22, fontWeight: "700", color: colors.onPrimary },
  summaryOf: { fontSize: 16, fontWeight: "500", color: "#F7D4D6" },
  summaryLabel: { ...typography.caption, color: "#F7D4D6" },
  summaryNote: { ...typography.caption, color: "#FFE3A3" },
  track: { height: 8, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.25)", overflow: "hidden" },
  fill: { height: "100%", backgroundColor: colors.onPrimary, borderRadius: 4 },
  routeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: "rgba(0,0,0,0.16)",
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: 44
  },
  routeText: { ...typography.caption, color: colors.onPrimary, flex: 1 },
  routeLink: { ...typography.caption, color: colors.onPrimary, fontWeight: "700" },
  pressed: { opacity: 0.85 },
  doneCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.successBg,
    borderRadius: radius.lg,
    padding: spacing.lg
  },
  doneText: { ...typography.bodyStrong, color: colors.textPrimary, flex: 1 },
  sectionHeader: { paddingTop: spacing.lg, paddingBottom: spacing.sm, gap: 2 },
  sectionTitle: { ...typography.label, color: colors.textSecondary },
  sectionHint: { ...typography.caption, color: colors.textSecondary },
  separator: { height: spacing.md }
});

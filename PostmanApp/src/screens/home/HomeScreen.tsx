import React from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { MainTabParamList } from "../../navigation/types";
import { useDeliveryStats } from "../../hooks/useDeliveries";
import { useOfflineSync } from "../../hooks/useOfflineSync";
import { usePostmanProfile } from "../../hooks/usePostmanProfile";
import { useRefreshStaleOnFocus } from "../../hooks/useRefreshStaleOnFocus";
import { useMapScreenData } from "../map/useMapScreenData";
import { Avatar } from "../../components/common/Avatar";
import { Icon } from "../../components/common/Icon";
import { OfflineBanner } from "../../components/common/OfflineBanner";
import { ConflictBanner } from "../../components/common/ConflictBanner";
import { DeliveryActionBar } from "../../components/delivery/DeliveryActionBar";
import { LoadingState } from "../../components/loading/LoadingState";
import { ErrorState } from "../../components/error/ErrorState";
import { StatusBadge } from "../../components/status/StatusBadge";
import { colors } from "../../theme/colors";
import { radius, spacing } from "../../theme/spacing";
import { typography } from "../../theme/typography";
import { formatAddressShort, formatDate, formatDurationMinutes, formatTime } from "../../utils/formatting";
import { formatDistance } from "../../utils/distance";
import { legLabel } from "../../utils/routeView";

type Nav = BottomTabNavigationProp<MainTabParamList, "HomeTab">;

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
 * Today at a glance: who I am, how much is done, what is next (with Navigate and Start Delivery), and a way
 * into the route. Everything comes from the same server data as the other tabs - nothing is worked out here.
 */
export function HomeScreen() {
  const navigation = useNavigation<Nav>();
  useRefreshStaleOnFocus(REFRESH_ON_FOCUS);
  const data = useMapScreenData();
  const statsQuery = useDeliveryStats();
  const profileQuery = usePostmanProfile();
  const { isOnline, queueLength, conflicts, clearConflict } = useOfflineSync();

  if (profileQuery.isLoading || data.isLoading) return <LoadingState message="Loading your day..." />;
  if (profileQuery.isError || !profileQuery.data) {
    return <ErrorState message="We could not load your details. Check your connection and try again." onRetry={() => void profileQuery.refetch()} />;
  }

  const { postman, beat } = profileQuery.data;
  const today = statsQuery.data?.today;
  const total = today?.total ?? data.total;
  const completed = today?.completed ?? data.doneCount;
  const remaining = today?.remaining ?? data.remaining;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  const next = data.next;
  const route = data.route;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
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
    >
      <OfflineBanner isOnline={isOnline} queueLength={queueLength} />
      <ConflictBanner conflicts={conflicts} nameByDeliveryId={data.recipientNameByDeliveryId} onDismiss={clearConflict} />

      <View style={styles.hello}>
        <Avatar name={postman.name} photoUrl={postman.profilePhotoUrl} size={52} />
        <View style={styles.helloText}>
          <Text style={styles.date}>{formatDate(new Date().toISOString())}</Text>
          <Text style={styles.greeting}>
            {greeting()}, {firstName(postman.name)}
          </Text>
          <Text style={styles.beat}>{beat ? `${beat.beatNumber} — ${beat.name}` : "No beat assigned yet"}</Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.eyebrow}>Today</Text>
        <Text style={styles.big} accessibilityLabel={`${total} deliveries today`}>
          {total} {total === 1 ? "Delivery" : "Deliveries"}
        </Text>
        <View style={styles.numbers}>
          <View>
            <Text style={styles.numberValue}>{completed}</Text>
            <Text style={styles.numberLabel}>Completed</Text>
          </View>
          <View>
            <Text style={styles.numberValue}>{remaining}</Text>
            <Text style={styles.numberLabel}>Remaining</Text>
          </View>
        </View>
        <View style={styles.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: percent }}>
          <View style={[styles.fill, { width: `${percent}%` }]} />
        </View>
      </View>

      <Text style={styles.eyebrowOutside}>Next delivery</Text>
      {next ? (
        <View style={[styles.card, styles.nextCard]}>
          <View style={styles.nextTop}>
            <Text style={styles.stop}>Stop {next.sequence ?? "—"}</Text>
            <StatusBadge status={next.status} />
          </View>
          <Text style={styles.recipient}>{next.delivery.recipient.name}</Text>
          <Text style={styles.address}>{formatAddressShort(next.delivery.address)}</Text>
          <View style={styles.metaRow}>
            {legLabel(next) ? (
              <View style={styles.meta}>
                <Icon name="navigate" size={15} color={colors.textSecondary} />
                <Text style={styles.metaText}>{legLabel(next)}</Text>
              </View>
            ) : null}
            {next.eta ? (
              <View style={styles.meta}>
                <Icon name="clock" size={15} color={colors.textSecondary} />
                <Text style={styles.metaText}>ETA {formatTime(next.eta)}</Text>
              </View>
            ) : null}
          </View>
          <DeliveryActionBar delivery={next.delivery} status={next.status} latitude={next.latitude} longitude={next.longitude} />
        </View>
      ) : (
        <View style={styles.card}>
          <View style={styles.doneRow}>
            <Icon name="check" size={22} color={colors.success} />
            <Text style={styles.doneText}>{total > 0 ? "All done for today. Nice work." : "No deliveries assigned for today."}</Text>
          </View>
        </View>
      )}

      <Pressable
        style={({ pressed }) => [styles.card, styles.routeRow, pressed && styles.pressed]}
        onPress={() => navigation.navigate("MapTab", { screen: "MapHome" })}
        accessibilityRole="button"
        accessibilityLabel="View route"
      >
        <View style={styles.routeIcon}>
          <Icon name="route" size={20} color={colors.primary} />
        </View>
        <View style={styles.routeText}>
          <Text style={styles.routeTitle}>Today&rsquo;s Route</Text>
          <Text style={styles.metaText}>
            {route
              ? `${remaining} to go · ${formatDistance(route.solution.totalDistanceMeters)} · ~${formatDurationMinutes(route.solution.estimatedDurationMinutes)}`
              : "Route not ready yet"}
          </Text>
        </View>
        <Text style={styles.viewRoute}>View Route →</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  hello: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm },
  helloText: { flex: 1, gap: 1 },
  date: { ...typography.caption, color: colors.textSecondary },
  greeting: { ...typography.screenTitle, color: colors.textPrimary },
  beat: { ...typography.caption, color: colors.textSecondary },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.sm },
  eyebrow: { ...typography.label, color: colors.textSecondary },
  eyebrowOutside: { ...typography.label, color: colors.textSecondary, marginTop: spacing.sm, marginLeft: 2 },
  big: { ...typography.display, color: colors.textPrimary },
  numbers: { flexDirection: "row", gap: spacing.xxl, marginTop: spacing.xs },
  numberValue: { ...typography.sectionTitle, color: colors.textPrimary },
  numberLabel: { ...typography.caption, color: colors.textSecondary },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.divider, overflow: "hidden", marginTop: spacing.xs },
  fill: { height: "100%", backgroundColor: colors.success, borderRadius: 4 },
  nextCard: { gap: spacing.sm },
  nextTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  stop: { ...typography.label, color: colors.mapCurrent },
  recipient: { ...typography.sectionTitle, color: colors.textPrimary },
  address: { ...typography.body, color: colors.textSecondary },
  metaRow: { flexDirection: "row", gap: spacing.lg, flexWrap: "wrap", marginBottom: spacing.xs },
  meta: { flexDirection: "row", alignItems: "center", gap: 6 },
  metaText: { ...typography.caption, color: colors.textSecondary },
  doneRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  doneText: { ...typography.bodyStrong, color: colors.textPrimary, flex: 1 },
  routeRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, minHeight: 64 },
  routeIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  routeText: { flex: 1, gap: 2 },
  routeTitle: { ...typography.bodyStrong, color: colors.textPrimary },
  viewRoute: { ...typography.caption, color: colors.primary, fontWeight: "600" },
  pressed: { opacity: 0.85 }
});

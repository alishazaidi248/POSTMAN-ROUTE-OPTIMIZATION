import React, { useMemo, useState } from "react";
import { ActivityIndicator, SectionList, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { DeliveriesStackParamList } from "../../navigation/types";
import { useDeliveryHistory } from "../../hooks/useDeliveryHistory";
import { ChipRow } from "../../components/common/ChipRow";
import { EmptyState } from "../../components/common/EmptyState";
import { PrimaryButton } from "../../components/common/PrimaryButton";
import { ErrorState } from "../../components/error/ErrorState";
import { LoadingState } from "../../components/loading/LoadingState";
import { HistoryRow } from "../../components/delivery/HistoryRow";
import { colors } from "../../theme/colors";
import { spacing } from "../../theme/spacing";
import { typography } from "../../theme/typography";
import { HistoryOutcome } from "../../types/delivery";
import { daySummary, groupByDay } from "../../utils/history";

type Nav = NativeStackNavigationProp<DeliveriesStackParamList, "DeliveriesList">;

const PERIODS = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "ALL", label: "All time" }
] as const;
type Period = (typeof PERIODS)[number]["value"];

/**
 * The postman's past work: every delivery they finished (delivered, or sent back) before today, newest day first.
 * Today's work stays on the Today tab.
 */
export function DeliveryHistoryView() {
  const navigation = useNavigation<Nav>();
  const [period, setPeriod] = useState<Period>("30");
  const [outcome, setOutcome] = useState<HistoryOutcome>("ALL");
  const history = useDeliveryHistory(period === "ALL" ? null : Number(period), outcome);

  const sections = useMemo(() => groupByDay(history.rows), [history.rows]);
  const { delivered, returned } = history.summary;
  const outcomes = useMemo(
    () => [
      { value: "ALL" as const, label: `All (${delivered + returned})` },
      { value: "DELIVERED" as const, label: `Delivered (${delivered})` },
      { value: "RETURNED" as const, label: `Returned (${returned})` }
    ],
    [delivered, returned]
  );

  const filters = (
    <View style={styles.filters}>
      <ChipRow value={period} options={PERIODS} onChange={setPeriod} accessibilityPrefix="Period" />
      <ChipRow value={outcome} options={outcomes} onChange={setOutcome} accessibilityPrefix="Outcome" />
    </View>
  );

  if (history.isLoading) return <LoadingState message="Loading your past deliveries..." />;
  if (history.isError && history.rows.length === 0) {
    return (
      <View style={styles.container}>
        {filters}
        <ErrorState message="We could not load your past deliveries. Check your connection and try again." onRetry={() => history.refetch()} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {filters}
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        stickySectionHeadersEnabled={false}
        refreshing={history.isRefetching && !history.isFetchingNextPage}
        onRefresh={() => void history.refetch()}
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (history.hasNextPage && !history.isFetchingNextPage) void history.fetchNextPage();
        }}
        ListEmptyComponent={
          <EmptyState
            title="No past deliveries yet"
            message={period === "ALL" && outcome === "ALL" ? "Deliveries you finish appear here from the next day on." : "Nothing finished in this period. Try a longer period or another filter."}
          />
        }
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader} accessibilityRole="header">
            <Text style={styles.sectionTitle}>{section.label}</Text>
            <Text style={styles.sectionCount}>{daySummary(section)}</Text>
          </View>
        )}
        renderItem={({ item }) => <HistoryRow delivery={item} onPress={() => navigation.navigate("DeliveryDetails", { deliveryId: item.id })} />}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        ListFooterComponent={
          history.hasNextPage ? (
            <View style={styles.footer}>
              {history.isFetchingNextPage ? <ActivityIndicator color={colors.primary} /> : <PrimaryButton label="Load more" onPress={() => void history.fetchNextPage()} />}
            </View>
          ) : sections.length > 0 ? (
            <Text style={styles.end}>
              {history.total} past deliver{history.total === 1 ? "y" : "ies"} shown
            </Text>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  filters: { backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  // flex: 1 on the list itself: without it react-native-web lets the list grow the page and pushes the tab bar off screen.
  list: { flex: 1 },
  listContent: { padding: spacing.lg, flexGrow: 1 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", paddingTop: spacing.md, paddingBottom: spacing.sm },
  sectionTitle: { ...typography.label, color: colors.textPrimary },
  sectionCount: { ...typography.caption, color: colors.textSecondary },
  footer: { paddingVertical: spacing.lg, alignItems: "center" },
  end: { ...typography.caption, color: colors.textSecondary, textAlign: "center", paddingVertical: spacing.lg }
});

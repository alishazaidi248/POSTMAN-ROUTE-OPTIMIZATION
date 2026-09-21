import React, { useMemo, useState } from "react";
import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { RouteProp, useRoute } from "@react-navigation/native";
import { DeliveriesStackParamList } from "../../navigation/types";
import { useDeliveries, useDelivery, usePendingStatusOverrides, useUpdateDeliveryStatus } from "../../hooks/useDeliveries";
import { useCurrentRoute } from "../../hooks/useRoute";
import { useLocation } from "../../hooks/useLocation";
import { LoadingState } from "../../components/loading/LoadingState";
import { ErrorState } from "../../components/error/ErrorState";
import { StatusBadge } from "../../components/status/StatusBadge";
import { StatusActionButtons } from "../../components/status/StatusActionButtons";
import { ReasonModal } from "../../components/status/ReasonModal";
import { DeliveryActionBar } from "../../components/delivery/DeliveryActionBar";
import { colors } from "../../theme/colors";
import { radius, spacing } from "../../theme/spacing";
import { typography } from "../../theme/typography";
import { formatAddressLines, formatTime } from "../../utils/formatting";
import { isCallablePhoneNumber } from "../../utils/validation";
import { statusLabel } from "../../utils/status";
import { buildStopViews, legLabel } from "../../utils/routeView";
import { StatusHistoryList } from "../../components/delivery/StatusHistoryList";
import { PrimaryButton } from "../../components/common/PrimaryButton";
import { notify } from "../../utils/alerts";
import { DeliveryStatus } from "../../types/delivery";

type DetailsRoute = RouteProp<DeliveriesStackParamList, "DeliveryDetails">;

/**
 * One delivery, in sections: who it is for, where it goes, what it is, where it sits on today's route, and what
 * to do next. The route information is read from the backend's route (never worked out here).
 */
export function DeliveryDetailsScreen() {
  const { params } = useRoute<DetailsRoute>();
  const deliveryQuery = useDelivery(params.deliveryId);
  const listQuery = useDeliveries();
  const routeQuery = useCurrentRoute();
  const overrides = usePendingStatusOverrides();
  const updateStatus = useUpdateDeliveryStatus();
  const { fix } = useLocation("ACTIVE_ROUTE");
  const [pendingStatus, setPendingStatus] = useState<DeliveryStatus | null>(null);

  const delivery = deliveryQuery.data;
  const rows = listQuery.data?.rows;
  const route = routeQuery.data ?? null;

  // The same view the Deliveries list uses, so the stop number, distance and arrival time agree with it.
  const view = useMemo(() => {
    if (!delivery) return null;
    const source = rows?.some((r) => r.id === delivery.id) ? (rows ?? []) : [delivery];
    return buildStopViews(source, route, overrides).find((v) => v.delivery.id === delivery.id) ?? null;
  }, [delivery, rows, route, overrides]);

  if (deliveryQuery.isLoading) return <LoadingState message="Loading delivery..." />;
  if (deliveryQuery.isError || !delivery) {
    return <ErrorState message="We could not load this delivery. Check your connection and try again." onRetry={() => void deliveryQuery.refetch()} />;
  }

  const status = view?.status ?? delivery.status;
  const total = rows ? buildStopViews(rows, route, overrides).filter((v) => v.sequence !== null).length : 0;

  const handleSelect = (next: DeliveryStatus, needsReason: boolean) => {
    if (needsReason) {
      setPendingStatus(next);
      return;
    }
    submit(next);
  };

  const submit = (next: DeliveryStatus, reason?: string) => {
    updateStatus.mutate(
      { deliveryId: delivery.id, status: next, reason, latitude: fix?.latitude, longitude: fix?.longitude },
      {
        onSuccess: (result) => {
          setPendingStatus(null);
          // No client-side re-plan: the server refreshes the route itself when the delivery set changes.
          if (result.queued) notify("Saved offline", "This update will sync automatically when you are back online.");
        },
        onError: (err) => notify("Could not update the status", err instanceof Error ? err.message : "Please try again.")
      }
    );
  };

  const handleCall = () => {
    const phone = delivery.recipient.phone;
    if (!isCallablePhoneNumber(phone)) {
      notify("No phone number", "This recipient has no phone number on file.");
      return;
    }
    void Linking.openURL(`tel:${phone}`);
  };

  const leg = view ? legLabel(view) : null;
  const finalStatus = status === "DELIVERED" || status === "RETURNED" || status === "CANCELLED";

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>Recipient</Text>
        <View style={styles.rowBetween}>
          <Text style={styles.name}>{delivery.recipient.name}</Text>
          <StatusBadge status={status} />
        </View>
        <Text style={styles.body}>{delivery.recipient.phone ?? "No phone number on file"}</Text>
        <PrimaryButton label="Call Recipient" variant="secondary" onPress={handleCall} />
      </View>

      <View style={styles.card}>
        <Text style={styles.eyebrow}>Address</Text>
        {formatAddressLines(delivery.address).map((line) => (
          <Text key={line} style={styles.body}>{line}</Text>
        ))}
        <Text style={styles.caption}>Pincode {delivery.address.pincode}</Text>
        {view && view.latitude !== null ? null : <Text style={styles.caption}>This address has no map location yet, so directions are not available.</Text>}
      </View>

      <View style={styles.card}>
        <Text style={styles.eyebrow}>Delivery information</Text>
        <InfoRow label="Parcels" value={`${delivery.parcelCount}${delivery.parcelType ? ` · ${delivery.parcelType}` : ""}`} />
        <InfoRow label="Priority" value={delivery.priority.charAt(0) + delivery.priority.slice(1).toLowerCase()} />
        <InfoRow label="Status" value={statusLabel(status)} />
        <InfoRow label="Tracking ID" value={delivery.trackingId} />
        {delivery.beat ? <InfoRow label="Beat" value={delivery.beat.beatNumber} last /> : null}
      </View>

      {view && view.sequence !== null ? (
        <View style={styles.card}>
          <Text style={styles.eyebrow}>Route information</Text>
          <InfoRow label="Stop" value={total > 0 ? `${view.sequence} of ${total}` : String(view.sequence)} />
          {leg ? <InfoRow label="From previous stop" value={leg} /> : null}
          {view.eta && view.state !== "DONE" ? <InfoRow label="Estimated arrival" value={formatTime(view.eta)} last /> : null}
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.eyebrow}>Actions</Text>
        <DeliveryActionBar delivery={delivery} status={status} latitude={view?.latitude ?? null} longitude={view?.longitude ?? null} />
        <StatusActionButtons currentStatus={status} submitting={updateStatus.isPending} onSelect={handleSelect} hidePrimary />
        {finalStatus && !updateStatus.isPending ? <Text style={styles.caption}>No further changes are available for this delivery.</Text> : null}
      </View>

      {delivery.statusHistory && delivery.statusHistory.length > 0 ? (
        <View style={styles.card}>
          <Text style={styles.eyebrow}>History</Text>
          <StatusHistoryList entries={delivery.statusHistory} recipientName={delivery.recipient.name} />
        </View>
      ) : null}

      <ReasonModal
        visible={pendingStatus !== null}
        targetStatus={pendingStatus}
        submitting={updateStatus.isPending}
        onCancel={() => setPendingStatus(null)}
        onConfirm={(reason) => pendingStatus && submit(pendingStatus, reason || undefined)}
      />
    </ScrollView>
  );
}

function InfoRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.infoRow, !last && styles.infoDivider]}>
      <Text style={styles.caption}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.sm },
  eyebrow: { ...typography.label, color: colors.textSecondary },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.md },
  name: { ...typography.sectionTitle, color: colors.textPrimary, flex: 1 },
  body: { ...typography.body, color: colors.textPrimary },
  caption: { ...typography.caption, color: colors.textSecondary },
  infoRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm },
  infoDivider: { borderBottomWidth: 1, borderBottomColor: colors.divider },
  infoValue: { ...typography.bodyStrong, color: colors.textPrimary, flexShrink: 1, textAlign: "right" }
});

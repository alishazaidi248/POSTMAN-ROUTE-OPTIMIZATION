import React, { useState } from "react";
import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { RouteProp, useRoute } from "@react-navigation/native";
import { DeliveriesStackParamList } from "../../navigation/types";
import { useDelivery, useUpdateDeliveryStatus } from "../../hooks/useDeliveries";
import { useReoptimizeRoute } from "../../hooks/useRoute";
import { useLocation } from "../../hooks/useLocation";
import { LoadingState } from "../../components/loading/LoadingState";
import { ErrorState } from "../../components/error/ErrorState";
import { StatusBadge } from "../../components/status/StatusBadge";
import { StatusActionButtons } from "../../components/status/StatusActionButtons";
import { ReasonModal } from "../../components/status/ReasonModal";
import { colors } from "../../theme/colors";
import { spacing } from "../../theme/spacing";
import { typography } from "../../theme/typography";
import { formatAddress, formatRelativeTime } from "../../utils/formatting";
import { isCallablePhoneNumber } from "../../utils/validation";
import { PrimaryButton } from "../../components/common/PrimaryButton";
import { notify } from "../../utils/alerts";
import { DeliveryStatus } from "../../types/delivery";
import { ReoptimizeTrigger } from "../../types/route";

type DetailsRoute = RouteProp<DeliveriesStackParamList, "DeliveryDetails">;

// Delivery status transitions that mean the delivery is off this postman's
// remaining route and worth asking the backend to re-plan around (spec §17).
const REOPTIMIZE_ON: Partial<Record<DeliveryStatus, ReoptimizeTrigger>> = {
  DELIVERED: "DELIVERY_COMPLETED",
  RECIPIENT_UNAVAILABLE: "RECIPIENT_UNAVAILABLE",
  WRONG_ADDRESS: "WRONG_ADDRESS",
  ADDRESS_NOT_FOUND: "ADDRESS_NOT_FOUND",
  FAILED: "DELIVERY_FAILED"
};

export function DeliveryDetailsScreen() {
  const { params } = useRoute<DetailsRoute>();
  const deliveryQuery = useDelivery(params.deliveryId);
  const updateStatus = useUpdateDeliveryStatus();
  const reoptimize = useReoptimizeRoute();
  const { fix } = useLocation("ACTIVE_ROUTE");
  const [pendingStatus, setPendingStatus] = useState<DeliveryStatus | null>(null);

  if (deliveryQuery.isLoading) {
    return <LoadingState message="Loading delivery..." />;
  }

  if (deliveryQuery.isError || !deliveryQuery.data) {
    return <ErrorState message="Unable to load this delivery. Try again." onRetry={() => deliveryQuery.refetch()} />;
  }

  const delivery = deliveryQuery.data;

  const handleSelect = (next: DeliveryStatus, needsReason: boolean) => {
    if (needsReason) {
      setPendingStatus(next);
      return;
    }
    submit(next);
  };

  const submit = (next: DeliveryStatus, reason?: string) => {
    updateStatus.mutate(
      {
        deliveryId: delivery.id,
        status: next,
        reason,
        latitude: fix?.latitude,
        longitude: fix?.longitude
      },
      {
        onSuccess: (result) => {
          setPendingStatus(null);
          if (result.queued) {
            notify("Saved offline", "This update will sync automatically when you're back online.");
            return;
          }
          const trigger = REOPTIMIZE_ON[next];
          if (trigger) {
            reoptimize.mutate(trigger);
          }
        },
        onError: (err) => {
          notify("Couldn't update status", err instanceof Error ? err.message : "Please try again.");
        }
      }
    );
  };

  const handleCall = () => {
    const phone = delivery.recipient.phone;
    if (!isCallablePhoneNumber(phone)) {
      notify("No phone number", "This recipient has no phone number on file.");
      return;
    }
    Linking.openURL(`tel:${phone}`);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.section}>
        <View style={styles.rowBetween}>
          <Text style={styles.name}>{delivery.recipient.name}</Text>
          <StatusBadge status={delivery.status} />
        </View>
        <Text style={styles.tracking}>#{delivery.trackingId}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Address</Text>
        <Text style={styles.value}>{formatAddress(delivery.address)}</Text>
        {delivery.address.latitude && delivery.address.longitude ? (
          <Text style={styles.caption}>
            {delivery.address.latitude.toFixed(5)}, {delivery.address.longitude.toFixed(5)}
          </Text>
        ) : (
          <Text style={styles.caption}>No coordinates on file</Text>
        )}
      </View>

      <View style={styles.row}>
        <PrimaryButton label="Call Recipient" variant="secondary" onPress={handleCall} />
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Delivery Info</Text>
        <InfoRow label="Priority" value={delivery.priority} />
        <InfoRow label="Parcel Type" value={delivery.parcelType ?? "—"} />
        <InfoRow label="Parcel Count" value={String(delivery.parcelCount)} />
        {delivery.beat ? <InfoRow label="Beat" value={delivery.beat.beatNumber} /> : null}
      </View>

      {delivery.statusHistory && delivery.statusHistory.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.label}>History</Text>
          {delivery.statusHistory.map((entry) => (
            <View key={entry.id} style={styles.historyRow}>
              <Text style={styles.historyStatus}>{entry.toStatus}</Text>
              <Text style={styles.caption}>{formatRelativeTime(entry.createdAt)}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.label}>Update Status</Text>
        <StatusActionButtons currentStatus={delivery.status} submitting={updateStatus.isPending} onSelect={handleSelect} />
        {updateStatus.isPending ? null : allowedCountNotice(delivery.status)}
      </View>

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

function allowedCountNotice(status: DeliveryStatus) {
  return status === "DELIVERED" || status === "RETURNED" || status === "CANCELLED" ? (
    <Text style={styles.caption}>No further status changes are available for this delivery.</Text>
  ) : null;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.lg, paddingBottom: spacing.xxl },
  section: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.xs },
  row: { flexDirection: "row" },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  name: { ...typography.sectionTitle, color: colors.textPrimary, flex: 1 },
  tracking: { ...typography.caption, color: colors.textSecondary },
  label: { ...typography.label, color: colors.textSecondary },
  value: { ...typography.body, color: colors.textPrimary },
  caption: { ...typography.caption, color: colors.textSecondary },
  infoRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  infoLabel: { ...typography.body, color: colors.textSecondary },
  infoValue: { ...typography.bodyStrong, color: colors.textPrimary },
  historyRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  historyStatus: { ...typography.body, color: colors.textPrimary }
});

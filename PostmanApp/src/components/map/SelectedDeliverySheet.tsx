import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { StopView, legLabel } from "../../utils/routeView";
import { formatAddressShort, formatTime } from "../../utils/formatting";
import { colors } from "../../theme/colors";
import { radius, spacing } from "../../theme/spacing";
import { typography } from "../../theme/typography";
import { StatusBadge } from "../status/StatusBadge";
import { DeliveryActionBar } from "../delivery/DeliveryActionBar";

interface Props {
  view: StopView;
  onClose: () => void;
  onOpenDetails: () => void;
}

/** The delivery picked on the map (or in the list): what/where/how far, plus the same Navigate / status buttons as the card. */
export function SelectedDeliverySheet({ view, onClose, onOpenDetails }: Props) {
  const { delivery, status } = view;
  const leg = legLabel(view);

  return (
    <View style={styles.sheet}>
      <View style={styles.headerRow}>
        <Text style={styles.title} numberOfLines={1}>
          {view.sequence !== null && view.state !== "DONE" ? `#${view.sequence}  ` : ""}
          {delivery.recipient.name}
        </Text>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" hitSlop={10}>
          <Text style={styles.close}>✕</Text>
        </Pressable>
      </View>

      <View style={styles.metaRow}>
        <StatusBadge status={status} />
        {view.queued ? <Text style={styles.queued}>Waiting to sync</Text> : null}
        {leg ? <Text style={styles.meta}>{leg}</Text> : null}
        {view.eta && view.state !== "DONE" ? <Text style={styles.meta}>ETA {formatTime(view.eta)}</Text> : null}
      </View>

      <Text style={styles.address} numberOfLines={2}>
        {formatAddressShort(delivery.address)}
      </Text>
      <Text style={styles.meta}>
        {`Parcels: ${delivery.parcelCount}${delivery.parcelType ? ` · ${delivery.parcelType}` : ""} · Priority: ${delivery.priority}`}
      </Text>

      <DeliveryActionBar delivery={delivery} status={status} latitude={view.latitude} longitude={view.longitude} />

      <Pressable onPress={onOpenDetails} accessibilityRole="link" accessibilityLabel="Open full details">
        <Text style={styles.link}>Full details &amp; other outcomes ›</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm
  },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  title: { ...typography.sectionTitle, color: colors.textPrimary, flex: 1 },
  close: { ...typography.sectionTitle, color: colors.textSecondary },
  metaRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  address: { ...typography.body, color: colors.textPrimary },
  meta: { ...typography.caption, color: colors.textSecondary },
  queued: { ...typography.caption, color: colors.warning },
  link: { ...typography.caption, color: colors.info, textAlign: "center", paddingVertical: spacing.xs }
});

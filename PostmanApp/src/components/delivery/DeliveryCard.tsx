import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { formatAddressShort, formatTime } from "../../utils/formatting";
import { legLabel, StopState, StopView } from "../../utils/routeView";
import { useDeliveryActions } from "../../hooks/useDeliveryActions";
import { colors } from "../../theme/colors";
import { radius, spacing } from "../../theme/spacing";
import { typography } from "../../theme/typography";
import { Icon } from "../common/Icon";
import { PrimaryButton } from "../common/PrimaryButton";
import { StatusBadge } from "../status/StatusBadge";
import { DeliveryActionBar } from "./DeliveryActionBar";

interface Props {
  view: StopView;
  expanded: boolean;
  /** Tap on the card: expand/collapse (and select on the map). */
  onToggle: () => void;
  /** Opens the full details screen (history, call recipient, any status). */
  onOpenDetails: () => void;
}

const BADGE_BG: Record<StopState, string> = {
  NEXT: colors.mapCurrent,
  PENDING: colors.textSecondary,
  DONE: colors.success,
  FAILED: colors.danger
};

function badgeText(view: StopView): string {
  if (view.state === "DONE") return "✓";
  if (view.state === "FAILED") return "✕";
  return view.sequence !== null ? String(view.sequence) : "•";
}

/**
 * Collapsed: stop number, status, recipient, address, distance and arrival time, and Navigate.
 * Expanded:  also phone, parcels, priority and the buttons for the next step (Start Delivery / Mark Delivered).
 * Only fields that exist on the Delivery model are shown - there is no weight or notes field, so none is invented.
 */
export function DeliveryCard({ view, expanded, onToggle, onOpenDetails }: Props) {
  const { delivery, status } = view;
  const leg = legLabel(view);
  const address = formatAddressShort(delivery.address);
  const finished = view.state === "DONE" || view.state === "FAILED";

  return (
    <View style={[styles.card, view.state === "NEXT" && styles.cardNext, expanded && styles.cardExpanded, finished && !expanded && styles.cardFinished]}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`Delivery ${view.sequence ?? ""} for ${delivery.recipient.name}, ${status}`}
        style={({ pressed }) => [styles.header, pressed && styles.pressed]}
      >
        <View style={styles.topRow}>
          <Text style={[styles.sequence, { backgroundColor: BADGE_BG[view.state] }]}>{badgeText(view)}</Text>
          {view.state === "NEXT" ? <Text style={styles.nextTag}>NEXT</Text> : null}
          {delivery.priority !== "NORMAL" ? <Text style={styles.priority}>{delivery.priority}</Text> : null}
          <View style={styles.spacer} />
          <StatusBadge status={status} />
        </View>

        <Text style={styles.name} numberOfLines={1}>
          {delivery.recipient.name}
        </Text>
        <Text style={styles.address} numberOfLines={expanded ? undefined : 2}>
          {address}
        </Text>

        <View style={styles.metaRow}>
          {leg ? (
            <View style={styles.meta}>
              <Icon name="navigate" size={14} color={colors.textSecondary} />
              <Text style={styles.metaText}>{leg}</Text>
            </View>
          ) : null}
          {view.eta && !finished ? (
            <View style={styles.meta}>
              <Icon name="clock" size={14} color={colors.textSecondary} />
              <Text style={styles.metaText}>Arrives {formatTime(view.eta)}</Text>
            </View>
          ) : null}
          {view.queued ? <Text style={styles.queued}>Waiting to sync</Text> : null}
        </View>
      </Pressable>

      {!expanded ? <CollapsedNavigate view={view} /> : null}

      {expanded ? (
        <View style={styles.body}>
          <View style={styles.grid}>
            <Field label="Phone" value={delivery.recipient.phone ?? "Not available"} />
            <Field label="Parcels" value={`${delivery.parcelCount}${delivery.parcelType ? ` · ${delivery.parcelType}` : ""}`} />
            <Field label="Priority" value={delivery.priority} />
            {view.eta && !finished ? <Field label="Est. arrival" value={formatTime(view.eta)} /> : null}
            {leg ? <Field label="From previous stop" value={leg} /> : null}
          </View>

          <Field label="Status" value={status.replace(/_/g, " ")} />
          <Field label="Tracking ID" value={delivery.trackingId} />
          {delivery.beat ? <Field label="Beat" value={delivery.beat.beatNumber} /> : null}

          <DeliveryActionBar delivery={delivery} status={status} latitude={view.latitude} longitude={view.longitude} />

          <Pressable onPress={onOpenDetails} accessibilityRole="link" accessibilityLabel="Open full details">
            <Text style={styles.detailsLink}>Full details, history &amp; other outcomes ›</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/** The one action a postman wants on the list itself: get directions to this stop. */
function CollapsedNavigate({ view }: { view: StopView }) {
  const { navigate, canNavigate } = useDeliveryActions(view.delivery, view.status, { latitude: view.latitude, longitude: view.longitude });
  if (!canNavigate) return null;
  return (
    <View style={styles.footer}>
      <PrimaryButton label="Navigate" variant="secondary" onPress={navigate} style={styles.navigateButton} accessibilityHint="Opens directions to this address in your maps app" />
    </View>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border },
  cardNext: { borderColor: colors.mapCurrent },
  cardExpanded: { borderColor: colors.textDisabled },
  cardFinished: { opacity: 0.7 },
  header: { padding: spacing.lg, gap: spacing.xs },
  pressed: { opacity: 0.85 },
  topRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: 2 },
  spacer: { flex: 1 },
  sequence: {
    ...typography.bodyStrong,
    color: colors.onPrimary,
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    textAlign: "center",
    lineHeight: 28,
    overflow: "hidden",
    paddingHorizontal: 4
  },
  nextTag: { ...typography.label, color: colors.mapCurrent },
  priority: { ...typography.label, color: colors.danger },
  name: { ...typography.sectionTitle, color: colors.textPrimary },
  address: { ...typography.body, color: colors.textSecondary },
  metaRow: { flexDirection: "row", alignItems: "center", gap: spacing.lg, flexWrap: "wrap", marginTop: 2 },
  meta: { flexDirection: "row", alignItems: "center", gap: 5 },
  metaText: { ...typography.caption, color: colors.textSecondary },
  queued: { ...typography.caption, color: colors.warning },
  footer: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  navigateButton: { minHeight: 44 },
  body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.md },
  grid: { flexDirection: "row", flexWrap: "wrap", columnGap: spacing.xl, rowGap: spacing.md },
  field: { gap: 2 },
  fieldLabel: { ...typography.label, color: colors.textSecondary },
  fieldValue: { ...typography.body, color: colors.textPrimary },
  detailsLink: { ...typography.caption, color: colors.info, textAlign: "center", paddingVertical: spacing.xs }
});

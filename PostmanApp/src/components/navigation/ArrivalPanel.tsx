import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Delivery, DeliveryStatus } from "../../types/delivery";
import { DeliveryActionBar } from "../delivery/DeliveryActionBar";
import { PrimaryButton } from "../common/PrimaryButton";
import { formatAddressShort } from "../../utils/formatting";
import { canNavigateTo } from "../../hooks/useDeliveryActions";
import { colors } from "../../theme/colors";
import { spacing } from "../../theme/spacing";
import { typography } from "../../theme/typography";

interface Props {
  delivery: Delivery;
  status: DeliveryStatus;
  onOpenDetails: () => void;
  onKeepNavigating: () => void;
  onFinish: () => void;
}

/**
 * At the door: the same Start / Mark Delivered buttons as everywhere else (with the post office's proof - photo or
 * signature - and offline queueing), the full delivery for a failed attempt, or "not here yet" when GPS jumped early.
 */
export function ArrivalPanel({ delivery, status, onOpenDetails, onKeepNavigating, onFinish }: Props) {
  const stillOpen = canNavigateTo(status);

  return (
    <View style={styles.panel} accessibilityLiveRegion="polite">
      <Text style={styles.title}>{stillOpen ? "You've arrived" : "Done here ✓"}</Text>
      <Text style={styles.name}>{delivery.recipient.name}</Text>
      <Text style={styles.address} numberOfLines={2}>
        {formatAddressShort(delivery.address)}
      </Text>
      {stillOpen ? (
        <>
          <DeliveryActionBar delivery={delivery} status={status} showNavigate={false} />
          <View style={styles.links}>
            <Pressable onPress={onOpenDetails} accessibilityRole="button" accessibilityLabel="Open delivery" style={styles.link}>
              <Text style={styles.linkText}>Open delivery</Text>
            </Pressable>
            <Pressable onPress={onKeepNavigating} accessibilityRole="button" accessibilityLabel="Not here yet" style={styles.link}>
              <Text style={styles.linkText}>Not here yet</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <PrimaryButton label="Back to my route" onPress={onFinish} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: colors.surface, padding: spacing.lg, gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  title: { ...typography.label, color: colors.success },
  name: { ...typography.sectionTitle, color: colors.textPrimary },
  address: { ...typography.body, color: colors.textSecondary },
  links: { flexDirection: "row", justifyContent: "space-between" },
  link: { paddingVertical: spacing.sm },
  linkText: { ...typography.bodyStrong, color: colors.info }
});

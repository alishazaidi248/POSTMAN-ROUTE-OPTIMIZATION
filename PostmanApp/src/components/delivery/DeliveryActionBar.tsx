import React from "react";
import { StyleSheet, View } from "react-native";
import { Delivery, DeliveryStatus } from "../../types/delivery";
import { useDeliveryActions } from "../../hooks/useDeliveryActions";
import { PrimaryButton } from "../common/PrimaryButton";
import { spacing } from "../../theme/spacing";

interface Props {
  delivery: Delivery;
  /** Effective status (includes a queued offline change). */
  status: DeliveryStatus;
  latitude: number | null;
  longitude: number | null;
}

/** [ Navigate ] [ Start Delivery | Mark Delivered ] — used on the card and the map sheet. */
export function DeliveryActionBar({ delivery, status, latitude, longitude }: Props) {
  const { primary, run, navigate, isPending, canNavigate } = useDeliveryActions(delivery, status, {
    latitude,
    longitude
  });

  if (!canNavigate && !primary) return null;

  return (
    <View style={styles.row}>
      {canNavigate ? (
        <PrimaryButton
          label="Navigate"
          variant="secondary"
          onPress={navigate}
          style={styles.button}
          accessibilityHint="Opens turn-by-turn directions to this address in your maps app"
        />
      ) : null}
      {primary ? (
        <PrimaryButton label={primary.label} onPress={run} loading={isPending} style={styles.button} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: spacing.sm },
  button: { flex: 1 }
});

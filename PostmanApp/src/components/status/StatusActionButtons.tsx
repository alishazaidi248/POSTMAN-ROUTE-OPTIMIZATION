import React from "react";
import { StyleSheet, View } from "react-native";
import { DeliveryStatus } from "../../types/delivery";
import { allowedNextStatuses, statusLabel } from "../../utils/status";
import { PrimaryButton } from "../common/PrimaryButton";
import { spacing } from "../../theme/spacing";

const ACTION_LABELS: Partial<Record<DeliveryStatus, string>> = {
  DELIVERED: "Mark Delivered",
  RECIPIENT_UNAVAILABLE: "Recipient Unavailable",
  WRONG_ADDRESS: "Wrong Address",
  ADDRESS_NOT_FOUND: "Address Not Found",
  RESCHEDULED: "Reschedule",
  FAILED: "Failed",
  OUT_FOR_DELIVERY: "Start Delivery",
  RETURNED: "Return to Office",
  CANCELLED: "Cancel"
};

// Statuses whose transition benefits from a short reason/note before
// submitting — the button opens a reason prompt instead of firing directly.
const NEEDS_REASON: DeliveryStatus[] = [
  "RECIPIENT_UNAVAILABLE",
  "WRONG_ADDRESS",
  "ADDRESS_NOT_FOUND",
  "RESCHEDULED",
  "FAILED",
  "RETURNED",
  "CANCELLED"
];

interface Props {
  currentStatus: DeliveryStatus;
  submitting?: boolean;
  onSelect: (next: DeliveryStatus, needsReason: boolean) => void;
  /** Leave out Start Delivery / Mark Delivered (the screen already shows them as the primary action). */
  hidePrimary?: boolean;
}

// Only ever offers the transitions the backend's state machine currently
// allows for `currentStatus` — never an arbitrary status (spec §9/§46).
export function StatusActionButtons({ currentStatus, submitting, onSelect, hidePrimary }: Props) {
  const options = allowedNextStatuses(currentStatus).filter((s) => !(hidePrimary && (s === "DELIVERED" || s === "OUT_FOR_DELIVERY")));
  if (options.length === 0) return null;

  return (
    <View style={styles.container}>
      {options.map((status) => (
        <PrimaryButton
          key={status}
          label={ACTION_LABELS[status] ?? statusLabel(status)}
          variant={status === "DELIVERED" ? "primary" : status === "CANCELLED" ? "danger" : "secondary"}
          loading={submitting}
          disabled={submitting}
          onPress={() => onSelect(status, NEEDS_REASON.includes(status))}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm }
});

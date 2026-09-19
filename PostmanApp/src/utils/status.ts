import { ALLOWED_STATUS_TRANSITIONS, DeliveryFilter, DeliveryStatus } from "../types/delivery";
import { StatusTone } from "../theme/colors";

const LABELS: Record<DeliveryStatus, string> = {
  RECEIVED: "Received",
  SORTED: "Sorted",
  ASSIGNED: "Assigned",
  OUT_FOR_DELIVERY: "Out for Delivery",
  DELIVERED: "Delivered",
  RECIPIENT_UNAVAILABLE: "Recipient Unavailable",
  REJECTED: "Rejected",
  WRONG_ADDRESS: "Wrong Address",
  ADDRESS_NOT_FOUND: "Address Not Found",
  RESCHEDULED: "Rescheduled",
  RETURNED: "Returned",
  FAILED: "Failed",
  CANCELLED: "Cancelled"
};

const TONES: Record<DeliveryStatus, StatusTone> = {
  RECEIVED: "neutral",
  SORTED: "neutral",
  ASSIGNED: "info",
  OUT_FOR_DELIVERY: "info",
  DELIVERED: "success",
  RECIPIENT_UNAVAILABLE: "warning",
  REJECTED: "danger",
  WRONG_ADDRESS: "warning",
  ADDRESS_NOT_FOUND: "warning",
  RESCHEDULED: "warning",
  RETURNED: "neutral",
  FAILED: "danger",
  CANCELLED: "neutral"
};

export function statusLabel(status: DeliveryStatus): string {
  return LABELS[status] ?? status;
}

export function statusTone(status: DeliveryStatus): StatusTone {
  return TONES[status] ?? "neutral";
}

export function allowedNextStatuses(current: DeliveryStatus): DeliveryStatus[] {
  return ALLOWED_STATUS_TRANSITIONS[current] ?? [];
}

export function canTransition(current: DeliveryStatus, next: DeliveryStatus): boolean {
  return allowedNextStatuses(current).includes(next);
}

const TERMINAL: DeliveryStatus[] = ["DELIVERED", "RETURNED", "CANCELLED"];
const FAILED_LIKE: DeliveryStatus[] = [
  "FAILED",
  "REJECTED",
  "WRONG_ADDRESS",
  "ADDRESS_NOT_FOUND",
  "RECIPIENT_UNAVAILABLE"
];

export function isTerminal(status: DeliveryStatus): boolean {
  return TERMINAL.includes(status);
}

export function matchesFilter(status: DeliveryStatus, filter: DeliveryFilter): boolean {
  switch (filter) {
    case "ALL":
      return true;
    case "COMPLETED":
      return status === "DELIVERED";
    case "FAILED":
      return FAILED_LIKE.includes(status) || status === "RETURNED" || status === "CANCELLED";
    case "RESCHEDULED":
      return status === "RESCHEDULED";
    case "PENDING":
      return !isTerminal(status) && status !== "RESCHEDULED" && !FAILED_LIKE.includes(status);
    default:
      return true;
  }
}

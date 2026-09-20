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

export function isTerminal(status: DeliveryStatus): boolean {
  return TERMINAL.includes(status);
}

/**
 * The single authoritative classification of every DeliveryStatus into
 * exactly one of three buckets — used for both the filter chips below and
 * (in effect) for the delivery statistics header, which reads
 * `GET /me/stats` rather than recomputing this locally. Mirrored exactly in
 * the backend at `backend/src/utils/deliveryStatusClassification.ts`
 * (`classifyDeliveryStatus`) — keep both definitions in sync; see that
 * file's comment for the business reasoning (why RETURNED/CANCELLED count
 * as FAILED rather than REMAINING or their own bucket).
 */
export type DeliveryStatusBucket = "COMPLETED" | "FAILED" | "REMAINING";

const COMPLETED_STATUSES: DeliveryStatus[] = ["DELIVERED"];
const FAILED_STATUSES: DeliveryStatus[] = [
  "FAILED",
  "REJECTED",
  "WRONG_ADDRESS",
  "ADDRESS_NOT_FOUND",
  "RECIPIENT_UNAVAILABLE",
  "RETURNED",
  "CANCELLED"
];

export function classifyDeliveryStatus(status: DeliveryStatus): DeliveryStatusBucket {
  if (COMPLETED_STATUSES.includes(status)) return "COMPLETED";
  if (FAILED_STATUSES.includes(status)) return "FAILED";
  return "REMAINING";
}

export function matchesFilter(status: DeliveryStatus, filter: DeliveryFilter): boolean {
  switch (filter) {
    case "ALL":
      return true;
    case "COMPLETED":
      return classifyDeliveryStatus(status) === "COMPLETED";
    case "FAILED":
      return classifyDeliveryStatus(status) === "FAILED";
    case "RESCHEDULED":
      return status === "RESCHEDULED";
    case "PENDING":
      return classifyDeliveryStatus(status) === "REMAINING" && status !== "RESCHEDULED";
    default:
      return true;
  }
}

/**
 * Computes the same {completed, failed, remaining, total} shape as the
 * backend's GET /me/stats, from a local list of delivery statuses. Not used
 * to drive the UI (the backend is authoritative — see
 * `src/api/postmanApi.ts` getStats, and the "no two competing definitions
 * of Total" requirement), but exercised by tests to prove the mobile and
 * backend classifications agree, and available for callers (e.g. offline
 * fallbacks) that only have a local delivery list to work with.
 */
export function computeDeliveryStats(statuses: DeliveryStatus[]): {
  total: number;
  completed: number;
  failed: number;
  remaining: number;
} {
  let completed = 0;
  let failed = 0;
  let remaining = 0;
  for (const status of statuses) {
    const bucket = classifyDeliveryStatus(status);
    if (bucket === "COMPLETED") completed += 1;
    else if (bucket === "FAILED") failed += 1;
    else remaining += 1;
  }
  return { total: completed + failed + remaining, completed, failed, remaining };
}

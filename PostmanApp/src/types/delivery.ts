// Mirrors backend/prisma/schema.prisma `DeliveryStatus` exactly (§2/§4 of the
// architecture report). Never invent a status value not present here.
export type DeliveryStatus =
  | "RECEIVED"
  | "SORTED"
  | "ASSIGNED"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "RECIPIENT_UNAVAILABLE"
  | "REJECTED"
  | "WRONG_ADDRESS"
  | "ADDRESS_NOT_FOUND"
  | "RESCHEDULED"
  | "RETURNED"
  | "FAILED"
  | "CANCELLED";

export type ParcelPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

// Mirrors backend/src/services/deliveryStatus.service.ts ALLOWED_TRANSITIONS.
// The backend is authoritative and re-validates every transition — this
// table only drives which action buttons the UI offers.
export const ALLOWED_STATUS_TRANSITIONS: Record<DeliveryStatus, DeliveryStatus[]> = {
  RECEIVED: ["SORTED", "CANCELLED"],
  SORTED: ["ASSIGNED", "CANCELLED"],
  ASSIGNED: ["OUT_FOR_DELIVERY", "CANCELLED", "RESCHEDULED"],
  OUT_FOR_DELIVERY: [
    "DELIVERED",
    "RECIPIENT_UNAVAILABLE",
    "REJECTED",
    "WRONG_ADDRESS",
    "ADDRESS_NOT_FOUND",
    "FAILED"
  ],
  RECIPIENT_UNAVAILABLE: ["RESCHEDULED", "RETURNED"],
  REJECTED: ["RETURNED"],
  WRONG_ADDRESS: ["RESCHEDULED", "RETURNED"],
  ADDRESS_NOT_FOUND: ["RESCHEDULED", "RETURNED"],
  RESCHEDULED: ["OUT_FOR_DELIVERY", "CANCELLED"],
  RETURNED: [],
  FAILED: ["RESCHEDULED", "RETURNED"],
  CANCELLED: [],
  DELIVERED: []
};

export interface Recipient {
  id: string;
  name: string;
  phone: string | null;
  altPhone: string | null;
}

export interface Address {
  id: string;
  addressLine1: string;
  addressLine2: string | null;
  area: string | null;
  city: string;
  state: string;
  pincode: string;
  latitude: number | null;
  longitude: number | null;
}

export interface DeliveryStatusHistoryEntry {
  id: string;
  fromStatus: DeliveryStatus | null;
  toStatus: DeliveryStatus;
  reason: string | null;
  changedBy: string | null;
  createdAt: string;
}

export interface Delivery {
  id: string;
  trackingId: string;
  recipient: Recipient;
  address: Address;
  parcelType: string | null;
  parcelCount: number;
  priority: ParcelPriority;
  urgency: string | null;
  serviceTimeMinutes: number | null;
  status: DeliveryStatus;
  postOfficeId: string;
  beatId: string | null;
  beat?: { beatNumber: string; name?: string } | null;
  assignedPostmanId: string | null;
  createdAt: string;
  updatedAt: string;
  statusHistory?: DeliveryStatusHistoryEntry[];
  /** Metadata of the proof photo, when one was taken (the photo itself is private to the server). */
  proof?: { capturedAt: string; contentType: string } | null;
}

export interface DeliveryListResponse {
  total: number;
  page: number;
  pageSize: number;
  rows: Delivery[];
}

export interface DeliveryStatsResponse {
  today: { total: number; completed: number; failed: number; remaining: number };
  completionRate: number;
}

export type DeliveryFilter = "ALL" | "PENDING" | "COMPLETED" | "FAILED" | "RESCHEDULED";

// ── past deliveries (GET /me/deliveries/history) ─────────────────────────────────────────────────────────────
/** What counts as a finished delivery: handed over, or sent back to the office. */
export type HistoryOutcome = "ALL" | "DELIVERED" | "RETURNED";

export interface FinishedDelivery extends Delivery {
  /** When the delivery reached its final status (ISO). */
  finishedAt: string;
}

export interface DeliveryHistoryResponse {
  /** Deliveries matching the outcome filter inside the period. */
  total: number;
  page: number;
  pageSize: number;
  /** How the whole period splits, regardless of the outcome filter (drives the chip counts). */
  summary: { delivered: number; returned: number };
  rows: FinishedDelivery[];
  /** True when this page is the copy saved on the phone (no connection), not what the server says now. */
  fromCache?: boolean;
}

import { DeliveryStatusMutation, SyncConflict } from "../store/offlineStore";
import { DeliveryStatus } from "../types/delivery";

/**
 * Where a change the postman made stands, in the words the History screen uses:
 *   QUEUED    saved on the phone, waiting for a connection (or its turn)
 *   CONFLICT  the server would not apply it (the delivery had moved on, or a required photo never arrived)
 * A change the server has accepted is no longer here: it is an ordinary row of history.
 */
export type SyncState = "QUEUED" | "CONFLICT";

export interface SyncItem {
  deliveryId: string;
  state: SyncState;
  /** The status the postman set. */
  status: DeliveryStatus;
  /** When they set it. */
  at: string;
  /** For a conflict: what the server now says, and why in words when there is a specific reason. */
  serverStatus?: DeliveryStatus;
  reason?: string;
  /** For a queued change: how often sending it has been tried. */
  attempts?: number;
  hasPhoto?: boolean;
}

/** The changes not yet on the server, newest first: queued ones and conflicts (a conflicted change has left the queue). */
export function buildSyncItems(queue: readonly DeliveryStatusMutation[], conflicts: readonly SyncConflict[]): SyncItem[] {
  const conflicted = new Set(conflicts.map((c) => c.deliveryId));
  const items: SyncItem[] = [
    ...conflicts.map((c): SyncItem => ({ deliveryId: c.deliveryId, state: "CONFLICT", status: c.attemptedStatus, at: c.detectedAt, serverStatus: c.serverStatus, reason: c.reason })),
    ...queue
      // a queued change for a delivery that also has a conflict is superseded by it
      .filter((m) => !conflicted.has(m.deliveryId))
      .map((m): SyncItem => ({ deliveryId: m.deliveryId, state: "QUEUED", status: m.status, at: m.queuedAt, attempts: m.attempts, hasPhoto: !!m.proofUri }))
  ];
  return items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

/** "2 waiting to sync · 1 could not be applied" (empty parts left out). */
export function syncSummary(items: readonly SyncItem[]): string {
  const queued = items.filter((i) => i.state === "QUEUED").length;
  const conflicts = items.filter((i) => i.state === "CONFLICT").length;
  return [queued ? `${queued} waiting to sync` : null, conflicts ? `${conflicts} could not be applied` : null].filter(Boolean).join(" \u00b7 ");
}

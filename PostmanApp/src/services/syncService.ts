import { QueryClient } from "@tanstack/react-query";
import { deliveryApi } from "../api/deliveryApi";
import { ApiError } from "../types/api";
import { DeliveryStatusMutation, useOfflineStore } from "../store/offlineStore";

export interface SyncSummary {
  synced: number;
  conflicted: number;
  failed: number;
}

/**
 * Drains the offline mutation queue in FIFO order (spec §19/§20). Mutations
 * are applied one at a time and in order so a later status change never
 * races ahead of an earlier one for the same delivery. On a genuine network
 * failure we stop and keep the remainder queued for the next attempt. On a
 * rejected transition (the backend's state machine says no — most likely
 * because an admin or another attempt already moved the delivery on) we
 * never silently overwrite: we drop the local mutation, re-fetch the
 * authoritative server record, and surface a conflict for the UI to show.
 */
export async function processQueue(queryClient: QueryClient): Promise<SyncSummary> {
  const store = useOfflineStore.getState();
  if (store.isSyncing) return { synced: 0, conflicted: 0, failed: 0 };

  store.setSyncing(true);
  const summary: SyncSummary = { synced: 0, conflicted: 0, failed: 0 };

  try {
    const queue = [...useOfflineStore.getState().queue].sort(
      (a, b) => new Date(a.queuedAt).getTime() - new Date(b.queuedAt).getTime()
    );

    for (const mutation of queue) {
      const result = await applyMutation(mutation);

      if (result === "synced") {
        await useOfflineStore.getState().dequeue(mutation.id);
        summary.synced += 1;
      } else if (result === "conflict") {
        await useOfflineStore.getState().dequeue(mutation.id);
        summary.conflicted += 1;
      } else {
        await useOfflineStore.getState().markAttempt(mutation.id, "Network unavailable");
        summary.failed += 1;
        break; // preserve order: stop draining on the first network failure
      }
    }

    if (summary.synced > 0 || summary.conflicted > 0) {
      await queryClient.invalidateQueries({ queryKey: ["deliveries"] });
      await queryClient.invalidateQueries({ queryKey: ["route"] });
    }
  } finally {
    store.setSyncing(false);
  }

  return summary;
}

type ApplyResult = "synced" | "conflict" | "network-failure";

/** A photo that still cannot be sent after this many tries is reported instead of being retried for ever. */
export const MAX_PROOF_ATTEMPTS = 8;

async function applyMutation(mutation: DeliveryStatusMutation): Promise<ApplyResult> {
  try {
    // The photo goes first: the server refuses DELIVERED for a post office that requires one, and a status change that
    // arrived before its photo would be refused.
    if (mutation.proofUri) {
      await deliveryApi.uploadProof(mutation.deliveryId, {
        uri: mutation.proofUri,
        latitude: mutation.latitude,
        longitude: mutation.longitude,
        capturedAt: mutation.proofCapturedAt
      });
    }
    const location =
      mutation.latitude !== undefined && mutation.longitude !== undefined
        ? { latitude: mutation.latitude, longitude: mutation.longitude, accuracyMeters: mutation.accuracyMeters }
        : undefined;
    if (location) await deliveryApi.updateStatus(mutation.deliveryId, mutation.status, mutation.reason, location);
    else await deliveryApi.updateStatus(mutation.deliveryId, mutation.status, mutation.reason);
    return "synced";
  } catch (err) {
    if (mutation.proofUri && mutation.attempts + 1 >= MAX_PROOF_ATTEMPTS && (!(err instanceof ApiError) || err.isNetworkError)) {
      useOfflineStore.getState().addConflict({
        deliveryId: mutation.deliveryId,
        attemptedStatus: mutation.status,
        serverStatus: "OUT_FOR_DELIVERY",
        detectedAt: new Date().toISOString(),
        reason: "The delivery photo could not be sent. Open the delivery and take it again."
      });
      return "conflict";
    }
    if (err instanceof ApiError) {
      if (err.isNetworkError) return "network-failure";

      if (err.statusCode === 400) {
        // Invalid transition per the backend's state machine — the server
        // record has moved since this mutation was queued offline.
        try {
          const serverDelivery = await deliveryApi.getById(mutation.deliveryId);
          const photoMissing = (err.details as { proofRequired?: boolean } | undefined)?.proofRequired === true;
          useOfflineStore.getState().addConflict({
            deliveryId: mutation.deliveryId,
            attemptedStatus: mutation.status,
            serverStatus: serverDelivery.status,
            detectedAt: new Date().toISOString(),
            ...(photoMissing ? { reason: "This post office requires a photo of the delivery, and none reached the server. Open the delivery and take it again." } : {})
          });
        } catch {
          // Even the refresh failed; still resolve as a conflict rather than
          // retry a mutation the server has already rejected.
        }
        return "conflict";
      }
    }
    return "network-failure";
  }
}

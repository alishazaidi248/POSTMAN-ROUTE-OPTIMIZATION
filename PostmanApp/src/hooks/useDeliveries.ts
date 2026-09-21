import { useMemo } from "react";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SERVER_POLL_MS } from "../config/polling";
import { deliveryApi } from "../api/deliveryApi";
import { postmanApi } from "../api/postmanApi";
import { offlineStorage } from "../storage/offlineStorage";
import { useOfflineStore } from "../store/offlineStore";
import { DeliveryListResponse, DeliveryStatus } from "../types/delivery";
import { ApiError } from "../types/api";

/**
 * The postman's deliveries: GET /me/deliveries, which the SERVER filters by the
 * authenticated postman (never by an id sent from here). Re-read every minute and
 * whenever the app comes back to the foreground, so admin changes arrive on their own.
 */
export const deliveriesQueryOptions = (status?: DeliveryStatus) =>
  queryOptions({
    queryKey: ["deliveries", status ?? "ALL"],
    queryFn: async () => {
      try {
        const data = await deliveryApi.listMine(status);
        if (!status) await offlineStorage.setCachedDeliveries(data);
        return data;
      } catch (err) {
        // Offline on a cold start: show the last list this device saw.
        if (!status && err instanceof ApiError && err.isNetworkError) {
          const cached = await offlineStorage.getCachedDeliveries<DeliveryListResponse>();
          if (cached) return cached;
        }
        throw err;
      }
    },
    staleTime: 30_000,
    refetchInterval: SERVER_POLL_MS,
    placeholderData: (prev) => prev
  });

export function useDeliveries(status?: DeliveryStatus) {
  return useQuery(deliveriesQueryOptions(status));
}

export function useDelivery(id: string | undefined) {
  return useQuery({
    queryKey: ["delivery", id],
    queryFn: () => deliveryApi.getById(id as string),
    enabled: !!id,
    staleTime: 30_000
  });
}

export const statsQueryOptions = () =>
  queryOptions({
    queryKey: ["deliveryStats"],
    queryFn: () => postmanApi.getStats(),
    staleTime: 30_000,
    refetchInterval: SERVER_POLL_MS
  });

export function useDeliveryStats() {
  return useQuery(statsQueryOptions());
}

interface UpdateStatusInput {
  deliveryId: string;
  status: DeliveryStatus;
  reason?: string;
  latitude?: number;
  longitude?: number;
  accuracyMeters?: number;
  /** A proof photo on the device; it is sent before the status change (or queued with it when offline). */
  proofUri?: string;
  proofCapturedAt?: string;
}

/**
 * Optimistic, offline-aware status update. When online it calls the
 * backend directly (the backend is authoritative and re-validates the
 * transition regardless). When offline, it queues the mutation instead of
 * failing outright (spec §19).
 */
export function useUpdateDeliveryStatus() {
  const queryClient = useQueryClient();
  const isOnline = useOfflineStore((s) => s.isOnline);
  const enqueue = useOfflineStore((s) => s.enqueue);

  return useMutation({
    mutationFn: async (input: UpdateStatusInput) => {
      if (!isOnline) {
        await enqueue({ type: "DELIVERY_STATUS_UPDATE", ...input });
        return { queued: true as const };
      }
      try {
        if (input.proofUri) {
          await deliveryApi.uploadProof(input.deliveryId, { uri: input.proofUri, latitude: input.latitude, longitude: input.longitude, capturedAt: input.proofCapturedAt });
        }
        const location = input.latitude !== undefined && input.longitude !== undefined ? { latitude: input.latitude, longitude: input.longitude, accuracyMeters: input.accuracyMeters } : undefined;
        const delivery = location
          ? await deliveryApi.updateStatus(input.deliveryId, input.status, input.reason, location)
          : await deliveryApi.updateStatus(input.deliveryId, input.status, input.reason);
        return { queued: false as const, delivery };
      } catch (err) {
        // The isOnline flag can be briefly stale relative to the actual
        // network — fall back to queueing rather than losing the update.
        if (err instanceof ApiError && err.isNetworkError) {
          await enqueue({ type: "DELIVERY_STATUS_UPDATE", ...input });
          return { queued: true as const };
        }
        throw err;
      }
    },
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({ queryKey: ["delivery", variables.deliveryId] });
      queryClient.invalidateQueries({ queryKey: ["deliveries"] });
      queryClient.invalidateQueries({ queryKey: ["deliveryStats"] });
      // The server refreshes the route lazily when the set of active
      // deliveries changes, so a fresh read is all that is needed. A queued
      // (offline) update has not reached the server yet — nothing to refresh.
      if (!result.queued) queryClient.invalidateQueries({ queryKey: ["route"] });
    }
  });
}

/**
 * The status each delivery WILL have once the offline queue syncs (the last
 * queued change wins; the queue is FIFO). Lets cards and map markers show what
 * the postman just did while offline instead of looking like nothing happened.
 */
export function pendingStatusMap(queue: { deliveryId: string; status: DeliveryStatus }[]): Record<string, DeliveryStatus> {
  const map: Record<string, DeliveryStatus> = {};
  for (const mutation of queue) map[mutation.deliveryId] = mutation.status;
  return map;
}

export function usePendingStatusOverrides(): Record<string, DeliveryStatus> {
  const queue = useOfflineStore((s) => s.queue);
  return useMemo(() => pendingStatusMap(queue), [queue]);
}

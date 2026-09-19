import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { deliveryApi } from "../api/deliveryApi";
import { postmanApi } from "../api/postmanApi";
import { offlineStorage } from "../storage/offlineStorage";
import { useOfflineStore } from "../store/offlineStore";
import { DeliveryStatus } from "../types/delivery";
import { ApiError } from "../types/api";

export function useDeliveries(status?: DeliveryStatus) {
  const query = useQuery({
    queryKey: ["deliveries", status ?? "ALL"],
    queryFn: async () => {
      const data = await deliveryApi.listMine(status);
      if (!status) await offlineStorage.setCachedDeliveries(data);
      return data;
    },
    staleTime: 60_000,
    placeholderData: (prev) => prev
  });

  return query;
}

export function useDelivery(id: string | undefined) {
  return useQuery({
    queryKey: ["delivery", id],
    queryFn: () => deliveryApi.getById(id as string),
    enabled: !!id,
    staleTime: 30_000
  });
}

export function useDeliveryStats() {
  return useQuery({
    queryKey: ["deliveryStats"],
    queryFn: () => postmanApi.getStats(),
    staleTime: 60_000
  });
}

interface UpdateStatusInput {
  deliveryId: string;
  status: DeliveryStatus;
  reason?: string;
  latitude?: number;
  longitude?: number;
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
        const delivery = await deliveryApi.updateStatus(input.deliveryId, input.status, input.reason);
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
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ["delivery", variables.deliveryId] });
      queryClient.invalidateQueries({ queryKey: ["deliveries"] });
      queryClient.invalidateQueries({ queryKey: ["deliveryStats"] });
    }
  });
}

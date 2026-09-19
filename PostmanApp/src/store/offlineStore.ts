import { create } from "zustand";
import { offlineStorage } from "../storage/offlineStorage";
import { DeliveryStatus } from "../types/delivery";

export interface DeliveryStatusMutation {
  id: string;
  type: "DELIVERY_STATUS_UPDATE";
  deliveryId: string;
  status: DeliveryStatus;
  reason?: string;
  latitude?: number;
  longitude?: number;
  queuedAt: string;
  attempts: number;
  lastError?: string;
}

export type SyncConflict = {
  deliveryId: string;
  attemptedStatus: DeliveryStatus;
  serverStatus: DeliveryStatus;
  detectedAt: string;
};

interface OfflineState {
  isOnline: boolean;
  queue: DeliveryStatusMutation[];
  conflicts: SyncConflict[];
  isSyncing: boolean;
  hydrate: () => Promise<void>;
  setOnline: (online: boolean) => void;
  enqueue: (mutation: Omit<DeliveryStatusMutation, "id" | "queuedAt" | "attempts">) => Promise<DeliveryStatusMutation>;
  dequeue: (id: string) => Promise<void>;
  markAttempt: (id: string, error?: string) => Promise<void>;
  addConflict: (conflict: SyncConflict) => void;
  clearConflict: (deliveryId: string) => void;
  setSyncing: (syncing: boolean) => void;
}

function persist(queue: DeliveryStatusMutation[]): Promise<void> {
  return offlineStorage.setMutationQueue(queue);
}

export const useOfflineStore = create<OfflineState>((set, get) => ({
  isOnline: true,
  queue: [],
  conflicts: [],
  isSyncing: false,

  hydrate: async () => {
    const queue = await offlineStorage.getMutationQueue<DeliveryStatusMutation>();
    set({ queue });
  },

  setOnline: (online) => set({ isOnline: online }),

  enqueue: async (mutation) => {
    const entry: DeliveryStatusMutation = {
      ...mutation,
      id: `${mutation.deliveryId}-${Date.now()}`,
      queuedAt: new Date().toISOString(),
      attempts: 0
    };
    const queue = [...get().queue, entry];
    set({ queue });
    await persist(queue);
    return entry;
  },

  dequeue: async (id) => {
    const queue = get().queue.filter((m) => m.id !== id);
    set({ queue });
    await persist(queue);
  },

  markAttempt: async (id, error) => {
    const queue = get().queue.map((m) =>
      m.id === id ? { ...m, attempts: m.attempts + 1, lastError: error } : m
    );
    set({ queue });
    await persist(queue);
  },

  addConflict: (conflict) => set({ conflicts: [...get().conflicts.filter((c) => c.deliveryId !== conflict.deliveryId), conflict] }),
  clearConflict: (deliveryId) => set({ conflicts: get().conflicts.filter((c) => c.deliveryId !== deliveryId) }),
  setSyncing: (syncing) => set({ isSyncing: syncing })
}));

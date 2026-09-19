import { useEffect } from "react";
import NetInfo from "@react-native-community/netinfo";
import { useQueryClient } from "@tanstack/react-query";
import { useOfflineStore } from "../store/offlineStore";
import { processQueue } from "../services/syncService";

/**
 * Mount once near the app root. Tracks connectivity via NetInfo, hydrates
 * the persisted mutation queue, and drains it automatically whenever the
 * device transitions from offline to online (spec §19: "When connection
 * returns -> Queue -> Sync -> Backend").
 */
export function useOfflineSync() {
  const queryClient = useQueryClient();
  const isOnline = useOfflineStore((s) => s.isOnline);
  const setOnline = useOfflineStore((s) => s.setOnline);
  const queueLength = useOfflineStore((s) => s.queue.length);
  const conflicts = useOfflineStore((s) => s.conflicts);
  const clearConflict = useOfflineStore((s) => s.clearConflict);

  useEffect(() => {
    useOfflineStore.getState().hydrate();

    const unsubscribe = NetInfo.addEventListener((state) => {
      const nowOnline = !!state.isConnected && state.isInternetReachable !== false;
      const wasOnline = useOfflineStore.getState().isOnline;
      setOnline(nowOnline);
      if (nowOnline && !wasOnline) {
        processQueue(queryClient);
      }
    });

    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { isOnline, queueLength, conflicts, clearConflict, sync: () => processQueue(queryClient) };
}

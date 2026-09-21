import { AppState, Platform } from "react-native";
import { QueryClient, focusManager } from "@tanstack/react-query";

// Connectivity is owned by the app's own offline layer (NetInfo -> offlineStore ->
// offline mutation queue, see hooks/useOfflineSync.ts), so TanStack Query must not
// second-guess it. Its default networkMode ("online") PAUSES requests whenever the
// browser reports offline - on web that meant a status update made offline was frozen
// inside the mutation (spinner, never queued) and only fired after reconnect.
//   mutations "always": the mutationFn runs and decides: queue it if offline.
//   queries "offlineFirst": try once even when offline, so the last-known-good cache
//   fallback in the query functions can answer instead of hanging.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      // Coming back to the app re-reads anything that has gone stale.
      refetchOnWindowFocus: true,
      networkMode: "offlineFirst"
    },
    mutations: {
      networkMode: "always"
    }
  }
});

// React Native has no "window focus": treat the app becoming active as focus.
if (Platform.OS !== "web") {
  focusManager.setEventListener((handleFocus) => {
    const subscription = AppState.addEventListener("change", (state) => handleFocus(state === "active"));
    return () => subscription.remove();
  });
}

/**
 * Drops every cached server response. Called whenever the signed-in account
 * changes (login / logout / forced sign-out): the cache is keyed by query, not by
 * user, so without this the next account would briefly see the previous account's
 * deliveries and profile.
 */
export function clearServerCache(): void {
  queryClient.clear();
}

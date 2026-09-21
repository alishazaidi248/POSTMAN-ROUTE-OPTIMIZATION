import React, { PropsWithChildren } from "react";
import { useOfflineSync } from "./hooks/useOfflineSync";
import { useSessionPrefetch } from "./hooks/useSessionPrefetch";

/** Mounts the offline-queue/connectivity listener once at the app root
 * (must be inside QueryClientProvider — see App.tsx). */
export function OfflineSyncGate({ children }: PropsWithChildren) {
  useOfflineSync();
  useSessionPrefetch();
  return <>{children}</>;
}

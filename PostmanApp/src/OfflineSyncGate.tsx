import React, { PropsWithChildren } from "react";
import { useOfflineSync } from "./hooks/useOfflineSync";

/** Mounts the offline-queue/connectivity listener once at the app root
 * (must be inside QueryClientProvider — see App.tsx). */
export function OfflineSyncGate({ children }: PropsWithChildren) {
  useOfflineSync();
  return <>{children}</>;
}

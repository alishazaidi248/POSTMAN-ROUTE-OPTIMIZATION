import React from "react";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./src/lib/queryClient";
import { RootNavigator } from "./src/navigation/RootNavigator";
import { OfflineSyncGate } from "./src/OfflineSyncGate";
import { useFixWebViewportHeight } from "./src/web/useFixWebViewportHeight";

// The shared QueryClient (src/lib/queryClient.ts) is wiped on every login/logout.

export default function App() {
  useFixWebViewportHeight();

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <OfflineSyncGate>
          <RootNavigator />
        </OfflineSyncGate>
        <StatusBar style="dark" />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

import React from "react";
import ReactDOM from "react-dom/client";
import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./styles/tokens.css";
import "maplibre-gl/dist/maplibre-gl.css";
import { AuthProvider } from "./lib/auth";
import { AppRouter } from "./routes/AppRouter";
import { ToastProvider } from "./components/Toast";

// PostgreSQL is the source of truth; this cache is only a view of it. So after ANY
// mutation - create, update, delete, assign, activate, status change - whether it
// succeeded or was rejected, every query on screen is refetched from the API and
// everything else is marked stale. Nothing is patched into the cache by hand, so the
// UI can never show a change the database did not accept.
const queryClient: QueryClient = new QueryClient({
  mutationCache: new MutationCache({
    onSettled: () => {
      void queryClient.invalidateQueries();
    }
  }),
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } }
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          <AppRouter />
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  </React.StrictMode>
);

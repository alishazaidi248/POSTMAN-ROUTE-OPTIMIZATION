import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "../store/authStore";
import { deliveriesQueryOptions, statsQueryOptions } from "./useDeliveries";
import { profileQueryOptions } from "./usePostmanProfile";
import { routeQueryOptions } from "./useRoute";

/**
 * As soon as a postman is signed in, load everything the app needs from the server in
 * parallel: profile (GET /me/profile), stats (GET /me/stats), deliveries
 * (GET /me/deliveries) and the route (GET /me/route). Screens then open with data
 * already there. Nothing is read from anything the device stored about the account.
 */
export function useSessionPrefetch() {
  const queryClient = useQueryClient();
  const status = useAuthStore((s) => s.status);
  const userId = useAuthStore((s) => s.user?.id);

  useEffect(() => {
    if (status !== "signedIn") return;
    void Promise.allSettled([
      queryClient.prefetchQuery(profileQueryOptions()),
      queryClient.prefetchQuery(statsQueryOptions()),
      queryClient.prefetchQuery(deliveriesQueryOptions()),
      queryClient.prefetchQuery(routeQueryOptions())
    ]);
  }, [status, userId, queryClient]);
}

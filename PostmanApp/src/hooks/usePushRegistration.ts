import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import * as Notifications from "expo-notifications";
import { registerPushTokenWithBackend } from "../services/notificationService";

/**
 * Mounted once while a postman is signed in: registers the phone for push, and refreshes the deliveries, the route and
 * the Notifications list when a push arrives while the app is open (the backend is the source of truth - the push is
 * only the nudge to read it again).
 */
export function usePushRegistration(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    void registerPushTokenWithBackend();
    const received = Notifications.addNotificationReceivedListener(() => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
      void queryClient.invalidateQueries({ queryKey: ["deliveries"] });
      void queryClient.invalidateQueries({ queryKey: ["route"] });
    });
    return () => received.remove();
  }, [queryClient]);
}

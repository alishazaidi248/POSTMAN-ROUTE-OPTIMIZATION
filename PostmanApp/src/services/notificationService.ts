import * as Notifications from "expo-notifications";

/**
 * Local-notification wrapper only. There is no backend endpoint to register
 * an Expo push token (spec §35/§36 gap analysis) — server-driven push
 * (new assignment, admin message, route re-optimization) is NOT
 * production-ready and must not be claimed as such. This module exists so
 * the rest of the app has a stable interface to call once that backend
 * infrastructure exists; today it only supports notifications this device
 * schedules for itself (e.g. "sync failed, retry when back online").
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true
  })
});

export async function requestNotificationPermission(): Promise<boolean> {
  const { status } = await Notifications.requestPermissionsAsync();
  return status === "granted";
}

export async function notifyLocally(title: string, body: string): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: { title, body },
    trigger: null
  });
}

/**
 * Documents the gap explicitly rather than pretending push is wired up.
 * Required backend work before this can do anything real:
 *   POST /api/v1/me/notifications/push-token  { expoPushToken }
 * plus a server-side job that calls Expo's push API on assignment/route
 * events. See docs/mobile-architecture.md.
 */
export async function registerPushTokenWithBackend(): Promise<void> {
  return;
}

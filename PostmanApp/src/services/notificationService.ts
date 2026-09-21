import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { notificationApi } from "../api/notificationApi";

/**
 * Notifications on this phone.
 *
 * Push (a new assignment, a reassignment, a route change, an urgent delivery, a message from the office) works like this:
 * the backend stores every message (Notifications screen, the source of truth) and pushes it through Expo to the tokens
 * registered here. Push needs a real device and a development / production build with the project's push credentials -
 * it cannot be verified in a simulator or on the web - so a phone that never receives one still finds the message in
 * Notifications.
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

let registeredToken: string | null = null;

/**
 * Asks for permission (once), gets this phone's Expo push token and tells the backend, which files it under the signed-in
 * login. Best-effort: a phone without permission, without a project id, or on the web simply gets no pushes.
 */
export async function registerPushTokenWithBackend(): Promise<string | null> {
  if (Platform.OS === "web") return null;
  try {
    const existing = await Notifications.getPermissionsAsync();
    const granted = existing.status === "granted" || (existing.canAskAgain !== false && (await requestNotificationPermission()));
    if (!granted) return null;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return null;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    if (token === registeredToken) return token;

    await notificationApi.registerPushToken(token, Platform.OS === "ios" ? "ios" : "android");
    registeredToken = token;
    return token;
  } catch {
    return null;
  }
}

/** Signing out stops pushes to this phone (the backend also drops tokens Expo reports as dead). */
export async function unregisterPushToken(): Promise<void> {
  const token = registeredToken;
  registeredToken = null;
  if (!token) return;
  await notificationApi.unregisterPushToken(token).catch(() => undefined);
}

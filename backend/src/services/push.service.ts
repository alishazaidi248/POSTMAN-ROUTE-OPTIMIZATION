import axios from "axios";
import { prisma } from "../config/prisma";
import { logger } from "../config/logger";
import { env } from "../config/env";

/**
 * Delivery of a notification to a phone through Expo's push service. The backend stays the source of truth: every push
 * has a Notification row behind it (postmanNotifications.service.ts), so a phone that never receives the push (no
 * signal, notifications off, token expired) still finds the message in the app's Notifications screen.
 *
 * What this cannot do here: it needs a phone with a registered Expo token and Expo's servers to reach it, so end-to-end
 * delivery to a device is not something the automated tests can prove. The tests cover registration, what is sent, and how
 * a rejected token is handled, with Expo's API replaced by a fake.
 */
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const TOKEN_FORMAT = /^Expo(nent)?PushToken\[[^\]\s]+\]$/;

export interface PushMessage {
  title: string;
  body: string;
  /** Delivered with the notification; the app uses it to open the right screen. Kept small. */
  data?: Record<string, unknown>;
}

export const isExpoPushToken = (token: string) => TOKEN_FORMAT.test(token);

export async function registerPushToken(userId: string, token: string, platform: string) {
  if (!isExpoPushToken(token)) throw new Error("INVALID_PUSH_TOKEN");
  // A device belongs to whoever signed in last: the same token moves to the new user.
  return prisma.pushToken.upsert({
    where: { token },
    create: { userId, token, platform },
    update: { userId, platform, lastUsedAt: new Date() }
  });
}

export async function removePushToken(userId: string, token: string) {
  await prisma.pushToken.deleteMany({ where: { token, userId } });
}

/** Pushes one message to every registered device of the users. Never throws: a push failing must not fail the business action. */
export async function sendPushToUsers(userIds: string[], message: PushMessage): Promise<{ sent: number; removed: number }> {
  if (!env.pushEnabled || userIds.length === 0) return { sent: 0, removed: 0 };
  try {
    const tokens = await prisma.pushToken.findMany({ where: { userId: { in: userIds } }, select: { token: true } });
    if (tokens.length === 0) return { sent: 0, removed: 0 };

    let sent = 0;
    let removed = 0;
    for (let i = 0; i < tokens.length; i += 100) {
      const batch = tokens.slice(i, i + 100);
      const { data } = await axios.post<{ data?: { status: string; details?: { error?: string } }[] }>(
        EXPO_PUSH_URL,
        batch.map((t) => ({ to: t.token, title: message.title, body: message.body, data: message.data ?? {}, sound: "default", priority: "high" })),
        {
          timeout: 10_000,
          headers: { Accept: "application/json", "Content-Type": "application/json", ...(env.expoAccessToken ? { Authorization: `Bearer ${env.expoAccessToken}` } : {}) }
        }
      );
      const tickets = data.data ?? [];
      const dead: string[] = [];
      tickets.forEach((ticket, index) => {
        if (ticket.status === "ok") sent++;
        else if (ticket.details?.error === "DeviceNotRegistered") dead.push(batch[index].token);
      });
      if (dead.length > 0) {
        // The phone no longer accepts this token (app removed, notifications revoked): stop sending to it.
        await prisma.pushToken.deleteMany({ where: { token: { in: dead } } });
        removed += dead.length;
      }
    }
    return { sent, removed };
  } catch (err) {
    logger.warn({ err }, "push notification could not be sent");
    return { sent: 0, removed: 0 };
  }
}

import { NotificationSeverity } from "@prisma/client";
import { prisma } from "../config/prisma";
import { logger } from "../config/logger";
import { env } from "../config/env";
import { sendPushToUsers } from "./push.service";

/**
 * What a postman is told, and when. Each message is stored (Notification, the source of truth the app lists) and then
 * pushed to their phones. Events:
 *   NEW_ASSIGNMENT   deliveries were assigned to them            (batched: an import assigns dozens at once)
 *   URGENT_ASSIGNMENT an URGENT delivery was assigned to them    (immediately, never batched)
 *   REASSIGNED       deliveries were taken from them             (batched)
 *   ROUTE_CHANGED    their route was re-planned                  (immediately)
 *   ADMIN_MESSAGE    an administrator wrote to them              (immediately)
 * Nothing here can fail the action that caused it.
 */
export type PostmanNotificationType = "NEW_ASSIGNMENT" | "URGENT_ASSIGNMENT" | "REASSIGNED" | "ROUTE_CHANGED" | "ADMIN_MESSAGE";

export interface PostmanNotification {
  type: PostmanNotificationType;
  title: string;
  message: string;
  severity?: NotificationSeverity;
  data?: Record<string, unknown>;
}

async function userOfPostman(postmanId: string): Promise<string | null> {
  const user = await prisma.user.findFirst({ where: { postmanId, status: "ACTIVE" }, select: { id: true } });
  return user?.id ?? null;
}

/** Stores the notification for the postman's login and pushes it to their phones. */
export async function notifyPostman(postmanId: string, n: PostmanNotification): Promise<boolean> {
  try {
    const userId = await userOfPostman(postmanId);
    if (!userId) return false; // a postman without a login has no app to tell
    await prisma.notification.create({
      data: { userId, type: n.type, title: n.title, message: n.message, severity: n.severity ?? "INFO", metadata: (n.data ?? {}) as object }
    });
    await sendPushToUsers([userId], { title: n.title, body: n.message, data: { type: n.type, ...n.data } });
    return true;
  } catch (err) {
    logger.warn({ err, postmanId, type: n.type }, "postman notification failed");
    return false;
  }
}

// ── batching ────────────────────────────────────────────────────────────────

type Batch = { count: number; timer: NodeJS.Timeout };
const assigned = new Map<string, Batch>();
const reassigned = new Map<string, Batch>();

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

function add(map: Map<string, Batch>, postmanId: string, flush: (postmanId: string, count: number) => void) {
  const current = map.get(postmanId);
  if (current) {
    current.count++;
    return;
  }
  const timer = setTimeout(() => {
    const batch = map.get(postmanId);
    map.delete(postmanId);
    if (batch) flush(postmanId, batch.count);
  }, env.pushBatchMs);
  timer.unref?.();
  map.set(postmanId, { count: 1, timer });
}

/** Runs the pending batches now (the timers do it after PUSH_BATCH_MS; tests and shutdown call this). */
export async function flushPostmanNotifications(): Promise<void> {
  const jobs: Promise<unknown>[] = [];
  for (const [map, send] of [[assigned, sendAssigned], [reassigned, sendReassigned]] as const) {
    for (const [postmanId, batch] of [...map]) {
      clearTimeout(batch.timer);
      map.delete(postmanId);
      jobs.push(send(postmanId, batch.count));
    }
  }
  await Promise.all(jobs);
}

const sendAssigned = (postmanId: string, count: number) =>
  notifyPostman(postmanId, {
    type: "NEW_ASSIGNMENT",
    title: count === 1 ? "New delivery" : "New deliveries",
    message: count === 1 ? "1 new delivery has been assigned to you." : `${count} new deliveries have been assigned to you.`,
    data: { count }
  });

const sendReassigned = (postmanId: string, count: number) =>
  notifyPostman(postmanId, {
    type: "REASSIGNED",
    title: "Deliveries reassigned",
    message: `${count} ${plural(count, "delivery was", "deliveries were")} moved to another postman.`,
    severity: "WARNING",
    data: { count }
  });

export interface AssignmentChange {
  deliveryId: string;
  trackingId: string;
  priority: string;
  fromPostmanId: string | null;
  toPostmanId: string | null;
}

/**
 * Tells the postmen involved about a committed change of who has a delivery. Call it AFTER the transaction that made the
 * change, so nobody is told about something that was rolled back.
 */
export function announceAssignmentChanges(changes: readonly AssignmentChange[]): void {
  for (const c of changes) {
    if (c.fromPostmanId === c.toPostmanId) continue;
    if (c.fromPostmanId) add(reassigned, c.fromPostmanId, (id, n) => void sendReassigned(id, n));
    if (!c.toPostmanId) continue;
    if (c.priority === "URGENT") {
      void notifyPostman(c.toPostmanId, {
        type: "URGENT_ASSIGNMENT",
        title: "Urgent delivery",
        message: `Urgent delivery ${c.trackingId} has been assigned to you.`,
        severity: "CRITICAL",
        data: { deliveryId: c.deliveryId }
      });
    } else {
      add(assigned, c.toPostmanId, (id, n) => void sendAssigned(id, n));
    }
  }
}

export const notifyRouteChanged = (postmanId: string, reason: string) =>
  notifyPostman(postmanId, {
    type: "ROUTE_CHANGED",
    title: "Your route was updated",
    message: "Your route was re-planned. Open the map to see the new order.",
    data: { reason }
  });

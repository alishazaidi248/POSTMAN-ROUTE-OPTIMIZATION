import { NotificationSeverity } from "@prisma/client";
import { prisma } from "../config/prisma";

export async function notify(params: {
  userId?: string;
  type: string;
  message: string;
  severity?: NotificationSeverity;
  metadata?: Record<string, unknown>;
}) {
  return prisma.notification.create({
    data: {
      userId: params.userId,
      type: params.type,
      message: params.message,
      severity: params.severity ?? "INFO",
      metadata: params.metadata as any
    }
  });
}

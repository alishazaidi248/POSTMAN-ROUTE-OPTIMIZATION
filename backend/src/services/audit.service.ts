import { Request } from "express";
import { prisma } from "../config/prisma";

export type AuditAction =
  | "USER_CREATED" | "USER_UPDATED"
  | "POSTMAN_CREATED" | "POSTMAN_UPDATED" | "POSTMAN_DEACTIVATED" | "POSTMAN_DELETED"
  | "BEAT_CREATED" | "BEAT_UPDATED" | "BEAT_DEACTIVATED"
  | "BEAT_IMPORTED" | "BEAT_VERIFIED" | "BEAT_TERRITORY_UPDATED" | "BEAT_POSTMAN_ASSIGNED"
  | "VEHICLE_CREATED" | "VEHICLE_UPDATED"
  | "DELIVERY_IMPORTED" | "DELIVERY_ASSIGNED" | "DELIVERY_REASSIGNED"
  | "ASSIGNMENT_OVERRIDDEN" | "DELIVERY_STATUS_CHANGED"
  | "ROUTE_GENERATED" | "ROUTE_REOPTIMIZED" | "IMPORT_FAILED"
  | "IMPORT_CONFIRMED" | "IMPORT_CANCELLED" | "LOGIN" | "LOGOUT";

interface AuditInput {
  req?: Request;
  userId?: string | null;
  action: AuditAction;
  entityType: string;
  entityId?: string;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string;
}

export async function recordAudit(input: AuditInput) {
  await prisma.auditLog.create({
    data: {
      userId: input.userId ?? input.req?.user?.sub ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      oldValue: input.oldValue as any,
      newValue: input.newValue as any,
      reason: input.reason,
      ipAddress: input.req?.ip
    }
  });
}

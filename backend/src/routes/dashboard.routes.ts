import { Router } from "express";
import { prisma } from "../config/prisma";
import { requireAuth, resolvePostOfficeScope } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const postOfficeId = resolvePostOfficeScope(req);
    const deliveryWhere = postOfficeId ? { postOfficeId } : {};

    const [
      total, assigned, unassigned, delivered, pending, failed, rescheduled,
      activePostmen, activeBeats, openExceptions, recentImports
    ] = await Promise.all([
      prisma.delivery.count({ where: deliveryWhere }),
      prisma.delivery.count({ where: { ...deliveryWhere, assignedPostmanId: { not: null } } }),
      prisma.delivery.count({ where: { ...deliveryWhere, assignedPostmanId: null } }),
      prisma.delivery.count({ where: { ...deliveryWhere, status: "DELIVERED" } }),
      prisma.delivery.count({ where: { ...deliveryWhere, status: { in: ["RECEIVED", "SORTED", "ASSIGNED", "OUT_FOR_DELIVERY"] } } }),
      prisma.delivery.count({ where: { ...deliveryWhere, status: "FAILED" } }),
      prisma.delivery.count({ where: { ...deliveryWhere, status: "RESCHEDULED" } }),
      prisma.postman.count({ where: { ...(postOfficeId ? { postOfficeId } : {}), status: "ACTIVE" } }),
      prisma.beat.count({ where: { ...(postOfficeId ? { postOfficeId } : {}), status: "ACTIVE" } }),
      prisma.assignmentException.count({ where: { resolvedAt: null, delivery: deliveryWhere } }),
      prisma.deliveryImport.findMany({
        where: postOfficeId ? { postOfficeId } : undefined,
        orderBy: { createdAt: "desc" },
        take: 5
      })
    ]);

    const beatWorkload = await prisma.delivery.groupBy({
      by: ["beatId"],
      where: { ...deliveryWhere, beatId: { not: null } },
      _count: true
    });

    res.json({
      cards: { total, assigned, unassigned, delivered, pending, failed, rescheduled, activePostmen, activeBeats },
      assignmentExceptions: openExceptions,
      recentImports,
      beatWorkload
    });
  })
);

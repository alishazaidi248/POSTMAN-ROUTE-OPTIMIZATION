import { Router } from "express";
import { prisma } from "../config/prisma";
import { requireAuth, requireRole } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";

export const auditLogsRouter = Router();
auditLogsRouter.use(requireAuth, requireRole("ADMIN", "SUPER_ADMIN"));

auditLogsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { entityType, action, page = "1", pageSize = "50" } = req.query as Record<string, string>;
    const take = Math.min(200, Number(pageSize) || 50);
    const skip = (Math.max(1, Number(page) || 1) - 1) * take;

    const where = {
      ...(entityType ? { entityType } : {}),
      ...(action ? { action } : {})
    };

    const [total, rows] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        include: { user: { select: { name: true, email: true } } },
        orderBy: { createdAt: "desc" },
        take,
        skip
      })
    ]);

    res.json({ total, page: Number(page), pageSize: take, rows });
  })
);

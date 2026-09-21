import { Router } from "express";
import { prisma } from "../config/prisma";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { AppError } from "../utils/AppError";

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const notifications = await prisma.notification.findMany({
      where: { OR: [{ userId: req.user!.sub }, { userId: null }] },
      orderBy: { createdAt: "desc" },
      take: 100
    });
    res.json(notifications);
  })
);

notificationsRouter.post(
  "/:id/read",
  asyncHandler(async (req, res) => {
    // Only the caller's own (or broadcast) notifications: someone else's id is simply not found.
    const result = await prisma.notification.updateMany({
      where: { id: req.params.id, OR: [{ userId: req.user!.sub }, { userId: null }] },
      data: { isRead: true }
    });
    if (result.count === 0) throw AppError.notFound("Notification not found");
    res.json(await prisma.notification.findUniqueOrThrow({ where: { id: req.params.id } }));
  })
);

notificationsRouter.post(
  "/read-all",
  asyncHandler(async (req, res) => {
    await prisma.notification.updateMany({
      where: { OR: [{ userId: req.user!.sub }, { userId: null }], isRead: false },
      data: { isRead: true }
    });
    res.status(204).send();
  })
);

import { Router } from "express";
import { prisma } from "../config/prisma";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";

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
    const updated = await prisma.notification.update({ where: { id: req.params.id }, data: { isRead: true } });
    res.json(updated);
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

import { Router } from "express";
import { prisma } from "../config/prisma";
import { requireAuth, resolvePostOfficeScope } from "../middleware/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { toCsv } from "../utils/csv";

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

reportsRouter.get(
  "/postmen",
  asyncHandler(async (req, res) => {
    const postOfficeId = resolvePostOfficeScope(req);
    const postmen = await prisma.postman.findMany({ where: postOfficeId ? { postOfficeId } : undefined });

    const report = await Promise.all(
      postmen.map(async (p) => {
        const [assigned, delivered, failed, rescheduled] = await Promise.all([
          prisma.delivery.count({ where: { assignedPostmanId: p.id } }),
          prisma.delivery.count({ where: { assignedPostmanId: p.id, status: "DELIVERED" } }),
          prisma.delivery.count({ where: { assignedPostmanId: p.id, status: "FAILED" } }),
          prisma.delivery.count({ where: { assignedPostmanId: p.id, status: "RESCHEDULED" } })
        ]);
        return {
          postmanId: p.id,
          name: p.name,
          employeeId: p.employeeId,
          assigned,
          delivered,
          failed,
          rescheduled,
          successRate: assigned > 0 ? Number(((delivered / assigned) * 100).toFixed(1)) : 0
        };
      })
    );

    if (req.query.format === "csv") {
      res.header("Content-Type", "text/csv");
      res.attachment("postman-report.csv");
      return res.send(toCsv(report));
    }

    res.json(report);
  })
);

reportsRouter.get(
  "/beats",
  asyncHandler(async (req, res) => {
    const postOfficeId = resolvePostOfficeScope(req);
    const beats = await prisma.beat.findMany({ where: postOfficeId ? { postOfficeId } : undefined });

    const report = await Promise.all(
      beats.map(async (b) => {
        const [total, completed, pending, failed] = await Promise.all([
          prisma.delivery.count({ where: { beatId: b.id } }),
          prisma.delivery.count({ where: { beatId: b.id, status: "DELIVERED" } }),
          prisma.delivery.count({ where: { beatId: b.id, status: { in: ["ASSIGNED", "OUT_FOR_DELIVERY", "SORTED"] } } }),
          prisma.delivery.count({ where: { beatId: b.id, status: "FAILED" } })
        ]);
        return { beatId: b.id, beatNumber: b.beatNumber, name: b.name, total, completed, pending, failed };
      })
    );

    if (req.query.format === "csv") {
      res.header("Content-Type", "text/csv");
      res.attachment("beat-report.csv");
      return res.send(toCsv(report));
    }

    res.json(report);
  })
);

reportsRouter.get(
  "/daily",
  asyncHandler(async (req, res) => {
    const postOfficeId = resolvePostOfficeScope(req);
    const date = req.query.date ? new Date(req.query.date as string) : new Date();
    const start = new Date(date); start.setHours(0, 0, 0, 0);
    const end = new Date(date); end.setHours(23, 59, 59, 999);

    const where = { ...(postOfficeId ? { postOfficeId } : {}), createdAt: { gte: start, lte: end } };

    const [total, completed, failed, rescheduled, unassigned] = await Promise.all([
      prisma.delivery.count({ where }),
      prisma.delivery.count({ where: { ...where, status: "DELIVERED" } }),
      prisma.delivery.count({ where: { ...where, status: "FAILED" } }),
      prisma.delivery.count({ where: { ...where, status: "RESCHEDULED" } }),
      prisma.delivery.count({ where: { ...where, assignedPostmanId: null } })
    ]);

    // Build the label from local date parts, not toISOString() — converting
    // local midnight to UTC rolls the date back a day in any timezone ahead
    // of UTC (e.g. IST), which made "today's" report show yesterday's date.
    const localDateLabel = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;

    res.json({ date: localDateLabel, total, completed, failed, rescheduled, unassigned });
  })
);

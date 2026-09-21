import { DeliveryStatus, Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";

/**
 * A postman's PAST deliveries: the ones whose work is finished. A delivery is finished when it reached
 * DELIVERED (handed over) or RETURNED (sent back to the office); FAILED / RECIPIENT_UNAVAILABLE and the like can
 * still be rescheduled, so they stay on the postman's live list. CANCELLED is the office's decision, not the
 * postman's work, so it is not history.
 *
 * "When" is the time of the status change that finished it (DeliveryStatusHistory), not the last edit of the row.
 */
export const FINISHED_STATUSES = ["DELIVERED", "RETURNED"] as const satisfies readonly DeliveryStatus[];
export type FinishedStatus = (typeof FINISHED_STATUSES)[number];

export interface HistoryQuery {
  /** Only deliveries finished before this instant (the app sends the start of its local "today"). */
  before: Date;
  /** ...and at or after this instant (omit for "all time"). */
  since?: Date;
  outcome?: FinishedStatus;
  page: number;
  pageSize: number;
}

/** One SELECT that yields (id, status, finishedAt) for every finished delivery of the postman inside the window. */
function finishedIn(postmanId: string, statuses: readonly FinishedStatus[], before: Date, since?: Date) {
  return Prisma.sql`
    SELECT d.id, d.status::text AS status, MAX(h."createdAt") AS "finishedAt"
    FROM "Delivery" d
    JOIN "DeliveryStatusHistory" h ON h."deliveryId" = d.id AND h."toStatus" = d.status
    WHERE d."assignedPostmanId" = ${postmanId} AND d.status::text IN (${Prisma.join([...statuses])})
    GROUP BY d.id, d.status
    HAVING MAX(h."createdAt") < ${before} ${since ? Prisma.sql`AND MAX(h."createdAt") >= ${since}` : Prisma.empty}`;
}

export async function listFinishedDeliveries(postmanId: string, q: HistoryQuery) {
  const summaryRows = await prisma.$queryRaw<{ status: FinishedStatus; n: bigint }[]>(
    Prisma.sql`SELECT f.status, count(*) AS n FROM (${finishedIn(postmanId, FINISHED_STATUSES, q.before, q.since)}) f GROUP BY f.status`
  );
  const summary = { delivered: 0, returned: 0 };
  for (const r of summaryRows) {
    if (r.status === "DELIVERED") summary.delivered = Number(r.n);
    if (r.status === "RETURNED") summary.returned = Number(r.n);
  }
  const total = q.outcome ? (q.outcome === "DELIVERED" ? summary.delivered : summary.returned) : summary.delivered + summary.returned;

  const statuses = q.outcome ? [q.outcome] : FINISHED_STATUSES;
  const page = await prisma.$queryRaw<{ id: string; finishedAt: Date }[]>(
    Prisma.sql`SELECT f.id, f."finishedAt" FROM (${finishedIn(postmanId, statuses, q.before, q.since)}) f
               ORDER BY f."finishedAt" DESC, f.id LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`
  );
  if (page.length === 0) return { total, summary, rows: [] };

  const found = await prisma.delivery.findMany({
    where: { id: { in: page.map((p) => p.id) } },
    include: { recipient: true, address: true, beat: { select: { beatNumber: true, name: true } } }
  });
  const byId = new Map(found.map((d) => [d.id, d]));
  const rows = page.flatMap((p) => {
    const d = byId.get(p.id);
    return d ? [{ ...d, finishedAt: p.finishedAt }] : [];
  });
  return { total, summary, rows };
}

import { DeliveryStatsResponse } from "../types/delivery";

export interface TodayCounts {
  completed: number;
  failed: number;
  remaining: number;
  /** Always completed + failed + remaining, so "x of total" can never disagree with the numbers beside it. */
  total: number;
}

/**
 * Today's numbers as the postman reads them. The server's own `today.total` counts deliveries *touched* today, which
 * is not the same as today's workload (it said "2 deliveries" beside "8 remaining"), so the total is derived here.
 */
export function todayCounts(stats: DeliveryStatsResponse | undefined, fallback: { completed: number; remaining: number }): TodayCounts {
  const completed = stats?.today.completed ?? fallback.completed;
  const failed = stats?.today.failed ?? 0;
  const remaining = stats?.today.remaining ?? fallback.remaining;
  return { completed, failed, remaining, total: completed + failed + remaining };
}

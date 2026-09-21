import { useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { deliveryApi } from "../api/deliveryApi";
import { offlineStorage } from "../storage/offlineStorage";
import { ApiError } from "../types/api";
import { DeliveryHistoryResponse, HistoryOutcome } from "../types/delivery";
import { periodStart, startOfToday } from "../utils/history";

const PAGE_SIZE = 30;

/**
 * The postman's past deliveries, one page at a time. `days` is the period ("last 7 days"; null = all time). The
 * period boundaries are computed from the device's local calendar so "yesterday" means the postman's yesterday.
 * With no connection the first page last seen on this phone for the same period and outcome is shown, marked as
 * saved (`fromCache`), so the postman can still look back at their work; further pages need the network.
 */
export function useDeliveryHistory(days: number | null, outcome: HistoryOutcome) {
  const day = startOfToday().toISOString(); // a new key every local day
  const query = useInfiniteQuery({
    queryKey: ["deliveryHistory", day, days, outcome],
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const cacheKey = `${days ?? "all"}:${outcome}`;
      try {
        const page = await deliveryApi.listHistory({
          before: day,
          since: periodStart(days)?.toISOString(),
          outcome,
          page: pageParam,
          pageSize: PAGE_SIZE
        });
        if (pageParam === 1) await offlineStorage.setCachedHistory(cacheKey, page);
        return page;
      } catch (err) {
        if (pageParam === 1 && err instanceof ApiError && err.isNetworkError) {
          const saved = await offlineStorage.getCachedHistory<DeliveryHistoryResponse>(cacheKey);
          if (saved) return { ...saved, fromCache: true };
        }
        throw err;
      }
    },
    getNextPageParam: (last: DeliveryHistoryResponse) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
    staleTime: 60_000
  });

  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.rows) ?? [], [query.data]);
  const first = query.data?.pages[0];
  return { ...query, rows, total: first?.total ?? 0, summary: first?.summary ?? { delivered: 0, returned: 0 }, fromCache: first?.fromCache === true };
}

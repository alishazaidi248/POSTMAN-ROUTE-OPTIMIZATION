import { useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { deliveryApi } from "../api/deliveryApi";
import { DeliveryHistoryResponse, HistoryOutcome } from "../types/delivery";
import { periodStart, startOfToday } from "../utils/history";

const PAGE_SIZE = 30;

/**
 * The postman's past deliveries, one page at a time. `days` is the period ("last 7 days"; null = all time). The
 * period boundaries are computed from the device's local calendar so "yesterday" means the postman's yesterday.
 * History needs the network (it is not kept offline); the screen shows the usual retry state when it cannot load.
 */
export function useDeliveryHistory(days: number | null, outcome: HistoryOutcome) {
  const day = startOfToday().toISOString(); // a new key every local day
  const query = useInfiniteQuery({
    queryKey: ["deliveryHistory", day, days, outcome],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      deliveryApi.listHistory({
        before: day,
        since: periodStart(days)?.toISOString(),
        outcome,
        page: pageParam,
        pageSize: PAGE_SIZE
      }),
    getNextPageParam: (last: DeliveryHistoryResponse) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
    staleTime: 60_000
  });

  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.rows) ?? [], [query.data]);
  const first = query.data?.pages[0];
  return { ...query, rows, total: first?.total ?? 0, summary: first?.summary ?? { delivered: 0, returned: 0 } };
}

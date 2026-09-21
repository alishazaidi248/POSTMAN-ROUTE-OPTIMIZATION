import { FinishedDelivery } from "../types/delivery";

const DAY_MS = 86_400_000;

/** Local midnight of `now`'s day: everything finished before this instant is "past". */
export function startOfToday(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** The first instant of a "last N days" period (null = all time). Today itself belongs to the Today tab, so 7 days = the 7 days before today. */
export function periodStart(days: number | null, now: Date = new Date()): Date | null {
  if (days === null) return null;
  const today = startOfToday(now);
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() - days);
}

/** "Today", "Yesterday", or "Sunday, 20 September" for the heading of one day of history. */
export function dayLabel(day: Date, now: Date = new Date()): string {
  const diff = Math.round((startOfToday(now).getTime() - startOfToday(day).getTime()) / DAY_MS);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return day.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
}

export interface HistoryDay {
  /** Local calendar day, e.g. "2026-09-20": stable key and sort order. */
  key: string;
  label: string;
  delivered: number;
  returned: number;
  data: FinishedDelivery[];
}

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Groups finished deliveries by the local day they were finished, newest day first, newest delivery first inside a day. */
export function groupByDay(rows: readonly FinishedDelivery[], now: Date = new Date()): HistoryDay[] {
  const days = new Map<string, HistoryDay>();
  for (const row of [...rows].sort((a, b) => new Date(b.finishedAt).getTime() - new Date(a.finishedAt).getTime())) {
    const when = new Date(row.finishedAt);
    const key = dayKey(when);
    let day = days.get(key);
    if (!day) {
      day = { key, label: dayLabel(when, now), delivered: 0, returned: 0, data: [] };
      days.set(key, day);
    }
    day.data.push(row);
    if (row.status === "DELIVERED") day.delivered += 1;
    if (row.status === "RETURNED") day.returned += 1;
  }
  return [...days.values()];
}

/** "3 delivered · 1 returned" (empty parts left out). */
export function daySummary(day: Pick<HistoryDay, "delivered" | "returned">): string {
  return [day.delivered ? `${day.delivered} delivered` : null, day.returned ? `${day.returned} returned` : null].filter(Boolean).join(" · ");
}

/**
 * True for a delivery that was finished on an earlier day: it belongs to History, not to today's list. (The time of the
 * last change is used; a finished delivery is not edited again, so this is the day it was finished.)
 */
export function isPastFinished(delivery: { status: string; updatedAt: string }, now: Date = new Date()): boolean {
  return (delivery.status === "DELIVERED" || delivery.status === "RETURNED") && new Date(delivery.updatedAt).getTime() < startOfToday(now).getTime();
}

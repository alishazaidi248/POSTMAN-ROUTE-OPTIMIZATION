export function formatAddress(address: {
  addressLine1: string;
  addressLine2?: string | null;
  area?: string | null;
  city: string;
  state: string;
  pincode: string;
}): string {
  return [address.addressLine1, address.addressLine2, address.area, address.city, address.state, address.pincode]
    .filter(Boolean)
    .join(", ");
}

export function formatDurationMinutes(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
}

/** "Today, 3:24 PM", "Yesterday, 9:10 AM" or "Sep 20, 3:24 PM": when something happened, in words a person reads at a glance. */
export function formatDateTime(iso: string, now: Date = new Date()): string {
  const when = new Date(iso);
  const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const daysAgo = Math.round((dayStart(now) - dayStart(when)) / 86_400_000);
  const time = formatTime(iso);
  if (daysAgo === 0) return `Today, ${time}`;
  if (daysAgo === 1) return `Yesterday, ${time}`;
  return `${when.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}

export function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return formatDate(iso);
}

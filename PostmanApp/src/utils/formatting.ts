interface AddressParts {
  addressLine1: string;
  addressLine2?: string | null;
  area?: string | null;
  city: string;
  state: string;
  pincode: string;
}

const keyOf = (text: string) => text.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
const hasWords = (haystack: string, needle: string) => ` ${haystack} `.includes(` ${needle} `);

/**
 * The address as separate lines, each part said once. Imported addresses repeat themselves ("CHOPRA CHAWL, JANTA
 * MARKET, Bhandup West, Mumbai, Maharashtra 400078" + area "JANTA MARKET" + city "Mumbai" + state + pincode), so every
 * comma-separated piece is compared with the others and dropped when another piece already says it. The state and the
 * pincode are left out (a postman knows the state; the pincode is shown where it is needed) - use formatAddress() for the
 * complete single line.
 */
export function formatAddressLines(address: AddressParts): string[] {
  return uniquePieces(address, false);
}

function uniquePieces(address: AddressParts, keepStateAndPin: boolean): string[] {
  const state = keyOf(address.state ?? "");
  const pin = (address.pincode ?? "").replace(/\D/g, "");
  const pieces = [address.addressLine1, address.addressLine2, address.area, address.city, keepStateAndPin ? address.state : null, keepStateAndPin ? address.pincode : null]
    .flatMap((part) => (part ?? "").split(","))
    .map((piece) => piece.trim())
    .filter(Boolean);

  const kept: { text: string; key: string }[] = [];
  for (const raw of pieces) {
    // a trailing "Maharashtra 400078" is the state and the pincode written together
    let text = raw;
    if (!keepStateAndPin) {
      if (pin) text = text.split(pin).join("").trim();
      if (state && keyOf(text) === state) continue;
    }
    const key = keyOf(text);
    if (!key) continue;
    if (kept.some((k) => k.key === key || hasWords(k.key, key))) continue;
    // a fuller piece replaces the shorter ones it contains ("Farid Nagar" -> "21 Farid Nagar")
    for (let i = kept.length - 1; i >= 0; i--) if (hasWords(key, kept[i].key)) kept.splice(i, 1);
    kept.push({ text, key });
  }
  return kept.map((k) => k.text);
}

/** "21 Farid Nagar / Bhandup West / Mumbai": the address on one line for a card or a row, nothing repeated. */
export function formatAddressShort(address: AddressParts): string {
  return formatAddressLines(address).join(" / ");
}

/** The complete address on one line, nothing repeated - for maps, navigation and confirmations. */
export function formatAddress(address: AddressParts): string {
  return uniquePieces(address, true).join(", ");
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

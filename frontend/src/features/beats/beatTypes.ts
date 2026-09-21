export type Verification = "PENDING_VERIFICATION" | "VERIFIED" | "NEEDS_REVIEW";

/** A beat as the API returns it (read back from PostgreSQL/PostGIS). */
export interface BeatRecord {
  id: string;
  postOfficeId: string;
  postOfficeName: string;
  beatNumber: string;
  name: string;
  status: "ACTIVE" | "INACTIVE";
  verificationStatus: Verification;
  verifiedAt: string | null;
  verifiedByName: string | null;
  hasTerritory: boolean;
  boundary: GeoJSON.Polygon | null;
  centerLatitude: number | null;
  centerLongitude: number | null;
  deliveryCount: number | string;
  assignedPostmanId: string | null;
  assignedPostmanName: string | null;
  /** Other active beats whose territory overlaps this one (from PostGIS). */
  overlaps?: { id: string; beatNumber: string; areaSqm: number }[];
  createdAt: string;
  updatedAt: string;
}

export const VERIFICATION_LABEL: Record<Verification, string> = {
  VERIFIED: "✓ Verified",
  PENDING_VERIFICATION: "⚠ Needs verification",
  NEEDS_REVIEW: "❌ Missing territory"
};

/** The state of a beat's territory as the three indicators the administrator sees: verified, needs verification, missing. */
export function territoryState(b: BeatRecord): Verification {
  if (!b.hasTerritory) return "NEEDS_REVIEW";
  return b.verificationStatus === "VERIFIED" ? "VERIFIED" : "PENDING_VERIFICATION";
}

export const isOverlapping = (b: BeatRecord) => (b.overlaps?.length ?? 0) > 0;

/** "⚠ Overlapping B21" - which beats a territory overlaps. */
export const overlapLabel = (b: BeatRecord) => `⚠ Overlapping ${b.overlaps!.map((o) => `B${o.beatNumber}`).join(", ")}`;

/** The colours the map and the badges share (kept in step with tokens.css). */
export const VERIFICATION_COLOR: Record<Verification, string> = {
  VERIFIED: "#2e7d5b",
  PENDING_VERIFICATION: "#d08a00",
  NEEDS_REVIEW: "#c0392b"
};

export const deliveriesOf = (b: BeatRecord): number => Number(b.deliveryCount) || 0;

export function territoryLabel(b: BeatRecord): string {
  if (!b.hasTerritory) return "Not drawn yet";
  return b.verificationStatus === "VERIFIED" ? "Verified" : "Awaiting verification";
}

/** "Today, 10:42 AM" / "Yesterday, 4:05 PM" / "12 Mar 2026". */
export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86_400_000);
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  return d.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
}

export function boundsOf(polygon: GeoJSON.Polygon): [[number, number], [number, number]] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of polygon.coordinates[0]) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return [[minX, minY], [maxX, maxY]];
}

export function matchesSearch(b: BeatRecord, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [b.beatNumber, b.name, b.postOfficeName, b.assignedPostmanName ?? ""].some((v) => v.toLowerCase().includes(q));
}

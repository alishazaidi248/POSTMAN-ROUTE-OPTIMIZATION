import { VERIFICATION_COLOR, Verification } from "./beatTypes";

/**
 * A small drawing of a beat's territory (no map tiles): enough to see its shape while
 * confirming it, without loading a second map.
 */
export function TerritoryPreview({ polygon, status }: { polygon: GeoJSON.Polygon | null; status: Verification }) {
  if (!polygon) {
    return (
      <div style={{ height: 120, display: "grid", placeItems: "center", background: "#f8fafc", borderRadius: 8, color: "var(--color-ink-500)", fontSize: 13 }}>
        No territory drawn yet
      </div>
    );
  }
  const ring = polygon.coordinates[0];
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const w = 240;
  const h = 130;
  const pad = 12;
  const scale = Math.min((w - 2 * pad) / (maxX - minX || 1), (h - 2 * pad) / (maxY - minY || 1));
  const offX = (w - (maxX - minX) * scale) / 2;
  const offY = (h - (maxY - minY) * scale) / 2;
  const points = ring.map(([x, y]) => `${(offX + (x - minX) * scale).toFixed(1)},${(h - offY - (y - minY) * scale).toFixed(1)}`).join(" ");
  const color = VERIFICATION_COLOR[status];

  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" role="img" aria-label="Shape of the beat territory" style={{ background: "#f8fafc", borderRadius: 8, display: "block" }}>
      <polygon points={points} fill={color} fillOpacity={0.18} stroke={color} strokeWidth={2} strokeLinejoin="round" />
    </svg>
  );
}

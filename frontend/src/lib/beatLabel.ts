/** "B20 — Farid Nagar": the beat number and the descriptive part of its name (never "Beat 20 — Beat 20"). */
export function beatLabel(b: { beatNumber: string; name: string }): string {
  const rest = b.name.replace(/^\s*beat\s*[-#]?\s*\d+\s*[-:–—]?\s*/i, "").trim();
  return rest ? `B${b.beatNumber} — ${rest}` : `B${b.beatNumber}`;
}

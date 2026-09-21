import { prisma } from "../../config/prisma";
import { DirectoryEntry } from "./beatMatcher";

/**
 * The beat directory of one post office, as the matcher reads it: one entry per (beat, locality, main area) row of
 * BeatLocality. A beat that has no locality rows (created by hand, before a beat list was imported) is still findable by
 * the descriptive part of its name ("Beat 20 - Farid Nagar" -> FARID NAGAR).
 *
 * The array is cached per office for a short time; the matcher caches its index on the array, so the (cheap) index is only
 * built when the directory actually changed. Any write that changes beats or their localities calls invalidateDirectory().
 */
const TTL_MS = 30_000;
const cache = new Map<string, { at: number; entries: DirectoryEntry[] }>();

export function invalidateDirectory(postOfficeId?: string) {
  if (postOfficeId) cache.delete(postOfficeId);
  else cache.clear();
}

/** "Beat 20 - Farid Nagar" -> "Farid Nagar"; "Beat 20" -> null. */
function descriptiveName(name: string): string | null {
  const rest = name.replace(/^\s*beat\s*[-#]?\s*\d+\s*[-:–—]?\s*/i, "").trim();
  return rest.length >= 3 ? rest : null;
}

export async function loadDirectory(postOfficeId: string): Promise<DirectoryEntry[]> {
  const hit = cache.get(postOfficeId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.entries;

  const beats = await prisma.beat.findMany({
    where: { postOfficeId, status: "ACTIVE" },
    select: { id: true, beatNumber: true, name: true, localities: { select: { locality: true, mainArea: true, pincode: true } } }
  });

  const entries: DirectoryEntry[] = [];
  for (const b of beats) {
    for (const l of b.localities) {
      entries.push({ beatId: b.id, beatNumber: b.beatNumber, beatName: b.name, locality: l.locality, mainArea: l.mainArea, pincode: l.pincode });
    }
    if (b.localities.length === 0) {
      const named = descriptiveName(b.name);
      if (named) entries.push({ beatId: b.id, beatNumber: b.beatNumber, beatName: b.name, locality: named, mainArea: null, pincode: null });
    }
  }
  cache.set(postOfficeId, { at: Date.now(), entries });
  return entries;
}

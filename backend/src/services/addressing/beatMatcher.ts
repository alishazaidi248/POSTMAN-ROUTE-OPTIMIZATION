/**
 * Address -> beat matching against the BEAT DIRECTORY (the beat list: which localities and main areas belong to which
 * beat). Pure functions: no database, no network, so every decision can be explained and tested.
 *
 * Score (0-100), the sum of the evidence found for a directory row:
 *
 *   LOCALITY    up to 60   the row's locality is in the address:
 *                            a whole comma-separated part equals it ......... 100 %   (SEGMENT_EXACT)
 *                            its words appear together, in order ............ 93 %    (PHRASE)
 *                            the same with small spelling differences ....... 85 %    (FUZZY_PHRASE)
 *                            all words appear, not together ................. 75 %    (TOKENS)
 *                            only some of the words (IDF weighted) .......... 55 %    (PARTIAL)
 *   MAIN AREA   up to 30   the row's main area (a building, chawl, society ...) is in the address (same ladder)
 *   LOCALITY FIELD +15     the row's locality equals the delivery's dedicated locality/area field (a stronger signal
 *                          than the same words somewhere in free text)
 *   POST OFFICE +5         the address names the post office's area (e.g. "Bhandup West")
 *   PINCODE     +5         the address pincode is the row's (or the post office's) pincode
 *
 * Evidence is only ever ADDED. A beat is never marked down because the directory lists no main area for it, or lists
 * different ones: the directory need not be complete, so "not listed" is not evidence against. A locality that is
 * used by several beats therefore scores the same for all of them until the main area (or the location) tells them apart -
 * and that is reported as AMBIGUOUS, not guessed.
 *
 * Confidence levels come from the best score and its MARGIN over the best other beat; the thresholds are validated
 * against ground truth in scripts/validate-matcher.ts (see backend/ADDRESS_MATCHING.md).
 */
import {
  GENERIC_ADDRESS_WORDS,
  NormalizedAddress,
  canonical,
  localityTokens,
  normalizeAddress,
  normalizeValue,
  tokenSimilarity
} from "./normalize";

export const POINTS = { locality: 60, mainArea: 30, postOffice: 5, pincode: 5, localityField: 15 } as const;

/** How much of a field's points each kind of match earns. */
const FACTOR = { SEGMENT_EXACT: 1, SEGMENT_FUZZY: 0.92, PHRASE: 0.93, FUZZY_PHRASE: 0.85, TOKENS: 0.75, PARTIAL: 0.55 } as const;
export type MatchKind = keyof typeof FACTOR | "NONE";

export interface DirectoryEntry {
  beatId: string;
  beatNumber: string;
  beatName?: string | null;
  locality: string;
  mainArea?: string | null;
  pincode?: string | null;
}

export interface AddressInput {
  /** addressLine1, addressLine2, area, city ... in any order; all are searched. */
  parts: readonly (string | null | undefined)[];
  /** The delivery's dedicated locality / area field, when the source has one (imports map "locality" here). */
  localityField?: string | null;
  /** "Bhandup West Post Office" / the office's area name. */
  postOfficeName?: string | null;
  postOfficePincode?: string | null;
}

export interface Evidence {
  field: "LOCALITY" | "LOCALITY_FIELD" | "MAIN_AREA" | "POST_OFFICE" | "PINCODE";
  /** What in the directory matched (e.g. "FARID NAGAR"). */
  matched: string;
  kind: MatchKind | "PRESENT";
  points: number;
}

export interface BeatCandidate {
  beatId: string;
  beatNumber: string;
  beatName?: string | null;
  score: number;
  locality: string;
  mainArea?: string | null;
  evidence: Evidence[];
}

export type MatchLevel = "HIGH" | "MEDIUM" | "LOW" | "AMBIGUOUS" | "NONE";

export interface Thresholds {
  /** Best score needed to assign automatically. */
  high: number;
  /** Best score needed for a suggestion worth an administrator's review. */
  medium: number;
  /** Required lead of the best beat over the next best beat. */
  margin: number;
}

/** Validated in scripts/validate-matcher.ts against the 130-delivery ground truth (see ADDRESS_MATCHING.md). */
export const DEFAULT_THRESHOLDS: Thresholds = { high: 65, medium: 45, margin: 15 };

export interface NameMatch {
  level: MatchLevel;
  confidence: number;
  best?: BeatCandidate;
  /** Every beat with a plausible match, best first (one entry per beat). */
  candidates: BeatCandidate[];
  /** The candidates within `margin` of the best one (the beats the name evidence cannot tell apart). */
  contenders: BeatCandidate[];
  margin: number;
}

// ── directory index ──────────────────────────────────────────────────────────────────────────────────────────

interface IndexedEntry extends DirectoryEntry {
  locTokens: string[];
  areaTokens: string[];
}
interface Index {
  entries: IndexedEntry[];
  idf: Map<string, number>;
}
const cache = new WeakMap<readonly DirectoryEntry[], Index>();

const GENERIC_BEAT_NAME = /^\s*beat\s*[-#]?\s*\d+/i;

export function buildIndex(directory: readonly DirectoryEntry[]): Index {
  const hit = cache.get(directory);
  if (hit) return hit;
  const entries: IndexedEntry[] = [];
  const named = new Set<string>();
  for (const e of directory) {
    const locTokens = localityTokens(e.locality);
    if (locTokens.length === 0) continue;
    entries.push({ ...e, locTokens, areaTokens: normalizeValue(e.mainArea) });
    // A beat's own descriptive name (not "Beat 20 - ...") is one more way to recognise it.
    if (e.beatName && !GENERIC_BEAT_NAME.test(e.beatName) && !named.has(e.beatId)) {
      named.add(e.beatId);
      const nt = localityTokens(e.beatName);
      if (nt.length) entries.push({ beatId: e.beatId, beatNumber: e.beatNumber, beatName: e.beatName, locality: e.beatName, mainArea: null, pincode: e.pincode, locTokens: nt, areaTokens: [] });
    }
  }
  // Rare words identify a place; ROAD / NAGAR / CHAWL appear everywhere and count for less.
  const df = new Map<string, number>();
  for (const e of entries) for (const t of new Set(e.locTokens)) df.set(t, (df.get(t) ?? 0) + 1);
  const idf = new Map<string, number>();
  for (const [t, n] of df) idf.set(t, Math.log((entries.length + 1) / (n + 0.5)));
  const index = { entries, idf };
  cache.set(directory, index);
  return index;
}

// ── field matching ───────────────────────────────────────────────────────────────────────────────────────────

interface FieldMatch {
  kind: MatchKind;
  /** 0..1 share of the field's points. */
  share: number;
}

const equalTokens = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((t, i) => t === b[i]);

/** Position where `phrase` occurs in `tokens` (fuzzy tokens allowed); exact tells whether every token was identical. */
function findPhrase(tokens: readonly string[], phrase: readonly string[]): { exact: boolean } | null {
  for (let start = 0; start + phrase.length <= tokens.length; start++) {
    let exact = true;
    let ok = true;
    for (let i = 0; i < phrase.length; i++) {
      const sim = tokenSimilarity(phrase[i], tokens[start + i]);
      if (sim === 0) {
        ok = false;
        break;
      }
      if (sim < 1) exact = false;
    }
    if (ok) return { exact };
  }
  return null;
}

/** Weighted share of the phrase's words found anywhere in the address (best spelling match per word). */
function bagCoverage(phrase: readonly string[], tokens: readonly string[], weight: (t: string) => number) {
  let got = 0;
  let total = 0;
  let matched = 0;
  for (const t of phrase) {
    const w = weight(t);
    total += w;
    let best = 0;
    for (const a of tokens) best = Math.max(best, tokenSimilarity(t, a));
    if (best > 0) matched++;
    got += w * best;
  }
  return { coverage: total > 0 ? got / total : 0, allPresent: matched === phrase.length, matched };
}

/**
 * A part of the address reduced to the place it names: house numbers at either end and the trailing city / state words go,
 * then the post-office area ("21 FARID NAGAR BHANDUP WEST MUMBAI" -> "FARID NAGAR"; "L B S MARG BHANDUP WEST" -> "L B S MARG").
 */
function withoutOfficeTail(seg: readonly string[]): string[] {
  let t = [...seg];
  const isNumber = (w: string) => /^\d+$/.test(w);
  while (t.length > 1 && (isNumber(t[0]) || isNumber(t[t.length - 1]) || GENERIC_ADDRESS_WORDS.has(t[t.length - 1]))) t = isNumber(t[0]) ? t.slice(1) : t.slice(0, -1);
  return localityTokens(t.join(" "));
}

function matchField(phrase: readonly string[], addr: NormalizedAddress, weight: (t: string) => number, requireInformative: boolean): FieldMatch {
  if (phrase.length === 0) return { kind: "NONE", share: 0 };
  for (const whole of addr.segments) {
    for (const seg of [whole, withoutOfficeTail(whole)]) {
      if (seg.length !== phrase.length) continue;
      if (equalTokens(seg, phrase)) return { kind: "SEGMENT_EXACT", share: FACTOR.SEGMENT_EXACT };
      if (findPhrase(seg, phrase)) return { kind: "SEGMENT_FUZZY", share: FACTOR.SEGMENT_FUZZY };
    }
  }
  const inText = findPhrase(addr.tokens, phrase);
  if (inText) return inText.exact ? { kind: "PHRASE", share: FACTOR.PHRASE } : { kind: "FUZZY_PHRASE", share: FACTOR.FUZZY_PHRASE };
  const bag = bagCoverage(phrase, addr.tokens, weight);
  // Words that are all in ONE part of the address (in another order) are a real match; words picked up from different
  // parts ("L B S" here, "ROAD" from another line) are only a partial one.
  const inOneSegment = addr.segments.some((seg) => bagCoverage(phrase, seg, weight).allPresent);
  if (bag.allPresent && inOneSegment) return { kind: "TOKENS", share: FACTOR.TOKENS * bag.coverage };
  // Partial: the words that carry information (not ROAD / NAGAR / CHAWL alone) must be there.
  const informativeMissing = requireInformative && phrase.some((t) => weight(t) >= 2.2 && !addr.tokens.some((a) => tokenSimilarity(t, a) > 0));
  if (bag.coverage >= 0.5 && !informativeMissing) return { kind: "PARTIAL", share: FACTOR.PARTIAL * bag.coverage };
  return { kind: "NONE", share: 0 };
}

const containsPhrase = (long: readonly string[], short: readonly string[]) =>
  long.length > short.length && Array.from({ length: long.length - short.length + 1 }, (_, i) => i).some((i) => short.every((t, j) => long[i + j] === t));

// ── matching ─────────────────────────────────────────────────────────────────────────────────────────────────

export function scoreEntries(address: AddressInput, directory: readonly DirectoryEntry[]): BeatCandidate[] {
  const index = buildIndex(directory);
  const addr = normalizeAddress(address.parts);
  if (addr.tokens.length === 0) return [];
  const weight = (t: string) => (GENERIC_ADDRESS_WORDS.has(t) ? 0.1 : index.idf.get(t) ?? 2.5);
  const fieldTokens = localityTokens(address.localityField);
  const officeTokens = normalizeValue(address.postOfficeName).filter((t) => !["POST", "OFFICE", "SO", "S", "O", "HO", "BO"].includes(t));
  const officeMentioned = officeTokens.length > 0 && officeTokens.every((t) => addr.tokens.some((a) => tokenSimilarity(t, a) > 0.85));

  type Scored = { e: IndexedEntry; loc: FieldMatch; score: BeatCandidate };
  const scored: Scored[] = [];
  for (const e of index.entries) {
    const loc = matchField(e.locTokens, addr, weight, true);
    const locPoints = POINTS.locality * loc.share;
    if (loc.kind === "NONE" || locPoints < 15) continue;
    const evidence: Evidence[] = [{ field: "LOCALITY", matched: canonical(e.locTokens), kind: loc.kind, points: Math.round(locPoints * 10) / 10 }];
    let total = locPoints;

    if (fieldTokens.length > 0) {
      const same = equalTokens(e.locTokens, fieldTokens);
      const near = !same && e.locTokens.length === fieldTokens.length && e.locTokens.every((t, i) => tokenSimilarity(t, fieldTokens[i]) > 0);
      if (same || near) {
        const p = POINTS.localityField * (same ? 1 : 0.8);
        total += p;
        evidence.push({ field: "LOCALITY_FIELD", matched: canonical(e.locTokens), kind: same ? "SEGMENT_EXACT" : "SEGMENT_FUZZY", points: Math.round(p * 10) / 10 });
      }
    }

    if (e.areaTokens.length > 0 && !equalTokens(e.areaTokens, e.locTokens)) {
      const area = matchField(e.areaTokens, addr, weight, true);
      if (area.kind !== "NONE") {
        const p = POINTS.mainArea * area.share;
        total += p;
        evidence.push({ field: "MAIN_AREA", matched: canonical(e.areaTokens), kind: area.kind, points: Math.round(p * 10) / 10 });
      }
    }
    if (officeMentioned) {
      total += POINTS.postOffice;
      evidence.push({ field: "POST_OFFICE", matched: officeTokens.join(" "), kind: "PRESENT", points: POINTS.postOffice });
    }
    const pin = e.pincode ?? address.postOfficePincode;
    if (pin && addr.pincode && pin === addr.pincode) {
      total += POINTS.pincode;
      evidence.push({ field: "PINCODE", matched: pin, kind: "PRESENT", points: POINTS.pincode });
    }
    scored.push({
      e,
      loc,
      score: {
        beatId: e.beatId, beatNumber: e.beatNumber, beatName: e.beatName, locality: e.locality, mainArea: e.mainArea ?? null,
        score: Math.min(100, Math.round(total)), evidence
      }
    });
  }

  // "VILLAGE ROAD" inside the part "BHANDUP VILLAGE ROAD" is not a match of its own when that longer locality matched as well.
  const strong = scored.filter((s) => s.loc.kind === "SEGMENT_EXACT" || s.loc.kind === "PHRASE");
  const kept = scored.filter((s) => {
    if (s.loc.kind !== "PHRASE" && s.loc.kind !== "FUZZY_PHRASE" && s.loc.kind !== "SEGMENT_FUZZY") return true;
    return !strong.some((o) => o !== s && containsPhrase(o.e.locTokens, s.e.locTokens));
  });

  // One candidate per beat: its best row.
  const perBeat = new Map<string, BeatCandidate>();
  for (const { score } of kept) {
    const current = perBeat.get(score.beatId);
    if (!current || score.score > current.score) perBeat.set(score.beatId, score);
  }
  return [...perBeat.values()].sort((a, b) => b.score - a.score || a.beatNumber.localeCompare(b.beatNumber, undefined, { numeric: true }));
}

export function classify(candidates: readonly BeatCandidate[], thresholds: Thresholds = DEFAULT_THRESHOLDS): NameMatch {
  if (candidates.length === 0) return { level: "NONE", confidence: 0, candidates: [], contenders: [], margin: 0 };
  const best = candidates[0];
  const second = candidates[1];
  const margin = best.score - (second?.score ?? 0);
  const contenders = candidates.filter((c) => best.score - c.score < thresholds.margin);
  let level: MatchLevel;
  if (best.score < thresholds.medium) level = "LOW";
  else if (margin < thresholds.margin) level = "AMBIGUOUS";
  else level = best.score >= thresholds.high ? "HIGH" : "MEDIUM";
  return { level, confidence: best.score, best, candidates: candidates.slice(0, 5), contenders, margin };
}

export function matchBeatByName(address: AddressInput, directory: readonly DirectoryEntry[], thresholds: Thresholds = DEFAULT_THRESHOLDS): NameMatch {
  return classify(scoreEntries(address, directory), thresholds);
}

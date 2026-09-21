/**
 * Address normalization: turns the many ways of writing the same place into one comparable form, WITHOUT throwing away
 * information that tells places apart (house numbers, building names, wings, road names all survive).
 *
 *   "Farid Nagar, Bhandup West, Mumbai"     ->  segments [[FARID, NAGAR], [BHANDUP, WEST], [MUMBAI]]
 *   "Farid Nagar Bhandup W Mumbai"          ->  tokens   [FARID, NAGAR, BHANDUP, WEST, MUMBAI]
 *   "L.B.S. Rd, Bhandup (W)"                ->  tokens   [LBS, ROAD, BHANDUP, WEST]
 *
 * Steps: fold accents and case, drop punctuation but keep the comma-separated SEGMENTS (a whole segment equal to a
 * locality is stronger evidence than the words merely appearing), join dotted initials (L.B.S. -> LBS), expand
 * abbreviations (RD -> ROAD, BLDG -> BUILDING, W -> WEST), unify common spelling variants (NIVAS -> NIWAS).
 * Nothing here knows about beats or the database.
 */

/** Token-level abbreviation / spelling map. Applied to whole tokens only. */
const TOKEN_MAP: Record<string, string> = {
  W: "WEST", E: "EAST", N: "NORTH", S: "SOUTH", WST: "WEST",
  RD: "ROAD", STR: "STREET", MRG: "MARG", LN: "LANE",
  BLDG: "BUILDING", BLD: "BUILDING", BLDNG: "BUILDING", BULDING: "BUILDING", BUJILDING: "BUILDING",
  APT: "APARTMENT", APTS: "APARTMENT", APARTMENTS: "APARTMENT", APPT: "APARTMENT",
  SOC: "SOCIETY", SOCY: "SOCIETY", SOCIETIES: "SOCIETY",
  HSG: "HOUSING", COOP: "COOP", COOPERATIVE: "COOP", CO: "CO", // "CO OP" is handled below
  NR: "NEAR", OPP: "OPPOSITE", OPPOSIT: "OPPOSITE",
  SEC: "SECTOR", NGR: "NAGAR", NAGER: "NAGAR", NAGAAR: "NAGAR",
  MKT: "MARKET", MARKT: "MARKET",
  IND: "INDUSTRIAL", INDL: "INDUSTRIAL", INDS: "INDUSTRIAL", INDUSTRY: "INDUSTRIAL", INDUSTRIES: "INDUSTRIAL",
  EST: "ESTATE", COMPD: "COMPOUND", CMPD: "COMPOUND", COMPUND: "COMPOUND", CMPND: "COMPOUND",
  CHWL: "CHAWL", CHAWAL: "CHAWL", CHAWLS: "CHAWL", CHAL: "CHAWL",
  NIVAS: "NIWAS", NIVASH: "NIWAS", NIWASH: "NIWAS",
  BHUVAN: "BHAVAN", BHAWAN: "BHAVAN", BHUWAN: "BHAVAN",
  MAH: "MAHARASHTRA", MUM: "MUMBAI", BOMBAY: "MUMBAI",
  SCH: "SCHOOL", HOSP: "HOSPITAL", STN: "STATION", RLY: "RAILWAY",
  NO: "NUMBER", NUM: "NUMBER", FLR: "FLOOR", FLOORS: "FLOOR", GALA: "GALA", GALAS: "GALA"
};

/** Words that appear in almost every address of the post office and say nothing about WHICH locality. */
export const GENERIC_ADDRESS_WORDS = new Set(["MUMBAI", "MAHARASHTRA", "INDIA", "NUMBER"]);

const stripAccents = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "");

/** Splits into comma-like segments, keeping the pieces the sender wrote as separate parts. */
function rawSegments(text: string): string[] {
  return text
    .split(/[,;|\n\r]+|\s[-–—]\s|\/(?=\s)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Uppercase tokens of one segment: punctuation removed, initials joined, abbreviations expanded. */
export function tokenize(segment: string): string[] {
  const cleaned = stripAccents(segment)
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/([A-Z])(\d)/g, "$1 $2") // "K4" -> "K 4" would break unit codes, but keeps "BLDG3" comparable to "BLDG 3"
    .replace(/(\d)([A-Z])/g, "$1 $2");
  const raw = cleaned.split(/\s+/).filter(Boolean);

  // Join runs of two or more single letters: L B S -> LBS, N C H -> NCH (dotted initials). A lone letter stays (W -> WEST).
  const joined: string[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length >= 2) joined.push(run.join(""));
    else joined.push(...run);
    run = [];
  };
  for (const t of raw) {
    if (t.length === 1 && /[A-Z]/.test(t)) run.push(t);
    else {
      flush();
      joined.push(t);
    }
  }
  flush();

  // "CO OP" / "CO-OP" -> COOP
  const out: string[] = [];
  for (let i = 0; i < joined.length; i++) {
    if (joined[i] === "CO" && joined[i + 1] === "OP") {
      out.push("COOP");
      i++;
    } else out.push(TOKEN_MAP[joined[i]] ?? joined[i]);
  }
  return out;
}

export interface NormalizedAddress {
  /** Comma-separated parts, each as tokens. */
  segments: string[][];
  /** All tokens in order. */
  tokens: string[];
  /** Tokens joined by a space. */
  text: string;
  /** A 6-digit Indian pincode found anywhere in the text. */
  pincode?: string;
}

export function normalizeAddress(parts: readonly (string | null | undefined)[]): NormalizedAddress {
  const joined = parts.filter((p): p is string => !!p && p.trim() !== "").join(", ");
  const pincode = joined.match(/\b([1-9]\d{5})\b/)?.[1];
  const withoutPin = pincode ? joined.replace(pincode, " ") : joined;
  const segments = rawSegments(withoutPin).map(tokenize).filter((t) => t.length > 0);
  const tokens = segments.flat();
  return { segments, tokens, text: tokens.join(" "), pincode };
}

/** Normalizes one value (a locality, a main area, a beat name) to tokens. */
export function normalizeValue(value: string | null | undefined): string[] {
  return value ? tokenize(value) : [];
}

/**
 * The words that identify a directory LOCALITY: a trailing "BHANDUP WEST" / "BHANDUP" (the post-office area, present in
 * "ISHWAR NAGAR BHANDUP WEST") is dropped when something else remains. "BHANDUP VILLAGE ROAD" keeps BHANDUP.
 */
export function localityTokens(locality: string | null | undefined): string[] {
  let t = normalizeValue(locality);
  const tail = (n: string[]) => t.length > n.length && n.every((w, i) => t[t.length - n.length + i] === w);
  if (tail(["BHANDUP", "WEST"])) t = t.slice(0, -2);
  else if (tail(["BHANDUP"])) t = t.slice(0, -1);
  return t;
}

/** Stable string form used to store and compare directory values. */
export const canonical = (tokens: readonly string[]) => tokens.join(" ");

/**
 * The key address learning stores a location under: order-insensitive, without the words every address of the office
 * carries. "21 Farid Nagar, Bhandup West, Mumbai 400078" and "Farid Nagar 21 Bhandup (W)" give the same key.
 */
export function addressKey(parts: readonly (string | null | undefined)[]): string {
  const n = normalizeAddress(parts);
  const drop = new Set(["BHANDUP", "WEST", ...GENERIC_ADDRESS_WORDS]);
  return [...new Set(n.tokens.filter((t) => !drop.has(t)))].sort().join(" ");
}

// ── similarity ───────────────────────────────────────────────────────────────────────────────────────────────

/** Levenshtein distance with an early exit above `max`. */
export function editDistance(a: string, b: string, max = 3): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Similarity of two tokens, 0..1. Equal -> 1. Numbers must be equal. Words of 4+ letters tolerate small spelling
 * differences (TEMBHIPADA / TEMBIPADA, BHATTIPADA / BHATIPADA); shorter words must match exactly so that
 * "RAM" is never "RAJ".
 */
export function tokenSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (/\d/.test(a) || /\d/.test(b)) return 0;
  const longest = Math.max(a.length, b.length);
  if (Math.min(a.length, b.length) < 4 || a[0] !== b[0]) return 0;
  const allowed = longest >= 8 ? 2 : 1;
  const d = editDistance(a, b, allowed);
  if (d > allowed) return 0;
  return Math.round((1 - d / longest) * 100) / 100;
}

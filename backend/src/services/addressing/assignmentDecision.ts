/**
 * The assignment decision: given the NAME evidence (beat directory), the LOCATION evidence (how precise the geocode is)
 * and the TERRITORY evidence (which verified beat polygons contain the point), decide - explainably - to assign a beat or
 * to open an assignment exception. Pure: no database, no network.
 *
 *   NAME HIGH        -> assign (a strong geocode that lands in a DIFFERENT beat is a conflict, not an override)
 *   NAME MEDIUM      -> assign only if a usable location agrees (inside that beat's territory); else review
 *   NAME AMBIGUOUS   -> assign only if a strong location settles it among the contenders; else exception
 *   NAME LOW / NONE  -> only a STRONG (house-level) geocode inside exactly one verified territory may assign
 *
 * A weak geocode (locality-, area- or pincode-level) NEVER assigns and NEVER overrides a name match: it is the coarsest
 * evidence there is ("Bhandup West"), so it can support a suggestion but not make one.
 */
import { GeocodingPrecision } from "@prisma/client";
import { BeatCandidate, Evidence, NameMatch } from "./beatMatcher";

export type ExceptionKind = "NO_BEAT_MATCH" | "MULTIPLE_BEAT_MATCH" | "AMBIGUOUS_MATCH" | "LOW_CONFIDENCE_MATCH" | "WEAK_LOCATION" | "GEOCODING_FAILED";
export type Method = "NAME" | "NAME_AND_TERRITORY" | "TERRITORY";

export interface LocationEvidence {
  /** SUCCESS when the address has usable coordinates. */
  located: boolean;
  precision: GeocodingPrecision;
}

export interface TerritoryHit {
  beatId: string;
  beatNumber: string;
}

/** A candidate postman for a MULTIPLE_BEAT_MATCH tie-break: one of the matched territories' active postman, and how far
 * their nearest currently-active delivery is from this one (null when they have no eligible nearby delivery at all). */
export interface NearbyPostmanCandidate {
  beatId: string;
  beatNumber: string;
  postmanId: string;
  nearestDeliveryDistanceM: number | null;
}

/** Two or more verified territories match, but exactly one candidate postman already has a delivery this close counts as
 * a safe, narrow signal to auto-assign instead of opening an exception. Deliberately small: this only catches the
 * obvious "he's already working this street" case, never a general nearest-postman search. */
export const NEARBY_DELIVERY_THRESHOLD_M = 300;

export interface DecisionInput {
  name: NameMatch;
  location: LocationEvidence;
  /** VERIFIED territories containing the point (empty when the point is missing or the location is weak: not looked up). */
  territories: readonly TerritoryHit[];
  /** One entry per matched territory beat that has an active postman, with their nearest active-delivery distance to
   * this point. Populated by the caller only when territories.length > 1 and the location is strong (a DB/geo lookup
   * that a pure decision function cannot do itself). Undefined when not computed: behaves exactly as before this field
   * existed. */
  territoryPostmen?: readonly NearbyPostmanCandidate[];
}

export interface Explanation {
  method?: Method;
  beatNumber?: string;
  confidence: number;
  /** Human-readable lines for the administrator ("Locality: FARID NAGAR", ...). */
  evidence: string[];
  /** Structured evidence for audit / research. */
  matched?: Evidence[];
  nameLevel: NameMatch["level"];
  locationQuality: GeocodingPrecision;
  territoryBeats: string[];
  contenders?: string[];
  /** Candidate postmen considered for a MULTIPLE_BEAT_MATCH tie-break (present only when territories.length > 1 and the
   * caller supplied territoryPostmen), so an admin can see who was weighed even when it still ends up an exception. */
  territoryPostmen?: NearbyPostmanCandidate[];
}

export type Decision =
  | { action: "ASSIGN"; beatId: string; method: Method; confidence: number; explanation: Explanation }
  | { action: "EXCEPTION"; reason: ExceptionKind; suggestedBeatId?: string; suggestedBeatNumber?: string; confidence?: number; message: string; explanation: Explanation };

export const isStrong = (p: GeocodingPrecision) => p === "HOUSE";
export const isUsable = (p: GeocodingPrecision) => p === "HOUSE" || p === "STREET";

/** Location quality in the words an administrator reads. */
export const QUALITY_LABEL: Record<GeocodingPrecision, string> = {
  HOUSE: "House / building level",
  STREET: "Street level",
  AREA: "Area level only",
  PINCODE: "Pincode level only",
  NONE: "No location found"
};

const label = (e: Evidence): string => {
  const what = { LOCALITY: "Locality", LOCALITY_FIELD: "Locality field", MAIN_AREA: "Main area", POST_OFFICE: "Post office", PINCODE: "Pincode" }[e.field];
  return `${what}: ${e.matched} (${e.kind === "PRESENT" ? "present" : e.kind.toLowerCase().replace(/_/g, " ")}, +${e.points})`;
};

function explain(input: DecisionInput, best: BeatCandidate | undefined, method: Method | undefined, confidence: number): Explanation {
  return {
    method,
    beatNumber: best?.beatNumber,
    confidence,
    evidence: best ? best.evidence.map(label) : [],
    matched: best?.evidence,
    nameLevel: input.name.level,
    locationQuality: input.location.precision,
    territoryBeats: input.territories.map((t) => t.beatNumber),
    contenders: input.name.contenders.length > 1 ? input.name.contenders.map((c) => c.beatNumber) : undefined,
    territoryPostmen: input.territoryPostmen ? [...input.territoryPostmen] : undefined
  };
}

export function decideAssignment(input: DecisionInput): Decision {
  const { name, location, territories } = input;
  const best = name.best;
  const only = territories.length === 1 ? territories[0] : null;
  const strongPlace = location.located && isStrong(location.precision);
  const usablePlace = location.located && isUsable(location.precision);

  if (name.level === "HIGH" && best) {
    if (strongPlace && only && only.beatId !== best.beatId) {
      return {
        action: "EXCEPTION", reason: "AMBIGUOUS_MATCH", suggestedBeatId: best.beatId, suggestedBeatNumber: best.beatNumber, confidence: best.score,
        message: `The address matches beat ${best.beatNumber}, but its precise location is inside beat ${only.beatNumber}. Please check.`,
        explanation: explain(input, best, undefined, best.score)
      };
    }
    const agrees = usablePlace && only?.beatId === best.beatId;
    const method: Method = agrees ? "NAME_AND_TERRITORY" : "NAME";
    return { action: "ASSIGN", beatId: best.beatId, method, confidence: best.score, explanation: explain(input, best, method, best.score) };
  }

  if (name.level === "MEDIUM" && best) {
    if (usablePlace && only?.beatId === best.beatId) {
      const confidence = Math.min(100, best.score + 20);
      return { action: "ASSIGN", beatId: best.beatId, method: "NAME_AND_TERRITORY", confidence, explanation: explain(input, best, "NAME_AND_TERRITORY", confidence) };
    }
    return {
      action: "EXCEPTION", reason: "LOW_CONFIDENCE_MATCH", suggestedBeatId: best.beatId, suggestedBeatNumber: best.beatNumber, confidence: best.score,
      message: `Probably beat ${best.beatNumber}, but the evidence is not strong enough to assign it automatically. Please review.`,
      explanation: explain(input, best, undefined, best.score)
    };
  }

  if (name.level === "AMBIGUOUS" && best) {
    const settled = strongPlace && only ? name.contenders.find((c) => c.beatId === only.beatId) : undefined;
    if (settled) {
      const confidence = Math.min(100, settled.score + 20);
      return { action: "ASSIGN", beatId: settled.beatId, method: "NAME_AND_TERRITORY", confidence, explanation: explain(input, settled, "NAME_AND_TERRITORY", confidence) };
    }
    const list = name.contenders.map((c) => c.beatNumber).join(", ");
    return {
      action: "EXCEPTION", reason: "AMBIGUOUS_MATCH", suggestedBeatId: best.beatId, suggestedBeatNumber: best.beatNumber, confidence: best.score,
      message: `The address fits more than one beat (${list}) equally well. Please choose the beat.`,
      explanation: explain(input, best, undefined, best.score)
    };
  }

  // The name evidence is weak or missing: only a precise location inside one verified territory may decide.
  if (strongPlace) {
    if (only) {
      const confidence = 80; // spatial evidence: not validated against house-level ground truth (none exists) - kept below name HIGH matches
      return {
        action: "ASSIGN", beatId: only.beatId, method: "TERRITORY", confidence,
        explanation: { method: "TERRITORY", beatNumber: only.beatNumber, confidence, evidence: [`Location: ${QUALITY_LABEL[location.precision]}, inside the verified territory of beat ${only.beatNumber}`], nameLevel: name.level, locationQuality: location.precision, territoryBeats: [only.beatNumber] }
      };
    }
    if (territories.length > 1) {
      // A narrow, safe tie-break: if exactly one of the matched beats' postmen already has a delivery this close,
      // that is real evidence of who actually works this stretch - not a guess. Zero or more than one candidate
      // (nobody nearby, or a tie) stays exactly as before: an exception for a human to decide.
      const nearby = (input.territoryPostmen ?? []).filter((p) => p.nearestDeliveryDistanceM != null && p.nearestDeliveryDistanceM <= NEARBY_DELIVERY_THRESHOLD_M);
      if (nearby.length === 1) {
        const winner = nearby[0];
        const confidence = 75; // a secondary heuristic, not house-level ground truth - kept below the single-territory match's 80
        const others = (input.territoryPostmen ?? []).length - 1;
        return {
          action: "ASSIGN", beatId: winner.beatId, method: "TERRITORY", confidence,
          explanation: {
            method: "TERRITORY", beatNumber: winner.beatNumber, confidence,
            evidence: [
              `Location: ${QUALITY_LABEL[location.precision]}, inside ${territories.length} verified beat territories (${territories.map((t) => t.beatNumber).join(", ")})`,
              `Beat ${winner.beatNumber}'s postman already has a delivery ${Math.round(winner.nearestDeliveryDistanceM!)} m away${others > 0 ? ` - chosen over ${others} other candidate(s) with no nearby delivery` : ""}`
            ],
            nameLevel: name.level, locationQuality: location.precision, territoryBeats: territories.map((t) => t.beatNumber),
            territoryPostmen: input.territoryPostmen ? [...input.territoryPostmen] : undefined
          }
        };
      }
      return {
        action: "EXCEPTION", reason: "MULTIPLE_BEAT_MATCH", suggestedBeatId: best?.beatId, suggestedBeatNumber: best?.beatNumber, confidence: best?.score,
        message: `The location is inside more than one beat territory (${territories.map((t) => t.beatNumber).join(", ")}). Please choose the beat.`,
        explanation: explain(input, best, undefined, best?.score ?? 0)
      };
    }
    return {
      action: "EXCEPTION", reason: "NO_BEAT_MATCH", suggestedBeatId: best?.beatId, suggestedBeatNumber: best?.beatNumber, confidence: best?.score,
      message: "The location is not inside any verified beat territory and the address is not in the beat list. Please choose the beat.",
      explanation: explain(input, best, undefined, best?.score ?? 0)
    };
  }

  if (!location.located && !best) {
    return {
      action: "EXCEPTION", reason: "GEOCODING_FAILED", message: "The address is not in the beat list and its location could not be found. Please choose the beat or correct the address.",
      explanation: explain(input, undefined, undefined, 0)
    };
  }
  return {
    action: "EXCEPTION", reason: "WEAK_LOCATION", suggestedBeatId: best?.beatId, suggestedBeatNumber: best?.beatNumber, confidence: best?.score,
    message: "Location could not be determined precisely enough to assign this delivery automatically.",
    explanation: explain(input, best, undefined, best?.score ?? 0)
  };
}

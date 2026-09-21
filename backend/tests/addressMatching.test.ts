import { describe, expect, it } from "vitest";
import { addressKey, localityTokens, normalizeAddress, tokenSimilarity, tokenize } from "../src/services/addressing/normalize";
import { DirectoryEntry, classify, matchBeatByName, scoreEntries } from "../src/services/addressing/beatMatcher";
import { Decision, decideAssignment } from "../src/services/addressing/assignmentDecision";
import { evaluate, loadCases, loadDirectory } from "../scripts/validate-matcher";

const dir = (beat: string, locality: string, mainArea: string | null = null): DirectoryEntry => ({ beatId: `b${beat}`, beatNumber: beat, locality, mainArea, pincode: "400078" });
const PO = { postOfficeName: "Bhandup West Post Office", postOfficePincode: "400078" };

const DIRECTORY: DirectoryEntry[] = [
  dir("20", "FARID NAGAR"),
  dir("21", "FARID NAGAR"),
  dir("21", "FARID NAGAR", "AFJAL CHAWL"),
  dir("20", "FARID NAGAR", "SHAM KUNG CHAWL"),
  dir("2", "VILLAGE ROAD"),
  dir("5", "VILLAGE ROAD"),
  dir("4", "BHANDUP VILLAGE ROAD"),
  dir("9", "TANAJI WADI"),
  dir("10", "TEMBHIPADA"),
  dir("3", "L.B.S MARG BHANDUP WEST"),
  dir("7", "L.B.S. ROAD, BHANDUP WEST"),
  dir("1", "ISHWAR NAGAR BHANDUP WEST"),
  dir("17", "KOKAN NAGAR")
];

describe("address normalization", () => {
  it("treats the same place written differently as the same", () => {
    const a = normalizeAddress(["Farid Nagar, Bhandup West, Mumbai"]);
    const b = normalizeAddress(["Farid Nagar Bhandup W Mumbai"]);
    expect(a.tokens).toEqual(["FARID", "NAGAR", "BHANDUP", "WEST", "MUMBAI"]);
    expect(b.tokens).toEqual(a.tokens);
  });

  it("keeps the comma-separated parts (a whole part is stronger evidence than the words somewhere)", () => {
    expect(normalizeAddress(["21 Farid Nagar, Bhandup West"]).segments).toEqual([["21", "FARID", "NAGAR"], ["BHANDUP", "WEST"]]);
  });

  it("joins dotted initials, expands abbreviations, unifies spelling and never destroys house numbers", () => {
    expect(tokenize("L.B.S. Rd")).toEqual(["LBS", "ROAD"]);
    expect(tokenize("N.C.H Colony")).toEqual(["NCH", "COLONY"]);
    expect(tokenize("Bldg 12, Shivam Apt")).toEqual(["BUILDING", "12", "SHIVAM", "APARTMENT"]);
    expect(tokenize("Nivas / Niwas")).toEqual(["NIWAS", "NIWAS"]);
    expect(tokenize("Flat 402")).toContain("402");
  });

  it("extracts the pincode and does not treat it as a word of the place", () => {
    const n = normalizeAddress(["Farid Nagar, Mumbai 400078"]);
    expect(n.pincode).toBe("400078");
    expect(n.tokens).not.toContain("400078");
  });

  it("strips the post-office area from a directory locality only when something else remains", () => {
    expect(localityTokens("ISHWAR NAGAR BHANDUP WEST")).toEqual(["ISHWAR", "NAGAR"]);
    expect(localityTokens("L.B.S. ROAD, BHANDUP WEST")).toEqual(["LBS", "ROAD"]);
    expect(localityTokens("BHANDUP VILLAGE ROAD")).toEqual(["BHANDUP", "VILLAGE", "ROAD"]);
  });

  it("tolerates small spelling differences in words of four or more letters, and only those", () => {
    expect(tokenSimilarity("TEMBHIPADA", "TEMBIPADA")).toBeGreaterThan(0.8);
    expect(tokenSimilarity("BHATTIPADA", "BHATIPADA")).toBeGreaterThan(0.8);
    expect(tokenSimilarity("RAM", "RAJ")).toBe(0);
    expect(tokenSimilarity("12", "13")).toBe(0);
  });

  it("gives one learning key to the variants of an address, whatever the order", () => {
    expect(addressKey(["21 Farid Nagar, Bhandup West, Mumbai 400078"])).toBe(addressKey(["Farid Nagar 21 Bhandup (W) Mumbai"]));
    expect(addressKey(["21 Farid Nagar"])).not.toBe(addressKey(["22 Farid Nagar"]));
  });
});

describe("matching against the beat list", () => {
  it("'Farid Nagar, Bhandup West' is a strong match for the beat that lists Farid Nagar", () => {
    const m = matchBeatByName({ parts: ["21 Farid Nagar, Bhandup West, Mumbai"], ...PO }, [dir("20", "FARID NAGAR"), dir("17", "KOKAN NAGAR")]);
    expect(m.level).toBe("HIGH");
    expect(m.best?.beatNumber).toBe("20");
    expect(m.best?.evidence.map((e) => e.field)).toContain("LOCALITY");
  });

  it("the spelling variant 'Farid Nagar Bhandup W Mumbai' matches just as well", () => {
    const m = matchBeatByName({ parts: ["Farid Nagar Bhandup W Mumbai"], ...PO }, [dir("20", "FARID NAGAR"), dir("17", "KOKAN NAGAR")]);
    expect(m.level).toBe("HIGH");
    expect(m.best?.beatNumber).toBe("20");
  });

  it("recognises a misspelt locality (fuzzy) but ranks it below an exact match", () => {
    const exact = matchBeatByName({ parts: ["Tembhipada, Mumbai"], ...PO }, DIRECTORY).best!.score;
    const fuzzy = matchBeatByName({ parts: ["Tembipada, Mumbai"], ...PO }, DIRECTORY);
    expect(fuzzy.best?.beatNumber).toBe("10");
    expect(fuzzy.best!.score).toBeLessThan(exact);
  });

  it("a locality shared by two beats is AMBIGUOUS, not guessed", () => {
    const m = matchBeatByName({ parts: ["Village Road, Bhandup West, Mumbai"], ...PO }, DIRECTORY);
    expect(m.level).toBe("AMBIGUOUS");
    expect(m.contenders.map((c) => c.beatNumber).sort()).toEqual(["2", "5"]);
  });

  it("the main area breaks a tie between beats that share a locality", () => {
    const m = matchBeatByName({ parts: ["Afjal Chawl, Farid Nagar, Bhandup West"], localityField: "Farid Nagar", ...PO }, DIRECTORY);
    expect(m.level).toBe("HIGH");
    expect(m.best?.beatNumber).toBe("21");
    expect(m.best?.evidence.map((e) => e.field)).toContain("MAIN_AREA");
  });

  it("'Village Road' is not a match of its own inside 'Bhandup Village Road', which is the longer locality", () => {
    const m = matchBeatByName({ parts: ["Bhandup Village Road, Mumbai"], ...PO }, DIRECTORY);
    expect(m.best?.beatNumber).toBe("4");
    expect(m.candidates.map((c) => c.beatNumber)).not.toContain("2");
  });

  it("'L.B.S Marg Bhandup West' finds its own beat, not the beat of 'L.B.S. Road' that merely shares a word", () => {
    const m = matchBeatByName({ parts: ["Manali Apt, L.B.S Marg Bhandup West, Mumbai, Bhandup Station Road"], ...PO }, DIRECTORY);
    expect(m.level).toBe("HIGH");
    expect(m.best?.beatNumber).toBe("3");
  });

  it("words scattered over different parts of the address are not a full match", () => {
    const m = matchBeatByName({ parts: ["Ganesh Wadi, Dattaram Nagar"], ...PO }, [dir("20", "FARID NAGAR")]);
    expect(m.level === "NONE" || m.level === "LOW").toBe(true);
  });

  it("no match at all is NONE, and an unrelated address never reaches HIGH", () => {
    expect(matchBeatByName({ parts: ["Some Other City, Delhi"], ...PO }, DIRECTORY).level).toBe("NONE");
  });

  it("the score is explainable: every point belongs to a named piece of evidence", () => {
    const [c] = scoreEntries({ parts: ["Afjal Chawl, Farid Nagar, Bhandup West Mumbai 400078"], localityField: "Farid Nagar", ...PO }, DIRECTORY);
    const total = c.evidence.reduce((s, e) => s + e.points, 0);
    expect(Math.min(100, Math.round(total))).toBe(c.score); // the sum of the evidence, capped at 100
    expect(c.evidence.map((e) => e.field).sort()).toEqual(["LOCALITY", "LOCALITY_FIELD", "MAIN_AREA", "PINCODE", "POST_OFFICE"].sort());
  });

  it("classify(): HIGH needs the score AND a clear lead; a small lead is AMBIGUOUS; a low score is LOW", () => {
    const cand = (beat: string, score: number) => ({ beatId: beat, beatNumber: beat, score, locality: "X", evidence: [] });
    expect(classify([cand("a", 90), cand("b", 40)]).level).toBe("HIGH");
    expect(classify([cand("a", 90), cand("b", 85)]).level).toBe("AMBIGUOUS");
    expect(classify([cand("a", 55), cand("b", 10)]).level).toBe("MEDIUM");
    expect(classify([cand("a", 30)]).level).toBe("LOW");
    expect(classify([]).level).toBe("NONE");
  });
});

describe("the decision: name first, weak geocoding never overrides it", () => {
  const high = matchBeatByName({ parts: ["21 Farid Nagar, Bhandup West"], localityField: "Farid Nagar", ...PO }, DIRECTORY.filter((d) => d.beatNumber !== "21"));
  const ambiguous = matchBeatByName({ parts: ["Village Road, Bhandup West, Mumbai"], ...PO }, DIRECTORY);
  const none = matchBeatByName({ parts: ["Unknown Lane"], ...PO }, DIRECTORY);
  const assignedBeat = (d: Decision) => (d.action === "ASSIGN" ? d.beatId : null);

  it("a strong name match assigns WITHOUT any geocode", () => {
    const d = decideAssignment({ name: high, location: { located: false, precision: "NONE" }, territories: [] });
    expect(d).toMatchObject({ action: "ASSIGN", method: "NAME" });
    expect(assignedBeat(d)).toBe("b20");
    expect(d.explanation.evidence.join(" ")).toMatch(/FARID NAGAR/);
  });

  it("an area-level or pincode-level geocode that points elsewhere does NOT override the strong name match", () => {
    for (const precision of ["AREA", "PINCODE"] as const) {
      const d = decideAssignment({ name: high, location: { located: true, precision }, territories: [{ beatId: "b4", beatNumber: "4" }] });
      expect(assignedBeat(d)).toBe("b20");
    }
  });

  it("a house-level geocode inside the SAME beat confirms it (NAME_AND_TERRITORY)", () => {
    const d = decideAssignment({ name: high, location: { located: true, precision: "HOUSE" }, territories: [{ beatId: "b20", beatNumber: "20" }] });
    expect(d).toMatchObject({ action: "ASSIGN", method: "NAME_AND_TERRITORY" });
  });

  it("a house-level geocode inside a DIFFERENT beat is a conflict for a person, not an override", () => {
    const d = decideAssignment({ name: high, location: { located: true, precision: "HOUSE" }, territories: [{ beatId: "b4", beatNumber: "4" }] });
    expect(d).toMatchObject({ action: "EXCEPTION", reason: "AMBIGUOUS_MATCH", suggestedBeatId: "b20" });
  });

  it("an ambiguous name with only a weak location becomes an exception that lists the contenders", () => {
    const d = decideAssignment({ name: ambiguous, location: { located: true, precision: "AREA" }, territories: [] });
    expect(d).toMatchObject({ action: "EXCEPTION", reason: "AMBIGUOUS_MATCH" });
    expect(d.explanation.contenders?.sort()).toEqual(["2", "5"]);
  });

  it("an ambiguous name is settled by a house-level location inside one of the contenders", () => {
    const d = decideAssignment({ name: ambiguous, location: { located: true, precision: "HOUSE" }, territories: [{ beatId: "b5", beatNumber: "5" }] });
    expect(d).toMatchObject({ action: "ASSIGN", method: "NAME_AND_TERRITORY", beatId: "b5" });
  });

  it("no name match + weak geocode -> WEAK_LOCATION with the explanation the admin reads", () => {
    for (const precision of ["AREA", "PINCODE"] as const) {
      const d = decideAssignment({ name: none, location: { located: true, precision }, territories: [{ beatId: "b4", beatNumber: "4" }] });
      expect(d).toMatchObject({ action: "EXCEPTION", reason: "WEAK_LOCATION" });
      if (d.action === "EXCEPTION") expect(d.message).toBe("Location could not be determined precisely enough to assign this delivery automatically.");
    }
  });

  it("no name match + a house-level location in exactly one verified territory assigns by territory", () => {
    const d = decideAssignment({ name: none, location: { located: true, precision: "HOUSE" }, territories: [{ beatId: "b9", beatNumber: "9" }] });
    expect(d).toMatchObject({ action: "ASSIGN", method: "TERRITORY", beatId: "b9" });
  });

  it("no name match + a house-level location in several territories is never guessed", () => {
    const d = decideAssignment({ name: none, location: { located: true, precision: "HOUSE" }, territories: [{ beatId: "b9", beatNumber: "9" }, { beatId: "b10", beatNumber: "10" }] });
    expect(d).toMatchObject({ action: "EXCEPTION", reason: "MULTIPLE_BEAT_MATCH" });
  });

  it("no name match + a house-level location in no territory -> NO_BEAT_MATCH", () => {
    expect(decideAssignment({ name: none, location: { located: true, precision: "HOUSE" }, territories: [] })).toMatchObject({ action: "EXCEPTION", reason: "NO_BEAT_MATCH" });
  });

  it("nothing known and nothing located -> GEOCODING_FAILED", () => {
    expect(decideAssignment({ name: none, location: { located: false, precision: "NONE" }, territories: [] })).toMatchObject({ action: "EXCEPTION", reason: "GEOCODING_FAILED" });
  });

  it("a medium name match needs a usable location inside that beat, otherwise it goes to review with a suggestion", () => {
    const medium = classify([{ beatId: "b20", beatNumber: "20", score: 55, locality: "FARID NAGAR", evidence: [] }]);
    expect(medium.level).toBe("MEDIUM");
    expect(decideAssignment({ name: medium, location: { located: true, precision: "AREA" }, territories: [] })).toMatchObject({ action: "EXCEPTION", reason: "LOW_CONFIDENCE_MATCH", suggestedBeatId: "b20", confidence: 55 });
    expect(decideAssignment({ name: medium, location: { located: true, precision: "STREET" }, territories: [{ beatId: "b20", beatNumber: "20" }] })).toMatchObject({ action: "ASSIGN", method: "NAME_AND_TERRITORY" });
  });
});

describe("validation against the 130-delivery Bhandup West ground truth (unchanged data set)", () => {
  const cases = loadCases();
  const directory = loadDirectory();

  it("never assigns a wrong beat automatically, in any view of the directory", () => {
    for (const view of ["LOCALITY-ONLY", "HOLD-OUT", "IN-SAMPLE"] as const) {
      const o = evaluate(view, { high: 65, medium: 45, margin: 15 }, cases, directory);
      expect(o.autoWrong, view).toBe(0);
    }
  });

  it("hold-out (the delivery's own main area is not in the directory): most deliveries assign by name, the rest are correctly ambiguous", () => {
    const o = evaluate("HOLD-OUT", { high: 65, medium: 45, margin: 15 }, cases, directory);
    expect(o.auto).toBeGreaterThanOrEqual(85);
    expect(o.autoCorrect).toBe(o.auto);
    expect(o.ambiguousContainsTruth).toBe(o.ambiguous); // the true beat is always among the contenders
  });

  it("the threshold choice is not on a knife edge: any high threshold from 50 to 80 gives zero wrong automatic assignments", () => {
    for (const high of [50, 65, 80]) expect(evaluate("HOLD-OUT", { high, medium: 45, margin: 15 }, cases, directory).autoWrong).toBe(0);
  });
});

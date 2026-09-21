# Address → beat matching

How a delivery gets its beat. The beat list (the localities each beat covers) is the first source of evidence; a geocode
supports it or, when the beat list has nothing to say, decides only if it is precise enough and a **verified** territory
contains it. Everything below is what the code does today
(`src/services/addressing/*`, `src/services/assignment.service.ts`).

```
delivery address
  → normalize                       (case, punctuation, abbreviations, spelling variants, dotted initials)
  → match against the beat directory (BeatLocality: locality, main area, pincode, post office of each beat)
  → score every candidate beat, from named evidence
  → confidence level: HIGH | MEDIUM | AMBIGUOUS | LOW | NONE
  → decide, together with the geocode's PRECISION and the VERIFIED territories containing the point
        ASSIGN  (method NAME | NAME_AND_TERRITORY | TERRITORY)     or     an Assignment Exception
  → store the method, the confidence and the evidence with the delivery / exception
```

The pipeline does **not** depend on geocoding: a delivery whose geocoding failed is still matched by name.

## 1. Normalization (`normalize.ts`)

`"Farid Nagar, Bhandup West, Mumbai"` and `"Farid Nagar Bhandup W Mumbai"` become the same tokens
`FARID NAGAR BHANDUP WEST MUMBAI`. Steps: fold accents and case; drop punctuation but keep the comma-separated *segments*
(a whole segment equal to a locality is stronger evidence than the words merely appearing somewhere); join dotted initials
(`L.B.S.` → `LBS`); expand abbreviations (`RD`→`ROAD`, `BLDG`→`BUILDING`, `W`→`WEST`, `NR`→`NEAR`, …); unify spelling variants
(`NIVAS`→`NIWAS`, `BHUVAN`→`BHAVAN`, `CHWL`→`CHAWL`); take a 6-digit pincode out of the words. House numbers, building names and
road names survive. A trailing post-office area (`BHANDUP WEST`) and city words are ignored when a segment is compared with a
locality, so `"21 Farid Nagar Bhandup West Mumbai"` is the locality `FARID NAGAR`.

## 2. The score (`beatMatcher.ts`) - additive, explainable

A beat's score is the sum of named pieces of evidence, capped at 100. Every point is listed in the stored explanation.

| Evidence | Points | Kinds (share of the points) |
|---|---|---|
| Locality of the beat found in the address | up to **60** | one whole segment 100 %, fuzzy segment 92 %, exact phrase 93 %, fuzzy phrase 85 %, all words in one segment 75 %, partial 55 % |
| The delivery's own locality field equals the beat's locality | **+15** (12 when fuzzy) | |
| A main area of the beat found in the address | up to **30** | same kinds |
| The post office's area is written in the address | +5 | |
| The pincode matches | +5 | |

Rules that keep the score honest:

- **No negative evidence.** The directory is incomplete (the real list is a PDF; only what was imported is known), so the
  absence of a locality never subtracts.
- **Common words count for less** (`ROAD`, `NAGAR`, `CHAWL` appear everywhere; rare words identify a place - inverse document
  frequency over the directory).
- **Spelling tolerance** for words of 4+ letters (`TEMBIPADA` ≈ `TEMBHIPADA`), never for short words (`RAM` ≠ `RAJ`) or numbers.
- **A locality inside a longer one is not a match of its own**: `VILLAGE ROAD` inside `BHANDUP VILLAGE ROAD` does not count for
  the beats that only list `VILLAGE ROAD`.
- **Scattered words are not a match**: the words of a locality must be in one segment of the address.
- One candidate per beat (its best row).

## 3. Confidence levels and thresholds

`classify()` looks at the best score and its **margin** over the best *other* beat:

| Level | Condition | Meaning |
|---|---|---|
| HIGH | best ≥ **65** and margin ≥ **15** | automatic assignment |
| AMBIGUOUS | best ≥ 45 but another beat is within 15 points | the address fits several beats equally; the contenders are listed |
| MEDIUM | 45 ≤ best < 65 (clear lead) | needs a usable location inside that beat, or review |
| LOW | 0 < best < 45 | not enough |
| NONE | no candidate | nothing in the beat list matches |

### How the thresholds were chosen (`scripts/validate-matcher.ts`, unit test `tests/addressMatching.test.ts`)

Not arbitrary: swept on the 130-delivery ground truth (the delivery file has 5 deliveries per beat, in beat order), in three
views of the same data:

| View of the directory | Auto-assigned | Correct | **Wrong** | Ambiguous (true beat among the contenders) |
|---|---|---|---|---|
| Localities only (no main areas at all) | 89 | 89 | **0** | 41 (41) |
| **Hold-out**: every main area except the delivery's own | 91 | 91 | **0** | 39 (39) |
| In-sample (full directory, includes the delivery's own row) | 129 | 129 | **0** | 1 (1) |

The **hold-out** row is the fair one: the matcher never sees the answer for the row it is judging. Across the sweep
(high 50-80, medium 35-55, margin 5-30) there are **zero wrong automatic assignments**; the chosen values sit on that plateau
rather than on an edge (a test asserts a range of `high` thresholds gives zero wrong). The ambiguous ones are real: `J.M. ROAD`
is listed under beats 11 and 14, `VILLAGE ROAD` under 2 and 5 - the system correctly refuses to guess and sends them to an
administrator with both beats as contenders.

**Not exercised by this data set:** the MEDIUM band (no delivery scored there) - its behaviour is covered by unit tests only.

## 4. The decision (`assignmentDecision.ts`) - name first, weak geocodes never override

Geocode **precision** (from what the provider says the match *is*, not how confident it sounds): `HOUSE` (a house / building),
`STREET`, `AREA` (a suburb / neighbourhood centre), `PINCODE`, `NONE`. Only HOUSE is *strong*; STREET is usable support; AREA and
PINCODE never assign anything.

| Name evidence | Location evidence | Result |
|---|---|---|
| HIGH | none / AREA / PINCODE / STREET | **Assign** (NAME) |
| HIGH | HOUSE inside the same beat's verified territory | **Assign** (NAME_AND_TERRITORY) |
| HIGH | HOUSE inside a *different* beat's verified territory | **Exception** AMBIGUOUS_MATCH, suggesting the name's beat - a conflict for a person, not an override |
| MEDIUM | STREET / HOUSE inside that beat's verified territory | Assign (NAME_AND_TERRITORY, confidence +20) |
| MEDIUM | anything else | **Exception** LOW_CONFIDENCE_MATCH, with the suggestion |
| AMBIGUOUS | HOUSE inside one of the contenders | Assign (NAME_AND_TERRITORY) |
| AMBIGUOUS | anything else | **Exception** AMBIGUOUS_MATCH, contenders listed |
| LOW / NONE | HOUSE inside exactly one VERIFIED territory | Assign (TERRITORY, confidence 80) |
| LOW / NONE | HOUSE inside several verified territories | **Exception** MULTIPLE_BEAT_MATCH - never a random pick |
| LOW / NONE | HOUSE inside none | **Exception** NO_BEAT_MATCH |
| LOW / NONE | AREA / PINCODE | **Exception** WEAK_LOCATION: *"Location could not be determined precisely enough to assign this delivery automatically."* |
| NONE | not located | **Exception** GEOCODING_FAILED |

The point-in-polygon step is PostGIS `ST_Contains` over territories that are `VERIFIED` only (a drawn or inferred polygon
awaiting verification is a draft, not evidence). TERRITORY confidence (80) is a fixed value, **not validated**: the data set has
no house-level ground truth.

Manual decisions (`overrideAssignment`, the "Assign" / "Choose Beat" buttons) are recorded as method `MANUAL`, confidence 100,
and are never overwritten by a re-run of the automatic match. "Choose Beat" gives the delivery to the beat's active postman; a
beat nobody covers keeps a `NO_POSTMAN_ASSIGNED` exception open instead of pretending the delivery is done.

## 5. What is stored (audit / debugging / research)

- **Delivery**: `assignmentMethod`, `assignmentConfidence` (0-100), `assignmentEvidence` (JSON: the beat, the match kinds and
  points, the location quality, the territories that contained the point, the contenders). Shown on the delivery page.
- **AssignmentException**: `reason`, `details` (the sentence an administrator reads), `suggestedBeatId`, `confidence`,
  `locationQuality`, `evidence`. The Assignment Exceptions page shows the delivery, recipient, address, suggested beat
  (`B20 — Farid Nagar`), confidence (`92% — High`, levels from the same thresholds; a high score that two beats share is labelled `Ambiguous`, not High), reason, location quality, and the actions
  **Assign** (accept the suggestion), **Choose Beat**, **Ignore**.
- `DeliveryAssignmentHistory` keeps every change with who / why.

## 6. When it runs

On import (`confirmImport`), on single delivery creation, after a geocode retry or a manual pin, after a beat / locality /
territory changes (`rematchOfficeDeliveries`), and at start-up for deliveries stranded by a crash
(`repairUnassignedDeliveries`). Only deliveries in `RECEIVED / SORTED / ASSIGNED / RESCHEDULED` with no manual override are
(re)decided; a delivery already out for delivery is never pulled back.

## 7. Limits

- The beat directory is only as good as its import: 26 beats / 201 locality rows here; the full source list is a PDF that is not
  parsed (CSV / XLSX only).
- `BeatLocality` rows come from the file; for a beat with none, the descriptive part of its name (`Beat 20 - Farid Nagar`) is used.
- Ground truth for the accuracy test is the file's own layout. The test's main areas come from the same file as the deliveries,
  so a NAME match on the full directory is close to a lookup of the answer key; use the hold-out figures for what the matcher
  itself achieves.
- The coordinates the geocoder returns for the test addresses are OpenStreetMap anchors near the named places, not the houses:
  nothing here measures house-level location accuracy.

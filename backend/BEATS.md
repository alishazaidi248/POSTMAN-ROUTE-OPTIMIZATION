# Beats: beat list, territories, import and verification

Everything about a beat lives in PostgreSQL/PostGIS. The admin panel only shows and changes it through the API.

A beat has two independent kinds of description, and both matter:

- its **beat directory** - the localities and main areas it covers (`BeatLocality` rows). This is what an address is matched
  against first (see `ADDRESS_MATCHING.md`); it needs no coordinates.
- its **territory** - a polygon (`Beat.boundary`, PostGIS `geometry(Polygon, 4326)`). Used as the spatial fallback, and only
  when it is **verified**.

## Territory states

Every beat has a `verificationStatus` (table `Beat`); the admin panel shows it with an indicator:

| Indicator | Value | Meaning |
|---|---|---|
| ✓ Verified | `VERIFIED` | An administrator looked at the territory on the map and confirmed it (`verifiedAt`, `verifiedById`). |
| ⚠ Needs verification | `PENDING_VERIFICATION` | A territory exists but nobody has confirmed it (a beat-list import; a territory edited without verifying). |
| ❌ Missing territory | `NEEDS_REVIEW` | The beat has no territory yet. It cannot be verified until one is drawn. |
| ⚠ Overlapping B21 | (computed) | The territory overlaps another active beat by more than the sliver tolerance. Shown on the map as a heavy dashed outline, in the list, and in the beat panel. |

- Only **verified** territories take part in matching a delivery (`findContainingBeats`); a pending territory is a draft. When
  a beat is verified, deliveries are re-matched.
- The database refuses `VERIFIED` without a territory (`Beat_verified_needs_territory`).
- A beat drawn on the map starts `VERIFIED` (the administrator drew and saved it). Editing a territory sets
  `PENDING_VERIFICATION` unless the request says `verified: true`.
- **Nothing infers "verified"**: the Bhandup West set-up script (`scripts/setup-bhandup.ts`) imports territories inferred from
  OpenStreetMap anchor points and leaves them `PENDING_VERIFICATION` - they are a starting point to check, not a survey. The
  inferred shape is an axis-aligned **rectangle** (the anchors' bounding box, with a margin; a single anchor gets a small
  square around it) - not a circle, which a convex-hull-and-buffer around one or two points would degenerate into.

### What is checked when a territory is saved (`analyseTerritory`, PostGIS)

| Check | Rule |
|---|---|
| Valid shape | `ST_IsValid` - a self-intersecting (bow-tie) outline is refused, with PostGIS's reason |
| Coordinates | WGS84 longitude / latitude within range (Zod) |
| Size | between **1 000 m²** and **25 km²** |
| Position | the centre must be within **30 km** of its post office (catches a swapped latitude / longitude or the wrong city) |
| Overlap | the intersection with every other **active** beat of the office larger than **25 m²** (smaller is drawing noise along a shared edge) |

An invalid territory is refused with `400`. An **overlap is never accepted silently**: the request is refused with `409`
and the sentence `"Beat 30 overlaps Beat 20 (1,234 m²)."` unless it carries `acknowledgeOverlap: true` (the panel asks the
administrator to confirm). Verifying an overlapping beat needs the same acknowledgement. An address inside two verified
territories is an `MULTIPLE_BEAT_MATCH` exception, never a random pick.

`GET /beats/territory-report` returns, per office: how many beats are verified / need verification / are missing / overlap,
each beat's state and area, and every overlapping pair - read from PostGIS on each call.

## Beat-list import (`/api/v1/beats/import`, back-office roles only)

Workflow: **upload → validate → preview → map columns → review → import → verify** (the wizard in the admin panel).

| Call | What it does |
|---|---|
| `POST /` (multipart `file`, `.xlsx`, `.csv` or a text-based `.pdf`) | Reads the list and **holds** it (`BeatImport`). Nothing is imported. Returns the checked rows. |
| `GET /:id` | The checked list again (re-validated against the current database). |
| `PUT /:id/mapping` | Change which column is which; the list is checked again. |
| `GET /:id/errors.csv` | The problem report (one line per row that is skipped, warned or refused). |
| `POST /:id/confirm` | Writes beats, their locality records and the directory in one transaction; waiting deliveries are re-matched. Audit: `BEAT_IMPORTED`. |
| `POST /:id/cancel` | Discards the held list. |

**The format is not assumed.** Columns are matched by common names (`Beat No`, `Beat Name` / `Sector`, `Post Office`,
`Locality`, `Main Area`, `Pincode`, `Boundary` / `Territory`, `Latitude`, `Longitude`); the header row is found even below
title rows; the administrator can correct any match. Only the beat number is required. A `.pdf` is read as text (columns split
on a tab or two-or-more spaces, the same heuristic as delivery-list PDFs); a scanned/image-only PDF is refused with a message
asking for Excel, CSV or a text-based PDF instead. The post office column is matched against India Post's own naming
(`... S.O.`, `H.O.`, `B.O.`, `Post Office`, `PO`): a role suffix on either side is stripped before comparing, so `"Bhandup West
So"` in a file matches a `"Bhandup West Post Office"` record.

### Two shapes of list

- **One row per beat** (no locality column mapped): a beat number that repeats is an error, as before.
- **One row per (beat, locality)** (a *Locality* and/or *Main Area* column mapped): the rows of one beat number are ONE beat with
  several localities. Each row becomes a `BeatLocality` record (`locality`, `mainArea`, `pincode`, normalised forms for
  matching, `source = IMPORT:<id>`); a beat is created once, from its first row (name, territory). A beat that already exists
  only receives the localities it does not have yet. The same locality under **two different beats is legitimate** - it is
  exactly what makes an address ambiguous.

Row rules: a missing beat number, an unknown post office, a post office that is not the administrator's own, a main area
without its locality, and a territory that cannot be read, that PostGIS finds invalid, or that is too small / too large / too
far from its post office are **errors** (the row is not imported) - the same checks `analyseTerritory` runs for a directly
drawn territory. A territory that overlaps another active beat of the same office is a **warning**, not an error: the beat is
still imported, with the overlap named in its message. A row that repeats a (beat, locality, main area) is **reported and adds
nothing** - never dropped silently. An invalid pincode is ignored with a warning; a beat with no territory is a warning
(imported as `NEEDS_REVIEW`).

The preview counts, before anything is written: rows, new beats, existing beats receiving localities, locality records to add,
repeated rows, unknown post offices, missing beat numbers, invalid rows, beats with no locality, beats without a territory.

## Audit actions

`BEAT_CREATED`, `BEAT_IMPORTED`, `BEAT_UPDATED`, `BEAT_TERRITORY_UPDATED`, `BEAT_VERIFIED`, `BEAT_POSTMAN_ASSIGNED`, `BEAT_DEACTIVATED`.

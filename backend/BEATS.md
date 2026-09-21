# Beats: import, territory and verification

Everything about a beat lives in PostgreSQL/PostGIS. The admin panel only shows and changes it through the API.

## Verification

Every beat has a `verificationStatus` (table `Beat`):

| Value | Meaning |
|---|---|
| `VERIFIED` | An administrator looked at the territory on the map and confirmed it (`verifiedAt`, `verifiedById` say when and who). |
| `PENDING_VERIFICATION` | A territory exists but nobody has confirmed it yet (a beat-list import; a territory that was edited without verifying). |
| `NEEDS_REVIEW` | The beat has no territory yet (an import row without one). It cannot be verified until one is drawn. |

* Only **verified** territories take part in matching a delivery to a beat (`findContainingBeats`). A pending beat never
  receives parcels; when it is verified, deliveries are re-matched.
* A beat drawn on the map starts `VERIFIED` (the administrator drew it). Editing a territory sets `PENDING_VERIFICATION`
  unless the request says `verified: true` (the panel does this when the beat was already verified).
* The database refuses `VERIFIED` without a territory (`Beat_verified_needs_territory`).

## Beat-list import (`/api/v1/beats/import`, back-office roles only)

| Call | What it does |
|---|---|
| `POST /` (multipart `file`, `.xlsx` or `.csv`) | Reads the list and **holds** it (`BeatImport`). Nothing is imported. Returns the checked rows. |
| `GET /:id` | The checked list again (re-validated against the current database). |
| `PUT /:id/mapping` | Change which column is which; the list is checked again. |
| `GET /:id/errors.csv` | The error report (one line per row that has a problem). |
| `POST /:id/confirm` | Writes the importable rows in one transaction. Rows with errors are skipped. Audit: `BEAT_IMPORTED`. |
| `POST /:id/cancel` | Discards the held list. |

**The format is not assumed.** Columns are matched by common names (`Beat No`, `Beat Name` / `Sector`, `Post Office`,
`Boundary` / `Territory`, `Latitude`, `Longitude`); the header row is found even below title rows; the administrator
can correct any match. Only the beat number is required.

Row rules: a missing beat number, a number repeated in the file, a beat that already exists, an unknown post office, a
post office that is not the administrator's own, and a territory that cannot be read or that PostGIS rejects are
**errors** (the row is not imported). A row with no territory is a **warning** (imported as `NEEDS_REVIEW`).
Territories may be GeoJSON (Polygon / Feature) or WKT `POLYGON((lng lat, ...))`.

## Audit actions

`BEAT_CREATED`, `BEAT_IMPORTED`, `BEAT_UPDATED`, `BEAT_TERRITORY_UPDATED`, `BEAT_VERIFIED`, `BEAT_POSTMAN_ASSIGNED`, `BEAT_DEACTIVATED`.

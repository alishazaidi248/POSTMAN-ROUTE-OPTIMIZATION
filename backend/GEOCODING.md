# Geocoding, location precision and address learning

## The service

`GeocodingService` (`src/services/geocoding/GeocodingService.ts`) is the only thing the rest of the system knows. A provider
implements `geocode(query) → GeocodeResult` and nothing else changes when it is swapped (`GEOCODING_PROVIDER`):

| Provider | Setting | Notes |
|---|---|---|
| Nominatim (OpenStreetMap) | `nominatim` (default) | free; ≥ 1.1 s between requests (their policy); set a real `NOMINATIM_USER_AGENT` |
| Google Geocoding | `google` | needs `GOOGLE_GEOCODING_API_KEY` (a secret: environment only) |
| none | `none` | no external call; every address is "not located". Delivery is assigned by the beat list, the rest go to exceptions. Used by the browser tests and for offline installations. |

A result carries: `latitude`, `longitude`, `confidence` (the provider's own, capped by how specific the query that matched was),
`source` (the query tier / provider), `status`, **`precision`**, `components` (house number, road, locality, city, state,
pincode - what the provider says the match *is*), and provider metadata (kept in `Address.geocodingMeta` for audit).

Each provider tries the full address first, then falls back to `area, city, pincode`, then `city, pincode`, so a delivery still
gets *a* point - tagged with the precision of what was actually found.

## Precision (`precision.ts`) - what makes a point trustworthy

| Precision | Means | Used for |
|---|---|---|
| `HOUSE` | a house number / building / rooftop match | strong evidence: may assign inside a verified territory |
| `STREET` | a road or interpolated address | usable support, never decisive alone |
| `AREA` | the centre of a suburb / neighbourhood | never assigns; supports a suggestion |
| `PINCODE` | the centre of a postal area | never assigns; **not routed** (`IMPRECISE_LOCATION`) |
| `NONE` | not located | - |

It comes from the provider's own description of the match (Nominatim `class` / `type` / `addresstype` and `address` parts;
Google `location_type` and `types`), **capped by the query tier** - a house-like match returned for a fallback "area, city"
query is `AREA`. An unknown kind of match is `AREA`, never precise. Legacy rows were classified from their `source` tag by
the migration (a full-address hit is `STREET`: never assumed to be the house). A pin an administrator places by hand is `HOUSE`.

## Address learning (`addressLearning.service.ts`, `addressing/locationLearning.ts`)

A delivery completed with a good GPS fix teaches the system where that address is; the next delivery to it reuses the learned
point **before any geocoder is asked**.

- The postman's app sends its own recent GPS fix (never the address's coordinates) with the `DELIVERED` status.
- **A key names one place** only if the normalised address has a house / unit number and at least two other words
  (`21 FARID NAGAR`); `FARID NAGAR` alone is a whole neighbourhood and is never learned. The key ignores order, punctuation,
  case, and the words every address of the office carries (`BHANDUP`, `WEST`, `MUMBAI`).
- **A sample is accepted only if** its stated accuracy is ≤ 50 m (a fix that does not state one is rejected), it is within
  1 000 m of an existing HOUSE / STREET geocode of the same address, and within 150 m of the samples already accepted. Rejected
  samples are stored with the reason (`AddressLocationSample.accepted = false`, `note`), never silently dropped.
- The stored point is the **median** of accepted samples (one bad fix cannot drag it). One sample is `STREET` quality, two
  that agree within 60 m are `HOUSE` quality - so a learned location can decide a territory assignment only after two
  deliveries agree.
- Learning is a by-product: it never fails or delays the delivery.

## What is not measured

The precision rules were written from the providers' documented result types and are unit-tested
(`tests/geocodingLearning.test.ts`); they have not been validated against a survey of real house positions, because none
exists here. The learning thresholds (50 m / 150 m / 1 km) are conservative defaults, not calibrated values.

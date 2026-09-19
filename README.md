# Postal Delivery Operations & Optimization System

Admin platform for urban postal delivery operations: multiple post offices,
each with multiple beats, each with multiple postmen, each handling multiple
deliveries. Bhandup West Post Office (Mumbai) is seeded as pilot demo data —
no Bhandup-specific assumptions are hardcoded into the schema or logic.

## Stack

- **Backend**: Node.js, TypeScript, Express, PostgreSQL + PostGIS, Prisma
- **Frontend**: React, TypeScript, Vite, React Router, TanStack Query, React
  Hook Form + Zod, Axios, MapLibre GL JS (OSM-compatible tiles), CSS Modules

## Running locally

```bash
# 1. Database (PostgreSQL + PostGIS)
docker compose up -d

# 2. Backend
cd backend
cp .env.example .env
npm install
npm run prisma:migrate    # creates schema + enables postgis extension
npm run prisma:seed       # seeds Bhandup West demo data (admin login below)
npm run dev                # http://localhost:4000, docs at /api/docs

# 3. Frontend
cd frontend
npm install
npm run dev                # http://localhost:5173
```

Seeded login: `admin.bhandup@postal.local` / `ChangeMe123!`
(also `superadmin@postal.local` / `ChangeMe123!` for the SUPER_ADMIN role).

## Architecture notes

- **OptimizationService** (`backend/src/services/optimization`) is the sole
  seam for the external research optimization engine (GA/ACO/ALNS,
  clustering, energy-aware routing, etc). `MockOptimizationService` returns
  deterministic development data only — no research algorithm is
  implemented in this application, by design.
- **GeocodingService** (`backend/src/services/geocoding`) abstracts the OSM
  geocoder (Nominatim by default) behind an interface so the provider can be
  swapped without touching import/assignment code. Geocoding always happens
  server-side, is cached, and respects Nominatim's rate-limit policy.
- **Beat assignment** uses PostGIS `ST_Contains` point-in-polygon queries
  (`backend/src/services/assignment.service.ts`), never nearest-center
  distance.
- **Multi-post-office isolation** is enforced at the API layer via
  `resolvePostOfficeScope` (`backend/src/middleware/auth.ts`), not by
  frontend filtering.
- **Research Analytics** endpoints only ever return real, stored
  `OptimizationResult` rows — never fabricated cluster/Ripley's K data.

## Known gaps (explicitly out of scope for this pass)

- PDF OCR for scanned documents is detected but not executed (no OCR engine
  wired in yet); such files are flagged for manual review/re-upload.
- Live postman GPS ingestion, route re-optimization triggering, and the
  React Native postman app are not implemented — the event bus
  (`services/events.service.ts`) and `postman_location_history` schema are
  in place for them to plug into later.
- No automated test suite yet.

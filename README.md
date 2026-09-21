# Postal Delivery Operations System

Operations software for urban postal delivery: post offices, their beats (a postman's area), postmen, and the deliveries they
carry. Three parts, one source of truth (the backend and its PostgreSQL / PostGIS database):

| Part | Folder | What it is |
|---|---|---|
| Backend | `backend/` | Express + TypeScript + Prisma on PostgreSQL / PostGIS. REST API under `/api/v1`, docs at `/api/docs`. |
| Admin panel | `frontend/` | React + Vite for post office staff: beats and territories, imports, assignment exceptions, postmen, deliveries, map. |
| Postman app | `PostmanApp/` | Expo / React Native for postmen: today's round in route order, navigation, status, proof of delivery, offline queue, history. |

Bhandup West Post Office (Mumbai) is the pilot; nothing about it is hard-coded in the schema or the logic.

## What it does

1. **Address → beat matching.** A delivery's address is normalised and matched against the beat list (the localities each
   beat covers); a confidence score with named evidence decides between *assign*, *review* and *exception*. A geocode supports
   the match, and decides alone only when it is house-precise and lies inside exactly one **verified** territory. A weak
   geocode never assigns anything and never overrides a strong name match. → [`backend/ADDRESS_MATCHING.md`](backend/ADDRESS_MATCHING.md)
2. **Beats and territories.** Import a beat list (CSV / XLSX, several rows per beat), draw / edit / verify territories on a
   map, with PostGIS validation and overlap detection. → [`backend/BEATS.md`](backend/BEATS.md)
3. **Geocoding.** A provider-independent service (Nominatim, Google, or none) returning coordinates **and how precise they are**,
   plus address learning from completed deliveries. → [`backend/GEOCODING.md`](backend/GEOCODING.md)
4. **One route optimizer.** Road time matrix (OSRM) → DBSCAN → Nearest Neighbor → 2-opt → ALNS → best route → OSRM geometry.
   No algorithm selector. → [`backend/ALNS.md`](backend/ALNS.md)
5. **Field work.** The postman's app: the route, navigation, status changes through a server-validated state machine, an
   optional **proof-of-delivery photo** a post office can require, an **offline queue** with conflict handling, history,
   push notifications.
6. **Audit and access.** Roles (SUPER_ADMIN / ADMIN / POSTMAN), post-office isolation enforced in the API, an audit log,
   forced password change on first sign-in.

## Running locally

```bash
# 1. PostgreSQL + PostGIS
docker compose up -d

# 2. Backend
cd backend
cp .env.example .env            # edit the JWT secrets
npm install
npx prisma migrate deploy       # applies backend/prisma/migrations
npm run prisma:seed             # demo data; prints the seeded accounts' one-time password
npm run dev                     # http://localhost:4000  (API docs at /api/docs)

# 3. Admin panel
cd frontend && npm install && npm run dev          # http://localhost:5173

# 4. Postman app (web build for development; native builds need a development build)
cd PostmanApp && npm install && cp .env.example .env
npx expo start --web --port 8081
```

**Passwords.** No password is written in the source. `npm run prisma:seed` uses `SEED_PASSWORD` if set, otherwise a random
one it prints once. Every account created by someone else (the seed, the administrator creating a user or a postman's login,
a reset) starts with a **temporary password**: the admin panel and the Postman app show a *Choose a new password* screen
instead of the application until it is replaced, and the server refuses every other endpoint to that login
(`403 PASSWORD_CHANGE_REQUIRED`) until then. Rules: 10+ characters, a letter and a number, not the email name, not a
well-known password. Sign-in is rate-limited (`AUTH_RATE_LIMIT`, 20 per 15 minutes per address by default).

## Configuration

`backend/.env.example` documents every setting. The important ones:

| Variable | Default | |
|---|---|---|
| `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | - | required |
| `GEOCODING_PROVIDER` | `nominatim` | `nominatim`, `google` (needs `GOOGLE_GEOCODING_API_KEY`) or `none` |
| `OSRM_BASE_URL` | empty | road routing; empty = flagged straight-line estimates. The public demo server is for development only. |
| `PUSH_ENABLED`, `EXPO_ACCESS_TOKEN` | `true`, empty | push notifications through Expo (the token is a secret and optional) |
| `MAX_PROOF_PHOTO_MB` | `5` | proof-of-delivery photo size limit |
| `AUTH_RATE_LIMIT` | `20` | sign-in attempts per 15 minutes per address |

Proof of delivery is a **per-post-office setting** (Dashboard → *Proof of delivery*): nothing extra, or a photo of the
delivery. With a photo required the server refuses `DELIVERED` without it - the app only helps the postman comply. Photos are
stored in a private folder and are readable only by the delivery's postman and the post office's administrators. OTP and
signature proof are **not** implemented (OTP needs an SMS provider this system does not have).

## Tests and CI

| | Command | What it runs |
|---|---|---|
| Backend | `cd backend && npm run typecheck && npm run lint && npm run build && npm test` | unit tests (matcher, decision, routing, import, push, status machine, API with mocked storage) |
| Backend, real database | `npm run test:integration` | the whole assignment pipeline, territories, proof, passwords on a real PostGIS database (`DATABASE_URL` must name a database ending in `_test`: it is wiped) |
| Admin panel | `cd frontend && npm run typecheck && npm run lint && npm test && npm run build` | |
| Postman app | `cd PostmanApp && npm run typecheck && npm run lint && npm test` | |
| Browser tests | see [`e2e/README.md`](e2e/README.md) | admin sign-in, forced password change, beat upload, beat verification, delivery assignment, exceptions, postman sign-in, route order, delivery completion - in a real Chrome against a real backend |

`.github/workflows/ci.yml` runs all of the above on every push and pull request. Nothing is skipped.

Validation scripts (they print what they measure): `npm run matcher:validate` (address matching on the 130-delivery ground
truth), `npm run route:bench`, `npm run route:clusters`, `npx tsx scripts/accuracy-assignment.ts`.

## Architecture notes

- **One database, one source of truth.** Business rules (matching, thresholds, the status machine, password rules, proof
  requirements, confidence levels shown to administrators) live in the backend; the apps display them. localStorage / the
  phone's storage hold only conveniences (a session, an offline queue) - never business data that could disagree with the server.
- **Assignment** never depends on geocoding alone and never picks between two equally good beats.
- **Multi-post-office isolation** is enforced in the API (`resolvePostOfficeScope`, `assertOwnsResource`), not by the panels.
- **Every automatic assignment is explained**: the method, the confidence and the evidence are stored with the delivery.

## Known limitations

See the last section of `Postal-Delivery-System-Guide.pdf`. In short: the source beat list is a PDF that is not parsed; the
matching accuracy figures for the supplied test data are partly circular (the beat directory of the test file contains each
delivery's own locality) - use the hold-out figures; geocoded test coordinates are OpenStreetMap anchors, not house
positions; time windows and OTP / signature proof are not implemented; push delivery to a phone cannot be verified without a
device and Expo's servers.

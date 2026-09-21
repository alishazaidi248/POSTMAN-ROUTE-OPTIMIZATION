# Data persistence and synchronisation

PostgreSQL + PostGIS is the only source of truth. The admin panel and the Postman
app hold sessions (tokens), UI state and an offline cache - never business data.

```
Admin Panel --\                                   /-- GET /me/profile, /me/stats,
               >--> Express REST API --> Prisma --> PostgreSQL/PostGIS    /me/deliveries, /me/route
Postman App --/     (authz + tenancy)                  (the truth)        (identity = JWT -> User.postmanId)
```

## Rules the code enforces

- **Writes go to the database first.** Admin mutations call the API; on completion (success
  *or* failure) every active TanStack query is refetched (`frontend/src/main.tsx`). Nothing is
  patched into the cache by hand.
- **Beats**: `POST /beats` validates the polygon (closed ring, ranges, PostGIS `ST_IsValid`,
  non-zero area), saves it as `geometry(Polygon,4326)` and (optionally) its postman in ONE
  transaction, then returns the row read back from PostgreSQL. `GET /beats` and
  `GET /maps/beats` rebuild the GeoJSON from that column.
- **One writer for assignments** (`backend/src/services/assignment.service.ts`): the beat's
  active postman, `Postman.assignedBeatId` and the beat's parcels change together, in one
  transaction. Handing a beat to another postman moves its open parcels
  (SORTED/ASSIGNED/RESCHEDULED); parcels out for delivery, finished, or assigned by hand stay put.
  Clearing a beat's postman releases the parcels to the admin's exception queue.
  Partial unique indexes make "one active postman per beat / one beat per postman" impossible to violate.
- **Deliveries**: import = upload -> preview (rows stored) -> confirm (row-by-row transactions;
  a bad row is marked, never blocks the rest) -> geocode -> PostGIS `ST_Contains` -> beat's
  postman. `POST /deliveries` does the same for one delivery. A crash between "saved" and
  "matched" is repaired at startup.
- **Postman identity**: server-side only. `/me/*` resolve `JWT.sub -> User.postmanId -> Postman`
  on every call and ignore any id in the request. A disabled account is refused immediately.
- **Isolation**: every router except `/auth`, `/me` and `/notifications` is back-office only
  (a POSTMAN token gets 403, including `GET /deliveries`); records are scoped to the caller's
  post office (404 for another office's id); links between records require the same post office.
- **Schema**: managed by Prisma migrations (`prisma/migrations`). Apply with `npm run db:migrate`
  (`prisma migrate deploy`). Never `migrate reset`, `db push --force-reset` or DROP DATABASE.

## Verification procedure (against a running backend, nothing is ever reset)

```bash
cd backend
npm run db:verify -- setup       # creates Beat 100 (+polygon), Test Postman A/B (+logins), TEST001, TEST002
npm run db:verify -- verify      # fresh login: admin + postman read everything back  (repeat freely)
#   ... restart the backend process ...
npm run db:verify -- verify      # after the restart
npm run db:verify -- sync        # Beat 100 A -> B -> none -> A: both postmen's /me/* follow
npm run db:verify -- isolation   # a second post office's admin cannot see or touch the first
```

`verify` starts a brand-new session every time, which is what a browser refresh,
log out / log in, or a second device looks like to the server. Test records are named
`TEST-*` / "Test ..." and are reused on re-runs.

Automated: `npm test` (backend, mocked DB), `npx jest` (app).

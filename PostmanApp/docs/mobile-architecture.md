# Mobile Architecture

## System diagram

```
                PostgreSQL + PostGIS
                         |
                Node.js + Express (../PostmaAppAdminPanel/backend)
                         |
                     REST API (/api/v1)
             +-----------+-----------+
             |                       |
       React Admin Panel      React Native Postman App
   (../PostmaAppAdminPanel/         (this project)
         frontend)                       |
                            +------------+------------+
                            |                         |
                      GPS / Location            MapLibre + OSM
                            |
                       Route Display
                            |
                    Dynamic Re-routing (via /me/route/reoptimize)
                            |
                    Backend Optimization (server-side, mock today)
```

The admin panel and this app are two independent REST clients of the same
backend and database. They never call each other, and this app never touches
Postgres directly. Business rules (who can see which delivery, which status
transitions are legal, who owns which beat) are enforced server-side; the
mobile app's own checks are UX convenience only.

## Research/optimization boundary

The mobile app **consumes** a route result; it never implements a routing
algorithm. The intended pipeline (server-side, spec §14) is:

```
Assigned Deliveries -> Spatial Clustering (DBSCAN) -> Cluster-aware Ordering
  -> Nearest Neighbour -> 2-opt -> Road-network Routing (OSRM) -> Polyline
  -> React Native Map
```

**Current backend reality** (see architecture report and
`backend/src/services/optimization/MockOptimizationService.ts`): only a
placeholder `MockOptimizationService` exists today. It sequences deliveries
in input order with a fixed per-stop ETA — no DBSCAN, nearest-neighbor,
2-opt, or OSRM integration yet, and stops carry no road-network polyline
(the app draws a straight-line connector between stops as a visual aid, see
`src/components/route/RoutePolyline.tsx`). The app's UI deliberately says
"Optimized Route" / "Generated Route", never "optimal route" (spec §15/§49) —
this is not a UI nuance, it reflects that the backend cannot currently back a
stronger claim.

## Route response contract

`GET /api/v1/me/route` (added for this app; see
`backend/src/routes/me.routes.ts`):

```jsonc
// No route yet generated for this postman today:
{ "route": null }

// An active route exists:
{
  "routeId": "uuid",              // OptimizationRequest.id
  "version": 1,                    // count of OptimizationResult rows for this request
  "trigger": "ROUTE_PLAN" | "REOPTIMIZE",
  "status": "COMPLETED",
  "generatedAt": "2026-09-19T09:00:00.000Z",
  "solution": {
    "postmanId": "uuid",
    "beatId": "uuid",
    "stops": [
      { "deliveryId": "uuid", "sequence": 1, "latitude": 19.148, "longitude": 72.930, "estimatedArrival": "2026-09-19T09:10:00.000Z" }
    ],
    "totalDistanceMeters": 4200,
    "estimatedDurationMinutes": 38,
    "algorithm": "MOCK",
    "generatedAt": "2026-09-19T09:00:00.000Z"
  }
}
```

`POST /api/v1/me/route/reoptimize` `{ "trigger": "DELIVERY_COMPLETED" | "RECIPIENT_UNAVAILABLE" | "WRONG_ADDRESS" | "ADDRESS_NOT_FOUND" | "DELIVERY_FAILED" | "ROUTE_DEVIATION" | "MANUAL" }`
re-plans the postman's remaining (`ASSIGNED`/`OUT_FOR_DELIVERY`/`RESCHEDULED`)
deliveries and returns the same `{ routeId, generatedAt, solution }` shape.
The app calls this after a status update that removes a delivery from the
active route (`src/screens/deliveries/DeliveryDetailsScreen.tsx`), and could
also call it on a detected GPS route deviation (deviation detection exists in
`src/services/routeService.ts`; wiring an automatic trigger from the Map
screen is a follow-up, not yet done — see Known Limitations in the final
report).

There is no dedicated `Route`/`RouteStop` REST surface yet (those Prisma
tables exist but nothing reads/writes them) — "route version" here is
approximated by counting `OptimizationResult` rows per
`OptimizationRequest`, not a first-class version field. This is a
reasonable approximation, not the ideal long-term shape; see Known
Limitations.

## Authentication

Reuses the backend's existing JWT login exactly (`/auth/login`,
`/auth/refresh`, `/auth/logout`, `/auth/me`) — see
`backend/src/services/auth.service.ts` and `src/api/authApi.ts`. On login,
the mobile app (client-side convenience only) rejects:

- any `role !== "POSTMAN"` — this app is postman-only.
- a POSTMAN account with `postmanId: null` — not yet linked to a Postman
  profile by an admin.

Identity for every `/me/*` call is re-derived server-side from the verified
access token (`req.user.sub -> User.postmanId -> Postman`), never from a
client-supplied id — see `backend/src/services/postmanSelf.service.ts`. The
same file's `assertPostmanOwnsDelivery` was added to
`GET /deliveries/:id` and `POST /deliveries/:id/status` so a POSTMAN login
can only reach deliveries assigned to their own Postman record (previously
any authenticated POSTMAN could read/mutate any delivery in their post
office by guessing an id — see the architecture report's gap analysis).

## Offline architecture

```
Action while offline (e.g. mark delivered)
        |
enqueue({ type: "DELIVERY_STATUS_UPDATE", deliveryId, status, reason, ... })
        |  (src/store/offlineStore.ts, persisted via src/storage/offlineStorage.ts)
        v
   AsyncStorage queue survives app restart
        |
Connectivity returns (NetInfo listener, src/hooks/useOfflineSync.ts)
        |
processQueue() (src/services/syncService.ts)
        |
   FIFO: apply each queued mutation via deliveryApi.updateStatus
        |
   +----+-------------------------+
   |                              |
 success                    backend rejects (400 = invalid
   |                        transition per the state machine)
 dequeue,                         |
 invalidate                 re-fetch authoritative delivery,
 queries                    record a conflict, dequeue (never
                             blindly retried, never overwrites)
```

A genuine network failure during drain stops processing (preserving order)
and leaves the remainder queued for the next reconnect. Conflicts are
surfaced to the store (`useOfflineStore.conflicts`) for the UI to show; the
Deliveries/Map screens currently invalidate and re-fetch on conflict but do
not yet render a dedicated conflict banner — see Known Limitations.

## GPS architecture

`src/services/locationService.ts` wraps `expo-location`. Ping cadence
(`src/hooks/useLocation.ts`) is 30s while a route is active, 3min when idle.
Pings are sent to `POST /api/v1/me/location` (added for this app; previously
`PostmanLocationHistory` was read-only — see architecture report §10) and are
best-effort: a failed ping is dropped, never queued, since a slightly stale
location is not worth retry complexity.

Route-deviation detection (`src/utils/distance.ts`,
`src/services/routeService.ts`) requires both distance *and* GPS accuracy to
clear a threshold (200m) before treating a reading as a real deviation, so
normal jitter or a poor fix doesn't falsely trigger anything.

## Notifications

No push-notification infrastructure exists on the backend today (no device
token registration endpoint, no server-side push job). Server-driven push
(new assignment, admin message, route re-optimization) is **not**
production-ready — `src/services/notificationService.ts` only wraps local,
on-device notifications and documents exactly what backend work
(`POST /api/v1/me/notifications/push-token` + a push-sending job) would be
needed to make it real. Do not present this as a working feature.

## Known limitations (honest, not exhaustive)

- Optimization is a mock (see above) — route quality and "optimized"
  language should be read accordingly.
- No road-network polyline from the backend yet; the map draws a straight
  line between stops.
- No dedicated Route/RouteStop/version REST surface; version is
  approximated from `OptimizationResult` count.
- Automatic reoptimize-on-GPS-deviation is implemented as detection logic
  only; it is not yet wired to fire the network call from the Map screen.
- No conflict-resolution UI beyond re-fetching server state; conflicts are
  tracked in `useOfflineStore.conflicts` but not yet rendered.
- Push notifications are local-only; see Notifications above.
- Proof-of-delivery (signature/photo/OTP) has no backend support and is
  intentionally not implemented — see spec §10, which explicitly forbids
  fabricating this feature.

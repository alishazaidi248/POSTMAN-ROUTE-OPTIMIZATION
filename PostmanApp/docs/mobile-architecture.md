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
                    Backend Optimization (server-side: DBSCAN + NN + 2-opt + ALNS)
```

The admin panel and this app are two independent REST clients of the same
backend and database. They never call each other, and this app never touches
Postgres directly. Business rules (who can see which delivery, which status
transitions are legal, who owns which beat) are enforced server-side; the
mobile app's own checks are UX convenience only.

## Research/optimization boundary

The mobile app **consumes** a route result; it never implements a routing
algorithm and never chooses one. There is exactly one production pipeline, owned by the
server:

```
Assigned Deliveries -> Road travel-time matrix (OSRM) -> DBSCAN -> Nearest Neighbour
  -> 2-opt -> ALNS -> Best solution -> Road geometry (OSRM) -> Polyline
  -> React Native Map
```

**Current backend reality** (`backend/src/services/optimization/`):
`RoadRouteOptimizationService` builds a real route:

1. loads the postman's active deliveries (`ASSIGNED`, `OUT_FOR_DELIVERY`,
   `RESCHEDULED` - never `DELIVERED`/`RETURNED`/`CANCELLED`),
2. picks the start point (the app's GPS fix if supplied, else the postman's
   last location ping, else the post office),
3. asks a road-routing engine (OSRM, `OSRM_BASE_URL`) for a travel-time /
   distance matrix (cached per point pair) and falls back to flagged
   straight-line estimates if it is unavailable,
4. clusters the stops with **DBSCAN** over the road travel times, orders the clusters,
   builds the initial route with **Nearest Neighbor** and improves it with **2-opt**,
   then hands that route to **ALNS** (adaptive large neighbourhood search), which
   returns the best route it found - never one dearer than the 2-opt route. Every stage
   is scored by the same weighted cost (travel time + load-carried penalty +
   priority-waiting penalty - see `routeAlgorithms.ts`; details in `backend/ALNS.md`),
5. fetches the road polyline for the final order and returns per-leg
   distance/time and ETAs.

This is the only strategy. No request parameter, environment variable or screen selects
another one; a client that sends `algorithm` is ignored. The optimizer's diagnostics
(costs per stage, ALNS statistics) are only sent to administrators - the postman's
`/me/route` response carries no `metrics` and no algorithm name.

There are no time-window or vehicle-capacity constraints - the data model has neither (no
delivery weight, no vehicle payload). Parcel count stands in for load. The
app's UI deliberately says "Optimized Route", never "optimal route"
(spec 15/49): the optimizer is a good heuristic, not a proof of optimality.

## Route response contract

`GET /api/v1/me/route` (see `backend/src/routes/me.routes.ts`,
`backend/src/services/routePlanner.service.ts`). Optional query:
`startLat`+`startLng` (begin the route at this GPS fix), `refresh=true` (force a
full re-optimization). There is no algorithm parameter: any `algorithm` query
value is ignored.

```jsonc
// Nothing left to deliver:
{ "route": null }

// An active route:
{
  "routeId": "uuid",              // OptimizationRequest.id
  "version": 4,                    // count of this postman's completed plans
  "trigger": "DELIVERIES_CHANGED" | "STOPS_REMOVED" | "RECIPIENT_UNAVAILABLE" | "MANUAL" | ...,
  "status": "COMPLETED",
  "generatedAt": "2026-09-20T09:00:00.000Z",
  "stale": false,                  // true only if a refresh failed and the last stored route is returned
  "solution": {
    "postmanId": "uuid", "beatId": "uuid",
    "start": { "latitude": 19.1436, "longitude": 72.9345, "source": "POST_OFFICE" },   // or REQUEST | POSTMAN_LOCATION
    "stops": [
      {
        "deliveryId": "uuid", "sequence": 1, "latitude": 19.1452, "longitude": 72.931,
        "estimatedArrival": "2026-09-20T09:02:04.000Z",
        "distanceFromPreviousMeters": 912, "travelTimeFromPreviousSeconds": 124,
        "load": 1, "priority": "URGENT", "serviceTimeMinutes": 3
      }
    ],
    "totalDistanceMeters": 8053, "totalTravelTimeSeconds": 1008, "estimatedDurationMinutes": 40.8, "totalLoad": 20,
    "geometry": { "type": "LineString", "coordinates": [[72.9345, 19.1436], ...] },   // road polyline, [lng, lat]
    "routing": { "mode": "ROAD" | "ESTIMATED", "provider": "osrm", "geometrySource": "ROAD" | "STRAIGHT_LINE" | "NONE", "warnings": [] },
    "reusedOrder": false,          // true when stops were pruned without re-optimizing
    "unroutable": [ { "deliveryId": "uuid", "reason": "MISSING_COORDINATES" } ],
    "generatedAt": "2026-09-20T09:00:00.000Z"
  }
}
```

The stored route stays valid while the postman's set of active deliveries is
unchanged. When stops are only *removed* (delivered/failed) the order is kept
and legs/ETAs/polyline are refreshed ("pruned" - the remaining stops never
reshuffle just because one was completed); when a delivery is *added*, or on an
explicit recalculation or a failure event, the full pipeline runs.

`POST /api/v1/me/route/reoptimize`
`{ "trigger": "DELIVERY_COMPLETED" | "RECIPIENT_UNAVAILABLE" | "WRONG_ADDRESS" | "ADDRESS_NOT_FOUND" | "DELIVERY_FAILED" | "ROUTE_DEVIATION" | "MANUAL", "start"?: { "latitude", "longitude" } }` (an `algorithm` field is ignored)
forces a full re-optimization of the remaining deliveries and returns the same
route shape (`201`). The Map tab's **Recalculate** button uses it with the
device's GPS fix. The app no longer calls it after every status change: the
server refreshes the route itself (lazily on `GET /me/route`, and eagerly via
the delivery-event listener for `RECIPIENT_UNAVAILABLE`, `REJECTED`,
`WRONG_ADDRESS` and `CANCELLED`). Deviation detection exists in
`src/services/routeService.ts`; wiring an automatic trigger from the Map screen
is still a follow-up.

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
surfaced to the store (`useOfflineStore.conflicts`); both the Deliveries and
Map screens render them in a `ConflictBanner` ("Couldn't apply "Delivered" for
X: it is now Cancelled on the server") with a Dismiss action. Queued changes
are shown immediately on cards and markers with a "Waiting to sync" tag.

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

The backend stores every message (`Notification`, listed by `GET /notifications`, the source of truth) and pushes it through Expo
to the tokens phones register with `POST /me/push-token` (`DELETE` on sign-out). Events: a new assignment (batched when many
arrive together), an urgent delivery, a reassignment, a route change, a message from the office. The app registers after
sign-in (`usePushRegistration`) and refreshes its lists when a push arrives while it is open.

What cannot be verified without a real device: end-to-end delivery of a push to a phone (it needs a development / production
build with the project's push credentials and Expo's servers). Registration, what is sent, and the handling of a token Expo
reports dead are covered by backend tests against a fake of Expo's API.

## Known limitations (honest, not exhaustive)

- Push delivery to a device is not verifiable in a simulator or on the web (see Notifications).
- Proof of delivery is a photo only (the post office's setting; the server enforces it). OTP needs an SMS provider and signature
  capture has no requirement: neither is implemented.
- The native map screen (iOS / Android) has not been run on a device in this environment; the web build is exercised end to end
  by the browser tests in `e2e/`.
- Delivery time windows are not modelled (no data, and the ALNS insertion cost cannot represent them).
- History is readable offline only for the first page of each period / outcome that was opened while online.

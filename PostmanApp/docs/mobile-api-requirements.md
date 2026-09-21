# Mobile API Requirements

Endpoint-by-endpoint list of what the Postman app needs, whether it already
existed in `../PostmaAppAdminPanel/backend`, and what was added. All
endpoints are under `/api/v1` and require `Authorization: Bearer <accessToken>`
unless noted.

## AUTH — all pre-existing, reused as-is

| Endpoint | Method | Role | Notes |
|---|---|---|---|
| `/auth/login` | POST | any | Body `{email, password}` -> `{accessToken, refreshToken, user}`. `user.postmanId` was added to the response (see PROFILE below). |
| `/auth/refresh` | POST | any | Rotates refresh token. |
| `/auth/logout` | POST | authenticated | Revokes the given refresh token. |
| `/auth/me` | GET | authenticated | Now also returns `postmanId`. |

## PROFILE — added

| Endpoint | Method | Role | Request | Response | Existed before? |
|---|---|---|---|---|---|
| `/me/profile` | GET | POSTMAN | — | `{ postman, beat, lastKnownLocation }` | No |

**Backend change required**: `User.postmanId` (nullable, unique FK to
`Postman`) — added to `prisma/schema.prisma`. Previously there was no way to
resolve a POSTMAN login to a `Postman` record at all. Identity is always
re-derived server-side from the verified token (`backend/src/services/postmanSelf.service.ts`),
never trusted from the client.

## DELIVERIES

| Endpoint | Method | Role | Notes | Existed before? |
|---|---|---|---|---|
| `/me/deliveries` | GET | POSTMAN | Query `status?`, `page?`, `pageSize?`. Always scoped to the caller's own Postman id. | No (added; wraps the same underlying query pattern as the existing `/deliveries` list) |
| `/deliveries/:id` | GET | authenticated | Now also enforces same-postman ownership for POSTMAN callers (previously any POSTMAN in the post office could read any delivery by id). | Yes, tightened |
| `/deliveries/:id/status` | POST | ADMIN/SUPER_ADMIN/POSTMAN | Body `{status, reason?}`. Same tightened ownership check added. | Yes, tightened |
| `/me/stats` | GET | POSTMAN | Today's total/completed/failed/remaining + completion rate, derived from `Delivery` rows. | No |

## ROUTE

| Endpoint | Method | Role | Notes | Existed before? |
|---|---|---|---|---|
| `/me/route` | GET | POSTMAN | The caller's optimized route (the server's one pipeline - DBSCAN, Nearest Neighbor, 2-opt, ALNS - over an OSRM road matrix, with road geometry). Served from the latest stored `OptimizationResult` while the active delivery set is unchanged, otherwise refreshed first. Query: `startLat`+`startLng`, `refresh=true` (any `algorithm` is ignored). Returns `{route: null}` when nothing is left to deliver. | Yes (extended; response fields are additive) |
| `/me/route/reoptimize` | POST | POSTMAN | Body `{trigger, start?}`. Forces a full re-optimization of the remaining deliveries. No longer requires an assigned beat. | Yes (extended) |
| `/optimization/requests` | POST/GET | ADMIN/SUPER_ADMIN | Unchanged; admin-triggered planning still goes through here. | Yes |

## LOCATION — added

| Endpoint | Method | Role | Request | Response | Existed before? |
|---|---|---|---|---|---|
| `/me/location` | POST | POSTMAN | `{latitude, longitude, batteryPct?, isMock?}` | `{id, recordedAt}` | No — `PostmanLocationHistory` was read-only before (consumed by `GET /postmen/:id` and `GET /maps/postmen`); there was no write endpoint at all. |

## NOTIFICATIONS — reused as-is, gap documented

| Endpoint | Method | Role | Notes |
|---|---|---|---|
| `/notifications` | GET | authenticated | Own + broadcast notifications. |
| `/notifications/:id/read` | POST | authenticated | |
| `/notifications/read-all` | POST | authenticated | |
| `/me/push-token` | POST / DELETE | POSTMAN | `{token, platform}` registers the phone's Expo push token under the signed-in login (DELETE `{token}` on sign-out). The server stores every message as a Notification and pushes it through Expo (new assignment - batched -, urgent delivery, reassignment, route change, message from the office). | Yes (new) |
| `/auth/change-password` | POST | any | `{currentPassword, newPassword}`. Required while the account has a temporary password (every other endpoint answers 403 `PASSWORD_CHANGE_REQUIRED`); ends the other sessions and returns new tokens. | Yes (new) |
| `/deliveries/:id/proof` | POST / GET | POSTMAN (own), ADMIN | POST multipart field `photo` (JPEG / PNG / WebP, size-limited, only while OUT_FOR_DELIVERY); GET streams the private photo. `/deliveries/:id/status` refuses DELIVERED without it when the post office requires a photo (400, `details.proofRequired`). Send `location` `{latitude, longitude, accuracyMeters}` with DELIVERED for address learning. | Yes (new) |

## SYNC

There is no dedicated `/sync` batch endpoint. The offline queue
(`src/services/syncService.ts`) replays each queued mutation against the
existing per-resource endpoints (`POST /deliveries/:id/status`) individually
and in order — this was judged sufficient for the mutation types the mobile
app currently produces (delivery status updates only) rather than adding a
new generic batch endpoint the backend would need to validate transaction
semantics for.

## Not implemented (explicitly out of scope here, and why)

- **Proof of delivery** (signature/photo/OTP) — no backend model/endpoint
  exists; spec §10 explicitly forbids fabricating this, so only the
  types/hooks seam is left open for a future backend addition, nothing is
  wired up.
- **Push notifications** — see NOTIFICATIONS above.
- **Route/RouteStop/RouteEvent REST surface** — the Prisma models exist but
  nothing reads/writes them; `/me/route` approximates "route" from
  `OptimizationRequest`/`OptimizationResult` instead. Migrating optimization
  results onto `Route`/`RouteStop` would be a backend-side follow-up, not
  something the mobile app can drive alone.

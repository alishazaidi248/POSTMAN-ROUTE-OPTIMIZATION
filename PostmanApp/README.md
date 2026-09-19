# Postman App (React Native)

Field-execution mobile client for postal delivery personnel ("postmen"). It is
one of two clients on top of the **existing** Postal Delivery Optimization
System backend — the other is the React admin panel at
`../PostmaAppAdminPanel/frontend`. This app does not implement its own
backend, database, or business logic; it consumes the existing Node/Express +
PostgreSQL/PostGIS backend at `../PostmaAppAdminPanel/backend`.

See [docs/mobile-architecture.md](docs/mobile-architecture.md) for the full
architecture, API contract, and gap analysis, and
[docs/mobile-api-requirements.md](docs/mobile-api-requirements.md) for the
endpoint-by-endpoint list of what already existed vs. what was added.

## 1. Architecture

```
PostgreSQL + PostGIS
       |
Node.js + Express backend (../PostmaAppAdminPanel/backend)
       |
REST API (/api/v1)
       |
   +---+---------------------+
   |                         |
React Admin Panel      React Native Postman App (this project)
```

Both clients talk to the same backend/database over REST. Neither client
talks to the other, and neither talks to the database directly.

## 2. Purpose

A postman signs in, sees only their own assigned deliveries and beat, views
their optimized route on an OpenStreetMap-based map, updates delivery status
in the field, and keeps working (with changes queued) when offline.

## 3. Folder structure

```
src/
  api/            axios-based API modules (one per backend resource)
  components/     presentational components, grouped by domain
  navigation/     React Navigation stacks/tabs + route typing
  screens/        screen components (auth, deliveries, map, account)
  hooks/          TanStack Query hooks + device hooks (location, offline sync)
  store/          Zustand stores: auth session, offline queue, route UI state
  services/       non-React logic: location, route math, sync, notifications
  storage/        SecureStore (tokens) and AsyncStorage (offline cache/queue)
  types/          TypeScript types mirroring the backend's Prisma schema
  utils/          pure helpers (status rules, distance, formatting, validation)
  theme/          colors, spacing, typography
  config/         env.ts (reads app.config.js `extra`)
__tests__/
  unit/           pure-logic and component tests
  integration/    store + service tests with mocked API modules
```

## 4. Installation

```bash
npm install
cp .env.example .env   # then fill in API_BASE_URL etc.
```

## 5. Environment variables

Set in `.env` (loaded by `app.config.js` into `Constants.expoConfig.extra`,
read by `src/config/env.ts`):

| Variable | Purpose |
|---|---|
| `API_BASE_URL` | Base URL of the existing backend's REST API, e.g. `http://192.168.1.50:4000/api/v1` (use your machine's LAN IP, not `localhost`, when testing on a physical device) |
| `MAP_STYLE_URL` | MapLibre-compatible style JSON (OpenStreetMap-based) |
| `OSRM_BASE_URL` | Optional OSRM (or compatible) road-routing base URL, if used |

## 6. Backend connection

This app **reuses** the existing backend's `/api/v1` REST API — see
[docs/mobile-architecture.md](docs/mobile-architecture.md) for the full
endpoint list. A small number of backend changes were required and are part
of this change set (in `../PostmaAppAdminPanel/backend`):

- `User.postmanId` — links a POSTMAN-role login to its `Postman` record
  (previously there was no way to resolve "which Postman is this login").
- `POST/GET /api/v1/me/*` — self-service endpoints (profile, deliveries,
  stats, route, reoptimize, location ping) scoped to the authenticated
  postman only.
- A same-postman ownership check added to `GET /deliveries/:id` and
  `POST /deliveries/:id/status` for the POSTMAN role, so one postman's login
  can never read or mutate another postman's delivery by guessing an id.

**Before running the backend with these changes**, regenerate the Prisma
client and apply the schema change against a running Postgres instance:

```bash
cd ../PostmaAppAdminPanel/backend
npm run prisma:generate
npm run prisma:migrate   # or: npx prisma db push, for a dev database
npm run prisma:seed      # creates ramesh.kadam@postal.local / ChangeMe123! (POSTMAN role)
```

## 7. Map configuration

Uses `@maplibre/maplibre-react-native` with an OpenStreetMap-compatible style
(`MAP_STYLE_URL`). MapLibre's native module requires a **development build**,
not Expo Go — see §13.

## 8. Authentication

JWT access + refresh tokens, reusing the backend's existing
`/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/me`. Tokens are stored
in `expo-secure-store` (never AsyncStorage, never logged). On login, the app
rejects non-POSTMAN accounts and accounts with no linked Postman profile —
see `src/store/authStore.ts`.

## 9. API integration

All requests go through `src/api/axiosClient.ts`, which attaches the bearer
token, retries once on 401 via a single in-flight token refresh (matching the
admin frontend's `apiClient.ts` pattern), and maps backend errors to a
user-safe `ApiError`. Per-resource modules (`authApi`, `deliveryApi`,
`routeApi`, `postmanApi`, `locationApi`, `notificationApi`) are the only
places that call `axiosClient` directly — screens/components never construct
URLs themselves.

## 10. Offline architecture

- `src/storage/offlineStorage.ts` — last-known-good cache (profile,
  deliveries, route) and the pending-mutation queue, in AsyncStorage.
- `src/store/offlineStore.ts` — in-memory mirror of the queue + connectivity
  + any detected sync conflicts.
- `src/services/syncService.ts` — drains the queue in FIFO order when
  connectivity returns; on a rejected transition (someone else changed the
  delivery while offline) it **never overwrites** — it drops the stale
  mutation, re-fetches the server record, and records a conflict.
- `src/hooks/useOfflineSync.ts` — wires `@react-native-community/netinfo` to
  the store and triggers a sync automatically on reconnect.

## 11. GPS architecture

`src/services/locationService.ts` wraps `expo-location` permission handling
and position watching; `src/hooks/useLocation.ts` owns the live fix and
pings `POST /me/location` on a cadence that depends on whether a route is
active (30s) or idle (3min) — see spec-driven comments in that file. Route
deviation detection (`src/services/routeService.ts` +
`src/utils/distance.ts`) requires the reading to be both far *and* accurate
before treating it as a real deviation.

## 12. Route architecture

The app only **consumes** `GET /me/route` (see
`docs/mobile-architecture.md` for the exact contract) — it never implements
DBSCAN/nearest-neighbor/2-opt/etc. itself. Route re-optimization is
requested via `POST /me/route/reoptimize` after a delivery's status changes
in a way that affects the remaining route (delivered, recipient unavailable,
wrong address, address not found, failed).

## 13. Testing

```bash
npm run test        # Jest + @testing-library/react-native
npm run typecheck    # tsc --noEmit
npm run lint          # eslint (eslint-config-expo)
```

38 tests currently cover: delivery status transition rules and filters,
distance/deviation math, phone/login validation, route current/next-stop
derivation, the offline sync queue (FIFO draining, network-failure retry,
conflict detection without overwriting server state), auth store role
enforcement (rejects non-POSTMAN and unlinked accounts), and a
`StatusActionButtons` component test. See
[docs/mobile-architecture.md](docs/mobile-architecture.md) for what is and
isn't covered, and why (no device/emulator was available in this
environment — see the final report for the honest test-result breakdown).

## 14. Android build

MapLibre, background location, and other native modules mean this app needs
a **development build**, not Expo Go:

```bash
npx expo prebuild --platform android   # generates ./android
npx expo run:android                    # builds + installs the dev client, requires Android SDK/emulator or device
# subsequent runs:
npm run start                           # starts Metro with --dev-client
```

**Windows-specific Gradle note**: if `expo run:android` fails with
`Could not find expo.modules.<name>:expo.modules.<name>:<version>` while
resolving `:expo:compileDebug...` (an Expo module's own local Maven
publication not resolving), this project sets
`expo.android.useLegacyPackaging: true` via the `expo-build-properties`
plugin in `app.json` — that's the fix; do not remove it without confirming
non-legacy packaging resolves cleanly on your machine first.

For a distributable Android build, use `eas build --platform android
--profile development` (see §15 below) instead of `expo run:android` if you
don't have the Android SDK installed locally.

## 15. iOS build (EAS — required; this project has no local Xcode workflow)

**There is no `ios/` folder in this repo and none is checked in.** Windows
cannot run Xcode, so iOS builds are never done locally here — they go
through [EAS Build](https://docs.expo.dev/build/introduction/), which runs
the equivalent of `expo prebuild` and the full native compile in Expo's
cloud, and hands back an installable `.ipa`.

### Why "MLRNCameraModule could not be found" happens

`MLRNCameraModule` is a real native module inside
`@maplibre/maplibre-react-native`'s iOS source
(`node_modules/@maplibre/maplibre-react-native/ios/components/camera/MLRNCameraModule.mm`),
backing the `<Camera>` map component (viewport control — not the device
camera). It only becomes part of the compiled app binary when the iOS
project is generated and `pod install` is run **after** the package is in
`package.json`, and the app is then rebuilt from scratch.

If you have a development-client build already installed on an iPhone from
**before** MapLibre was added (or from before any other native module/plugin
change), that binary's TurboModule registry simply does not contain
`MLRNCameraModule` — no amount of editing `app.json`, `app.config.js`, or
JavaScript can add a native module to an already-installed binary.
Config-plugin/JS changes only take effect the next time the native project
is generated and compiled. **The fix is always a brand-new development
build, installed fresh on the device.**

This is also why **Expo Go cannot be used** for this app at all: Expo Go
ships a fixed set of Expo SDK native modules and does not include
third-party native modules like MapLibre, background location, etc. Any
screen that touches MapLibre will fail the same way (or worse) under Expo
Go regardless of build freshness.

### Exact commands

```bash
# one-time: install and log in to EAS CLI
npm install -g eas-cli
eas login

# one-time per project: links this app to an Expo account/project
# (creates extra.eas.projectId in app config if not already set)
eas init

# build a NEW iOS development-client binary (cloud build, no Xcode needed)
eas build --platform ios --profile development
```

`eas build` will prompt for Apple ID credentials and handle
provisioning-profile/device-registration for you (for **internal
distribution**, it will ask you to register the iPhone's UDID if it isn't
already registered — follow its prompts; this is an Apple Developer Program
requirement EAS cannot skip). When the build finishes, EAS gives you an
install link (and a QR code) — open it on the iPhone (Safari) and install
the development build like any ad-hoc app.

### After installing the new build on the iPhone

```bash
# make sure .env's API_BASE_URL is your machine's LAN IP (see §5/.env.example),
# not 10.0.2.2 (that's Android-emulator-only) and not localhost
npx expo start --dev-client
```

Open the installed dev-client app on the iPhone; it will connect to Metro
over your LAN (same network as the dev machine) or you can scan the QR code
Metro prints. The `eas.json` `development` profile already sets
`developmentClient: true` and `distribution: internal`, `ios.simulator:
false` (a real device, not the iOS Simulator, since development is on
Windows).

### `eas.json` in this repo

Three build profiles are configured (`development`, `preview`,
`production`) — see [eas.json](eas.json). Only `development` is relevant
for this workflow; `preview`/`production` are standard scaffolding for
later, not used for this debugging session.

## 16. Web build (secondary target)

This app is primarily a native mobile client (spec §31 etc.), but it also
runs in a browser via Expo web — useful for quick local testing without a
device/emulator:

```bash
npx expo start --web
```

Two things are platform-split because the native implementations don't work
in a browser:

- **Map**: `@maplibre/maplibre-react-native` (native-only) vs.
  `src/screens/map/MapScreen.web.tsx` + `src/components/map/WebMapView.web.tsx`,
  which use the `maplibre-gl` browser library directly. Both read the same
  `GET /me/route` data via the shared `src/screens/map/useMapScreenData.ts`
  hook, so behavior/data stays identical — only the rendering technology
  differs. `src/utils/mapMarkerColor.ts` holds the marker color logic so
  neither map file needs to import the other platform's map package.
- **Secure token storage**: `expo-secure-store` has no web implementation
  (its web module is a literal empty stub) — `src/storage/secureStorage.ts`
  falls back to `localStorage` on web. This is **not** secure storage (any
  script on the page can read it); it exists only so the web build doesn't
  crash on load. Native builds are unaffected and keep using the OS
  keychain/keystore via SecureStore.

**CORS**: browsers enforce CORS; native apps don't. The backend's
`CORS_ORIGIN` (`backend/.env`) must include the web dev server's origin
(e.g. `http://localhost:8082`) or login will fail with a CORS error in the
browser console even though the backend itself is reachable — see
`backend/.env.example`.

## 17. Map style / OSRM configuration

- `MAP_STYLE_URL` must point to a MapLibre-compatible style JSON
  (OpenStreetMap-based, not a Google style). If it fails to load, the Map
  screen now shows a retry-able error state instead of a blank/crashed map
  (`onDidFailLoadingMap` in `src/screens/map/MapScreen.tsx`) — it does not
  crash the app.
- `OSRM_BASE_URL` is optional and currently **unused** by any code path
  (`src/config/env.ts` only reads and exposes it as `string | undefined`) —
  the app does not yet call an OSRM server for road-network polylines (see
  `docs/mobile-architecture.md`, Known Limitations). Leaving it empty is
  safe and cannot crash anything; no OSRM server is fabricated or required
  for the app to run today.

## 18. Troubleshooting

- **"Network request failed" on a physical device (Android or iOS)**:
  `API_BASE_URL` is probably `localhost` or `10.0.2.2` (Android-emulator-only
  alias) — use your machine's LAN IP instead, and make sure the phone is on
  the same Wi-Fi network as the backend. See §5/.env.example.
- **Login fails on the web build with a CORS error in the browser console**
  (native builds are unaffected — CORS is browser-only): add the web dev
  server's origin to the backend's `CORS_ORIGIN` (comma-separated) and
  restart the backend process — `.env` changes are not picked up by
  `tsx watch` without a restart. See §16 and `backend/.env.example`.
- **Backend unreachable from a phone even with the correct LAN IP**: the
  backend (`app.listen(port, ...)` with no host argument) already binds to
  all network interfaces by default, so this is almost always a Windows
  Firewall inbound rule blocking Node.js — allow inbound connections for
  Node on your private network profile, or temporarily disable the firewall
  to confirm.
- **`TurboModuleRegistry.getEnforcing(...): 'MLRNCameraModule' could not be
  found`**: see §15 — this means the installed dev-client binary predates a
  native-module change. Build and install a new one; this cannot be fixed by
  editing JS/config alone.
- **Map renders blank**: confirm `MAP_STYLE_URL` is reachable from the
  device and that you're running the dev-client build, not Expo Go (MapLibre
  is a native module).
- **"jest-expo... react-native/setup-env" / peer dependency errors during
  `npm install`**: this repo pins `@react-native/jest-preset` and
  `react-test-renderer` to match the exact `react`/`react-native` versions —
  see `package.json`. If you bump Expo SDK, re-align those three versions
  together.
- **Location permission denied on Android 13+**: background location
  requires the foreground permission to be granted first, then a second
  prompt for "Allow all the time" — see `src/services/locationService.ts`
  and the `Settings` screen's manual permission link.

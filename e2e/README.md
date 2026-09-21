# Browser tests

Real-browser tests of the admin panel and the Postman app (its web build), against a real backend and a real PostgreSQL/PostGIS
database. They cover: admin sign-in, the forced first-login password change (admin and postman), beat-list upload (several
rows per beat), beat verification, delivery assignment (by the beat list, and to Assignment Exceptions with a suggestion),
Postman sign-in, the route order, and completing a delivery.

## Running them

1. A PostgreSQL + PostGIS database whose name ends in `_e2e` (the seed wipes it and refuses anything else), migrated:
   `cd backend && DATABASE_URL=postgresql://.../postal_e2e npx prisma migrate deploy`
2. Seed its own post office and logins (random passwords, written to `e2e/.users.json`, git-ignored):
   `DATABASE_URL=... npx tsx scripts/e2e-seed.ts ../e2e/.users.json`
3. Start the backend against that database with no external services:
   `GEOCODING_PROVIDER=none OSRM_BASE_URL= PUSH_ENABLED=false AUTH_RATE_LIMIT=1000 CORS_ORIGIN=* JWT_ACCESS_SECRET=x JWT_REFRESH_SECRET=y DATABASE_URL=... npx tsx src/server.ts`
4. Start the admin panel (`cd frontend && npx vite --port 5173`) and serve the Postman app's web build on port 8081
   (`cd PostmanApp && API_BASE_URL=http://localhost:4000/api/v1 npx expo start --web --port 8081`, or `expo export --platform web`
   and any static server).
5. `cd e2e && npm ci && node run.mjs` (or `node run.mjs admin` / `node run.mjs postman`). Set `CHROME_PATH` if Chrome is not in
   a usual place. Re-run the seed before each full run: the tests change the passwords they sign in with.

Environment: `E2E_API_URL` (default `http://localhost:4000/api/v1`), `E2E_ADMIN_URL` (`http://localhost:5173`), `E2E_APP_URL`
(`http://localhost:8081`). Screenshots of each stage go to `e2e/screenshots/` (git-ignored).

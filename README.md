# KICKOFF ARENA — turf booking

Angular 18 frontend, Express backend and MySQL database for turf slots, season bookings, payments and staff-managed cancellation/refund records.

Admins land on the [booking calendar](docs/ADMIN_CALENDAR.md): weekly/daily slot availability with booking, hold, season and block details in Bangladesh time.

```bash
npm ci --prefix backend
npm ci --prefix frontend
```

Create the MySQL database, copy `backend/.env.example` to private `backend/.env`, and configure credentials. Then:

```bash
npm run migrate --prefix backend
npm run dev --prefix backend
npm start --prefix frontend
```

Frontend: `http://localhost:4200`. Backend: `http://localhost:5000`. For a new installation, provision the admin with `npm run admin:create --prefix backend` using `ADMIN_USERNAME`/`ADMIN_PASSWORD` environment variables. Optional development fixtures: `npm run seed:dev --prefix backend`; no default password is seeded.

```bash
npm run check --prefix backend
npm test --prefix backend
npm test --prefix frontend -- --watch=false --browsers=ChromeHeadless
npm run build --prefix frontend
npm run test:e2e --prefix frontend
npm run release --prefix backend
```

The release ZIP appears in `artifacts/`; packaging does not deploy it. See [architecture](ARCHITECTURE.md), [deployment/monitoring/backup/restore](docs/DEPLOYMENT.md), and [cancellation policy](backend/services/bookings/CANCELLATION_POLICY.md).

Browser tests require Playwright Chromium (or `PLAYWRIGHT_CHROMIUM_EXECUTABLE` pointing to installed Chrome) and MySQL privileges to create/drop isolated test databases. Run `RUN_DB_TESTS=1 RUN_BACKUP_TESTS=1 npm run test:integration --prefix backend` for concurrency and backup/restore checks. Verify an archive using `npm run test:release --prefix backend -- ../artifacts/booking-RELEASE.zip`.

Payment retries reuse the persisted gateway attempt; unknown outcomes require verification. Staff can run `npm run payment:reconcile --prefix backend -- --transaction TRANSACTION_ID`. Deploy migration 003 before using these changes. Customer access and cancellation rates remain unchanged.

Production error tracking is optional: set `SENTRY_DSN` for the backend and `SENTRY_FRONTEND_DSN` for the browser. The release workflow uploads private frontend source maps using GitHub Sentry secrets; see the deployment guide for setup.

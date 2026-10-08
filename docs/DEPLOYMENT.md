# Deployment, monitoring and recovery

## Prerequisites

Use Node.js 22 or 24, MySQL 8, npm, `zip`/`unzip`, and matching MySQL client tools (`mysql`, `mysqldump`). The database must already exist. The migration user needs CREATE/ALTER/INDEX/REFERENCES privileges; runtime users need the normal application CRUD privileges. Copy `backend/.env.example` to a private `backend/.env` and populate existing database/payment/email settings. No service credentials belong in Git.

The backend now resolves `.env` relative to its own directory, so commands work from either the repository root or `backend`. Application startup no longer creates demo admins or slots. Existing data remains intact.

## Verify and package

```bash
npm ci --prefix backend
npm ci --prefix frontend
npm run check --prefix backend
npm test --prefix backend
npm test --prefix frontend -- --watch=false --browsers=ChromeHeadless
npm run build --prefix frontend
npm run release --prefix backend
```

`release` builds Angular and creates a timestamped `artifacts/booking-*.zip` using a runtime file allowlist. It embeds the current frontend build into `backend/public`, includes the observability runtime, writes a `release.json` identifier, and removes source maps from the ZIP. Release IDs permit letters, digits, underscores and hyphens (maximum 120 characters); an existing archive is never overwritten. It does not modify the deployed `backend/public`, upload, restart a remote server or include private `.env`, node_modules, backup data or development tests. Use the source checkout for CI/testing; install runtime dependencies in the release with `npm ci --omit=dev`.

For production releases, run the **Build release** GitHub Actions workflow. Store `SENTRY_AUTH_TOKEN` as a repository secret and `SENTRY_ORG` and `SENTRY_PROJECT` as repository variables. The workflow first runs the reusable checks workflow: backend/Angular tests, real MySQL integration and backup/restore, Playwright browser scenarios, production build and extracted-release startup verification. It then uploads private source maps, creates the production ZIP and repeats startup verification on that exact archive before publishing it. It fails if any Sentry setting is missing. `SENTRY_AUTH_TOKEN` never appears in the ZIP or runtime configuration. A local release without those values still packages correctly but warns that browser source maps were not uploaded.

To run the browser suite after building, install Playwright Chromium and run:

```bash
cd frontend
npx --no-install playwright install chromium
npm run test:e2e
```

Or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome` to use installed Chrome. The suite serves the real Angular build and backend on port 5055, creates a unique temporary MySQL database, and overrides the gateway/notifications only inside an excluded test executable. No real payment or message is sent. It requires a DB account with CREATE/DROP DATABASE privileges. The test server must not share its port with a running app.

Check a specific release from the repository root (replace the filename):

```bash
npm run test:release --prefix backend -- ../artifacts/booking-RELEASE.zip
```

This verifies ZIP contents, extracts into a temporary directory, runs `npm ci --omit=dev`, starts the packaged production server against a unique temporary database, then checks readiness, runtime configuration, admin rejection and frontend assets. It cleans up its test database and files. Source maps are also excluded from the ordinary frontend CI artifact.

To test MySQL logic, set `RUN_DB_TESTS=1` and run `npm run test:integration --prefix backend`. The configured user must be allowed to create/drop temporary databases. Optional `RUN_BACKUP_TESTS=1` adds an actual dump/restore exercise. Tests use uniquely named databases, never the application's configured database. Optional `MYSQL_BIN` and `MYSQLDUMP_BIN` specify absolute paths to client binaries.

## Migration and rollout

1. Create a database backup before the rollout; verify a restore into an empty staging database.
2. Extract the release in a new server directory. Restore the private environment configuration and install runtime dependencies.
3. Run `npm run migrate`. This adopts the existing unversioned schema without resetting existing tables. `schema_migrations` records the two baseline migrations plus `003-payment-attempts.js` and their checksums. The third migration adds payment initialization state, saved gateway session metadata, verified terminal status and booking-scoped idempotency keys. Old failed/cancelled records remain unverified until reconciled. MySQL DDL is not transactional: a partial failure is retried safely, never marked complete prematurely. Do not edit an applied migration; add the next numbered file to the runner's list.
4. Run `npm run migrate:check`. Set `RUN_MIGRATIONS=false` if deployments run migrations separately; startup then verifies all known migrations have matching checksums. The compatibility default `RUN_MIGRATIONS=true` applies pending migrations before listening.
5. Use `NODE_ENV=production`, a strong `JWT_SECRET`, the correct HTTPS frontend/gateway callback URLs, and `SCHEDULER_ENABLED=true` in only one process. Restart via the existing cPanel Node application manager/process supervisor.
6. Verify `/health/ready`, admin login, slot availability, a staging hold/confirm and gateway sandbox callbacks before switching production traffic. Signal handling stops the scheduler, drains HTTP connections and closes the pool.

For a new environment, run `npm run admin:create` with `ADMIN_USERNAME` and `ADMIN_PASSWORD` supplied through the process environment/secret manager. Password length must be at least 12; existing accounts are never overwritten. Configure slots and turf settings through the admin UI. `npm run seed:dev` optionally inserts demo slots/settings and an admin only when `SEED_ADMIN_PASSWORD` is provided; it refuses `NODE_ENV=production`.

## Monitoring

Collect process stdout/stderr with the host supervisor. Filter structured JSON records by `level=error` and correlate requests using `X-Request-ID`. Request logs omit bodies, query strings and authorization headers; keep log access restricted because older notification adapters still log delivery details. Monitor 5xx rate, readiness failures and unexpected process exits in the hosting provider's existing alert system.

Configure `SENTRY_DSN` for backend incidents and `SENTRY_FRONTEND_DSN` for browser incidents. A browser DSN is public by design; the Sentry auth token is not. Set `SENTRY_ENVIRONMENT=production` in the deployed private environment. Keep tracing and session replay disabled unless a separate privacy/performance review approves them. Alerts, owners, and retention are configured in the Sentry project, not in this repository. Events retain error stack locations, release and request ID; arbitrary messages, request payloads, headers, cookies, query/hash values and breadcrumbs are omitted. Error text is deliberately generalized, so correlate the stack location and request ID. Shutdown allows up to two seconds to flush pending events.

```bash
MONITOR_BASE_URL=https://your-booking-domain.example npm run monitor --prefix backend
```

The monitor exits nonzero for unavailable/unready servers, with a five-second timeout. Schedule it every minute using cron/your monitoring service and route nonzero exits to your chosen alert destination. Monitor backup command failures too. Ensure the process supervisor restarts crashed workers; an uncaught fatal error should not leave an unmonitored process offline.

## Backup

```bash
BACKUP_DIR=/private/booking-backups npm run backup --prefix backend
```

The script uses an InnoDB consistent snapshot, streams gzip output, writes files with owner-only permissions and adds a SHA-256 manifest. Passwords are supplied through a temporary mode-0600 MySQL option file, not command-line arguments. Both client tools use explicit TCP with the same host/port as the application, including when DB_HOST is localhost. Both archive and `.json` manifest must be retained. It excludes MySQL routines/events because this app uses application-side scheduling; if custom database routines are introduced, extend the backup procedure first. Avoid schema migrations while a dump is running.

Schedule daily backups and a backup before every migration; keep at least 7 daily and 4 weekly restore points. Copy them to encrypted storage outside the application host using your established storage tooling. This repository does not automatically upload or prune backups. A checksum detects accidental corruption, not malicious replacement; restrict access to both files.

## Restore and rollback

Create a new empty target database with the same charset/collation as the source, using your DB administration tool. Restore only trusted backups:

```bash
npm run restore --prefix backend -- /private/booking-backups/example.sql.gz booking_restore --confirm=booking_restore
```

The checksum is verified first. The script refuses any target that already contains tables/views and never drops or overwrites an existing database. If import fails after partial DDL, discard that temporary target and retry in a new empty database after resolving the cause.

Point a staging backend at the restored database, run `migrate:check` (or migrate for an older backup), compare booking/payment/refund counts and test admin login/slot availability. Perform a restore drill monthly. Before promoting the restored database, put booking/payment writes in maintenance, stop the old workers, switch the DB configuration and verify readiness; account for payments received since the snapshot before reopening bookings.

Prefer rolling application code back to the previous release while keeping compatible additive schema changes. These migrations have no automatic destructive down operation. A database rollback requires the verified backup, a maintenance window and payment reconciliation; never restore over live customer data as an automatic deployment step.

## Payment retries and reconciliation

`POST /api/payments/initiate` accepts an optional `Idempotency-Key` (8–128 ASCII letters, digits, underscores or hyphens). The browser persists one key per booking attempt in session storage. Repeating a key returns the same attempt; different keys also reuse any unresolved attempt for that booking. New sessions are created only after a verified terminal outcome. Database locks are released before contacting the gateway.

Responses add `state`: `ready` includes the existing gateway URL/amount, `initializing` returns HTTP 202 with `Retry-After: 3`, `paid` requires refreshing the booking result, and verified `failed`/`cancelled`/`expired` allows a fresh key. `verification_needed` blocks new charges after an ambiguous timeout or crash. Gateway calls have a 20-second response deadline; timeout is not proof that the provider failed to create a session.

The result endpoint adds a limited `payment_attempt` summary. The UI does not treat redirect query parameters or admin approval as evidence of a verified online payment. It polls up to ten times, three seconds apart, with an eight-second timeout per result request; unresolved results offer a manual check. Only the booking ID and payment attempt keys persist in session storage, never a trusted success state.

For an unresolved transaction, authorized staff can run this on the backend host:

```bash
npm run payment:reconcile -- --transaction TRANSACTION_ID
```

Use the existing transaction ID from the payment records/provider dashboard. This command checks migrations without applying them, queries SSLCommerz server-to-server and records only matching verified outcomes. A valid result follows the existing transactional credit/refund logic. It never creates a payment session, transfers a refund, or blindly marks an unknown attempt failed. Output excludes customer data and gateway session URLs. Exit 0 means a verified terminal result, 2 means unresolved (inspect the merchant dashboard), and 1 means the command failed. Missing/ambiguous provider results stay blocked; do not manually clear them to enable another charge.

Customer result/PDF access remains as before. The cancellation percentages and staff-managed refund policy are unchanged. Take a backup and apply migration 003 before running this release; stage-test real gateway callbacks and configured Sentry delivery separately.

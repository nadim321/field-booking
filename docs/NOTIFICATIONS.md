# Booking notifications (mock SMS)

The booking SMS worker always uses the mock provider. It makes no SMS network
requests. `Simulated — no SMS sent` is a successful simulation, never proof of
customer delivery. Existing email behavior is unchanged and is not tracked here.

## Events and persistence

Migration `006-notifications` creates the durable jobs and attempt history and
adds booking notification versions. Booking creation, approval (manual or
validated payment), and cancellation enqueue their messages in the same database
transaction as the booking change. Repeated callbacks and unchanged status updates
do not create duplicate confirmations. Each new status transition gets a version.
Recurring bookings also enqueue a booking request when generated.

Approved bookings receive one reminder scheduled two hours before kickoff in
Asia/Dhaka. Approval less than two hours before kickoff records a skipped reminder.
Pending and cancelled bookings receive no reminder. On first worker processing,
existing bookings are marked initialized; existing approved bookings at least two
hours from kickoff get only a reminder, without replaying historical messages.
This backfill processes up to 100 bookings per tick.

The worker runs immediately on server startup and every minute. A delayed reminder
can catch up before kickoff, but is skipped once kickoff passes. Changes to slot
times reschedule unsent reminders on the next tick; completed simulations are not
repeated. Attempt history preserves the exact message used in each attempt. A
queued message otherwise retains its original venue/contact text and recipient.
Cancelled, superseded or removed bookings cause obsolete jobs to be skipped.
An attempt already in flight cannot be recalled by a subsequent cancellation.

## Retries and administration

Open **Admin → Notifications**. Filter by booking ID, event or status, view the
message and attempt history, and retry eligible failed jobs. Recipients are masked
in the list. The page requires admin authentication, refreshes while visible every
30 seconds, and explicitly reports refresh failures. Message previews and audit
history remain restricted to administrators.

Each cycle allows four attempts: the initial attempt followed by retries after
1, 5 and 15 minutes. Manual retry starts a new cycle and records the administrator
ID; old attempts remain available. Concurrent retry requests cannot start duplicate
cycles. Claims have a 60-second lease and provider calls a 10-second timeout.
Expired claims are recorded as interrupted and follow the same retry limit.
Database leases prevent concurrent workers from claiming the same active job.
This does not provide exactly-once external delivery after a process crash: a
future real gateway must support idempotency and delivery receipts.

## Deployment and operations

1. Back up the database, then run `npm run migrate --prefix backend` against the
   intended environment before restarting the application. Startup also runs the
   repository's migration runner.
2. Keep `NOTIFICATION_WORKER_ENABLED=true` (default). Set it to `false` to pause
   processing while preserving queued jobs. Restart after changing this flag.
3. Check Admin → Notifications after creating and approving a test booking. Within
   one worker interval, immediate jobs should say **Simulated — no SMS sent** and
   the reminder should remain queued until two hours before kickoff.
4. Review failed/interrupted jobs and application `notification_worker_failed`
   errors. No phone numbers, message bodies or raw provider errors are logged by
   the mock worker. Database backups include both notification tables and their
   audit history. Restore them together with bookings; restored queued jobs may
   be processed again, so pause the worker during restore verification.

Job timestamps are UTC epoch milliseconds; the admin UI displays Asia/Dhaka time.
Do not enable a real gateway by changing credentials or swapping an export. The
worker is deliberately pinned to mock until delivery/idempotency handling and
provider-specific tests are implemented. No real SMS provider has been selected.

## Verification

`RUN_DB_TESTS=1 node --test backend/tests/integration/notifications.test.js` uses an
isolated disposable database. It covers transactional rollback, duplicate payment
callbacks, retries, restart/lease recovery, concurrent workers, midnight/timezone
boundaries, cancellation, short-notice approval, slot edits, legacy backfill and
admin authorization/masking/audit APIs.

Build the frontend, then run `npm run test:e2e --prefix frontend`. The notification
browser tests cover failed attempts, admin retry/history, simulated success,
refresh failures, mobile layout and authentication. Failure injection and manual
worker ticks exist only in the test fixture executable, which requires
`NODE_ENV=test` and is excluded from release bundles.

## Send now and resend before kickoff

Migration `007-notification-resend` adds manual job links, administrator metadata
and durable request receipts. Apply it through the migration runner before using
this version. Existing automatic jobs retain their identity and event deduplication.

Admin → Notifications now offers **Send now** for relevant queued/retrying/failed
jobs and **Resend** for completed simulations. The request queues work for the next
worker cycle (normally within one minute); it does not send SMS synchronously.
Processing, skipped, removed or superseded notifications cannot be resent. All
manual sends, including booking requests and cancellations, require a valid current
kickoff strictly in the future. Workers recheck eligibility before each attempt;
an attempt already in flight cannot be recalled.

Sending a future automatic reminder creates a separate manual job and preserves
the original two-hour reminder. Slot edits update the manual reminder's message
without delaying its immediate send time. Sending a completed simulation also
creates a linked job. Other waiting jobs are expedited in place, with a fresh retry
cycle. New manual requests snapshot the current booking time, venue and recipient;
old attempt message snapshots remain unchanged. Once a manual job completes or
fails, another manual send can be requested before kickoff.

`POST /api/admin/notifications/:id/resend` accepts `{ "request_key": "<unique key>" }`
and returns `{ "job_id": 123, "message": "..." }`. Keys are 16–64 ASCII letters,
digits, underscores or hyphens; clients use a UUID and retain it when a request's
outcome is uncertain. The same key, admin and source return the original result.
Invalid keys return 400; ineligible jobs, a reused key for another request, or an
already-pending manual send return 409. Admin authentication is required.
List/detail responses expose `can_resend`, `resend_unavailable_reason`,
`source_job_id` and `requested_by`. The existing failed-job retry endpoint remains
available and enforces kickoff/pending-send checks too.

Manual requests are audited with administrator, time and message. Concurrent
requests for the same booking are serialized; a pending manual send prevents
additional sends for the same original notification. Backups and restores must
include `notification_resend_requests` along with jobs and attempt history so
request deduplication survives restart/restore. The mock-only delivery policy and
1/5/15-minute retry delays remain unchanged.

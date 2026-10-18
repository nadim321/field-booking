# Booking prices and financial reporting

Migration `004-booking-prices.js` adds `bookings.booking_price` (DECIMAL) and `price_source`. Confirmation captures the server's slot price while holding the slot lock. Editing a slot affects future bookings only. Each generated season occurrence captures the rate at its own creation. Payment initialization/validation, customer result, PDF, admin payment actions and calendar use the snapshot. Availability and season templates still show the current slot rate.

Existing bookings are backfilled once using the slot rate at migration time and marked `legacy_estimate`. This cannot recover their original historical price. Admin views, PDFs and report warnings expose this limitation. Retrying migration never overwrites a snapshot. Missing amounts on old `paid` records stay missing; no receipt is fabricated.

## Dashboard definitions

All totals are lifetime BDT amounts, computed with MySQL DECIMAL arithmetic in one repeatable-read transaction. Calendar navigation dates do not filter these totals.

| Revenue field | Meaning |
| --- | --- |
| `approved_booking_value` | Frozen prices of approved bookings |
| `received_amount` | Recorded amount_paid across all statuses, including pending and cancelled |
| `approved_outstanding` | Sum of max(frozen price minus received, 0) per approved booking |
| `pending_outstanding` | Same calculation for pending bookings, separately |
| `refunded_amount` | Sum of completed, recorded refund settlements |
| `refund_outstanding` | Each cancellation's entitlement minus its settlements, floored at zero |
| `net_received` | Received minus refunded; not profit |
| `legacy_estimate_count` | Bookings with migration-time price estimates |
| `missing_paid_amount_count` | Bookings flagged paid with no positive recorded amount |

Compatibility aliases: `total_approved` means `approved_booking_value`, `total_paid` means `received_amount`, and `pending_payment` means `approved_outstanding`. Consumers of the old names must use these corrected definitions.

Late verified payments on cancelled bookings increase received money and refund liability without reopening the booking. Duplicate callbacks do not credit twice. Cancellation quotes are not completed refunds. Refund recording documents an external refund; it does not transfer money.

## Rollout

1. Stop all old application writers and recurring schedulers for maintenance.
2. Take and verify a backup using the [deployment runbook](DEPLOYMENT.md).
3. Install the new release and run `npm run migrate --prefix backend`, then `npm run migrate:check --prefix backend`.
4. Start the new application and scheduler. Check readiness, legacy warnings and a known booking's price and balance.

Do not run old writers alongside migration: required snapshot columns intentionally have no fabricated default. Generic advice to roll code back while retaining additive schema does **not** apply to pre-004 writers. Roll forward with a compatible fix, or perform a planned restore and payment reconciliation during maintenance.

## Regression checks

`backend/tests/integration/booking-prices.test.js` covers partial migration recovery, repricing, new snapshots, legacy warnings, duplicate late payments, refunds, decimal balances and season generation. Browser tests check dashboard financial cards and an existing booking after a slot edit. Integration tests with `RUN_DB_TESTS=1` use temporary databases. See the deployment runbook for complete build, browser and backup/restore commands.

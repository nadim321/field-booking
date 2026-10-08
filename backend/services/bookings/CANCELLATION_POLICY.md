# Cancellation and refund policy

Version: `2026-09-10-v2`. This is a chosen business default, not a universal industry standard or a legal determination.

| Cancellation received/recorded before kickoff | Refund of amount actually paid |
| --- | --- |
| At least 48 hours | 100% |
| At least 24 hours, less than 48 hours | 50% |
| Less than 24 hours, strictly before kickoff | 25% |
| At/after kickoff, no-show | 0% |
| Turf cancellation (closure, unsafe conditions, venue issue) | 100% |

The v2 short-notice rate is a business-requested increase from 0% to 25%. It also applies to future cancellations of v1 bookings; existing cancellation/refund records stay unchanged.

Deadlines use Asia/Dhaka (+06:00), including midnight slots. Refund calculations use paid money, not the advertised full slot price. Round to BDT 0.01. Unpaid bookings produce no refund. The staff processing target is 7–10 business days to the original payment method; bank/provider delays may take longer. The target is not an automated payout guarantee.

Customers contact the turf to cancel. Staff choose customer versus venue cancellation, preview the current entitlement, enter a reason and confirm. The confirmation time is the recorded cancellation time; a preview does not reserve an earlier tier. Rescheduling remains subject to staff approval and availability. Season plans require separate review and are excluded from this individual-booking workflow.

Published examples consulted on 2026-09-10:

- https://www.inloopworld.com/cancellation — 48/24-hour tier pattern and full venue-cancellation refund.
- https://www.oxford.gov.uk/leisure-sports-facilities/sports-pitch-terms-conditions — 48-hour full-refund window and venue-cancellation refund.

## Implementation and operations

- `GET /api/booking-policy` and public settings expose bilingual policy text and its version.
- Hold confirmation and the legacy direct-booking route require `policy_accepted: true` and the current `policy_version`. Both save version and acceptance time atomically with booking creation. Older clients need updating.
- Existing bookings have no acceptance record and receive a 100% goodwill refund; do not apply the new penalties retroactively. Legacy paid flags without a recorded amount require payment reconciliation first.
- Admin booking rows provide a cancellation dialog, calculated entitlement, refunded amount and a separate **Record completed refund** action. Recording requires the actual original-method refund reference and matching amount. It does not invoke SSLCommerz's refund API or transfer money.
- Cancellation/payment transactions lock the same booking. Duplicate validated callbacks credit once. Payments received after cancellation never reopen the booking and add their full amount to the refund liability, including after an earlier refund was recorded.
- Cancelled bookings and refund settlements retain their audit history. Active-booking uniqueness excludes cancelled rows, allowing the released slot to be booked again.
- Customer OTP-based account access and self-service cancellation are not enabled by this change; the SMS adapter is still a mock.

## Database rollout

`database.js` explicitly initializes the pool and runs the checksummed migration runner before HTTP startup. `001-initial-schema.js` adopts or creates the base tables; `002-cancellation.js` adds policy columns, active-date uniqueness and refund history. Existing data is retained. The migration user needs CREATE/ALTER privileges. `RUN_MIGRATIONS=false` verifies the schema instead of modifying it. See the deployment guide for rollout and recovery.

Before production rollout, take the normal database backup and test this migration on a staging copy using the same MySQL version. Verify a cancelled slot can be booked again, active duplicates fail, restart is safe, and cancellation/refund history prevents deletion. Unit tests use an in-memory adapter; `RUN_DB_TESTS=1 npm run test:integration` also verifies real MySQL migrations, concurrent holds/payments and rebooking in isolated temporary databases.

## Validation

Run `npm test --prefix backend` and `npm run build --prefix frontend -- --configuration development`. The service checks cover tier boundaries, Bangladesh midnight, rounding, legacy bookings, rollback, refund amount/reference requirements, duplicate cancellation, duplicate payment and late payments. Real SMS, gateway refund execution, and a live database migration require separate staging validation.

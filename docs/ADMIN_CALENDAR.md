# Admin booking calendar

Open `/admin/dashboard` after admin login. **Booking Calendar** is the default tab; Overview, Bookings, Season Requests, Slot Setup and Bulk Blocking remain available.

Desktop starts in Week view (Sunday–Saturday). Screens below 768px start in Day view; either view can be selected manually. Use Today, the date input or the previous/next buttons to navigate. Dates and slot times refer to Bangladesh time (`Asia/Dhaka`), regardless of the browser's timezone. A slot ending at or before its start time ends the following day and is marked `+1 day`.

The calendar uses a dark navy workspace and details dialog with light text and bright status accents. Labels, distinct icons and coloured borders match across cells, totals and details: emerald Available, blue Booked, amber Pending, cyan Held, violet Season Reserved and coral-red Blocked. Inactive cells use subtle slate stripes; Past cells have dashed borders. Royal-blue controls indicate the selected view; sky-blue accents identify keyboard focus and the labelled, underlined Today header. Hover slightly brightens the cell background and border. Status labels are at least 13px and supporting calendar text at least 12px. Other admin tabs keep their existing theme.

Each configured slot has a separate row, including inactive slots and templates sharing the same time. Select any cell for read-only details. Booking cells show the customer, team, phone, recorded payment status, amount received and outstanding balance. Blocks show their reason; holds show their approximate expiry; season reservations show their contact and date range. Payment status is the recorded booking status, not an independent claim that an online gateway payment was verified.

## Status rules

| Label | Meaning |
| --- | --- |
| Available | Active slot without a booking, block, active season reservation or live hold; its end time has not passed. |
| Booked | Approved booking. |
| Pending | Booking awaiting approval. |
| Held | Customer's temporary, unexpired hold. |
| Season Reserved | An active recurring plan covers this date and weekday. |
| Blocked | Staff-created block. |
| Inactive | Disabled slot without an occupying record. |
| Past | Unoccupied active slot whose end time has passed. |

Precedence is block → pending/approved booking → season reservation → live hold → inactive → past → available. Cancelled bookings and expired holds do not occupy the calendar. A cancelled individual season booking can still be covered by an active season template, matching existing public availability rules.

A block overlapping an active booking displays **Booking exists**. Both records remain in details; the calendar does not automatically cancel or resolve either. Occupied inactive/historical slots retain their booking status with additional inactive/ended information. Counts describe the primary status of date/slot cells in the displayed range; they are not financial metrics or counts of unique customers.

## Freshness and controls

The calendar fetches when opened, when dates change, on manual refresh, when returning to a visible browser tab, and every 30 seconds while visible. Requests time out after 15 seconds. Leaving the calendar tab stops its polling and cancels outstanding requests. Data is a snapshot, not a real-time lock; expired holds and new bookings are reflected on the next successful refresh.

A failed refresh retains the previous snapshot with a warning. A failed request for a different date range displays an error without old slot data. Unauthorized responses clear the calendar and return to login. The details dialog supports keyboard focus containment, Escape and focus restoration. Existing admin tabs perform all modifications; the calendar adds no booking/payment mutation.

## API and verification

`GET /api/admin/calendar?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD` requires the existing admin bearer token and returns `Cache-Control: no-store`. Dates are required, must exist and must span 1–7 days inclusive; invalid input returns 400. The response contains `start_date`, `end_date`, `timezone`, `server_time`, `dates`, `slots`, `cells` and status `counts`. Cells are keyed by `slot_id` and `date`, with optional booking, block, hold and season details. The endpoint does not expose hold session tokens, customer email, gateway sessions or payment transaction payloads.

A bounded set of queries reads the selected date range using a consistent MySQL transaction. No migration or new dependency is required. Public availability and cancellation/payment rules are unchanged.

Run from the repository root:

```bash
npm run check --prefix backend
npm test --prefix backend
RUN_DB_TESTS=1 npm run test:integration --prefix backend
npm test --prefix frontend -- --watch=false --browsers=ChromeHeadless
npm run build --prefix frontend
npm run test:e2e --prefix frontend
```

Integration and browser tests create and remove isolated databases; the configured DB account needs CREATE/DROP DATABASE privileges. Browser tests use the existing test-only gateway and fixtures. `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome` can select an installed Chrome. Calendar browser scenarios save illustrative screenshots with synthetic customer records to `artifacts/admin-calendar-desktop.png` and `artifacts/admin-calendar-mobile.png`.

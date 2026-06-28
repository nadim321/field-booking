/**
 * Recurring Booking Scheduler
 * ----------------------------
 * Generates individual `bookings` rows from active `recurring_bookings`
 * templates. No cron library is used (per project decision) -- this is a
 * plain setInterval loop, started once from server.js.
 *
 * What it does, once per run:
 *   1. Marks any `active` template whose end_date has passed as `expired`.
 *   2. For every `active` template, walks the next GENERATION_WINDOW_DAYS
 *      days looking for dates matching the template's day_of_week, within
 *      [start_date, end_date].
 *   3. For each matching date:
 *      - Skip if a `bookings` row already exists for that slot_id/date
 *        (covers both rows this job already generated on a prior run,
 *        and one-off bookings made directly by a customer/admin).
 *      - Skip if a *live* slot_hold exists for that slot_id/date (someone
 *        is mid-checkout right now) -- retried automatically on the next
 *        run since holds are short-lived (minutes) and this job runs daily.
 *      - If the date was free: insert a new `bookings` row
 *        (status='pending', recurring_booking_id set) and fire the normal
 *        notifyBookingCreated().
 *      - If the date was taken by a one-off booking (the conflict case
 *        explicitly called out in the feature spec): skip generating it,
 *        and fire notifyRecurringConflict() (to the customer) and
 *        notifyRecurringConflictAdmin() (to the admin's own inbox).
 *
 * Running daily and always looking GENERATION_WINDOW_DAYS ahead (rather
 * than generating exactly one week at a time) makes this self-healing: if
 * the server is down for a few days, the next run still catches up on any
 * occurrences that should have been generated, since nothing is skipped
 * just because "its day already passed" -- only because a row already
 * exists for it or it's now further in the past than this window reaches.
 *
 * NOTE: this module never crashes server.js. Every DB call failure is
 * caught and logged; a problem with one template does not stop the others
 * from being processed.
 */

const db = require('../../database');
const notificationService = require('../notifications/notification.service');

const GENERATION_WINDOW_DAYS = 50;
const RUN_INTERVAL_MS = 24 * 60 * 60 * 1000; // once a day

function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}

function todayStr() {
  return toDateStr(new Date());
}

/** Returns an array of YYYY-MM-DD strings: every date matching dayOfWeek,
 * within [startDate, endDate] inclusive, starting from today for the next
 * `windowDays` days. */
function getOccurrencesInWindow(dayOfWeek, startDateStr, endDateStr, windowDays) {
  const results = [];
  const windowStart = new Date(todayStr() + 'T00:00:00Z');
  for (let i = 0; i < windowDays; i++) {
    const d = new Date(windowStart);
    d.setUTCDate(d.getUTCDate() + i);
    const dStr = toDateStr(d);
    if (d.getUTCDay() === dayOfWeek && dStr >= startDateStr && dStr <= endDateStr) {
      results.push(dStr);
    }
  }
  return results;
}

/** Promise wrapper around db.all for cleaner async/await flow in this module only. */
function dbAll(sql, params) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

function dbGet(sql, params) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function dbRun(sql, params) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

/** Expires any active templates whose end_date has passed. */
async function expireOldTemplates() {
  try {
    const result = await dbRun(
      `UPDATE recurring_bookings SET status = 'expired' WHERE status = 'active' AND end_date < ?`,
      [todayStr()]
    );
    if (result.changes > 0) {
      console.log(`[RecurringScheduler] Expired ${result.changes} recurring booking template(s) past their end date.`);
    }
  } catch (err) {
    console.error('[RecurringScheduler] Failed to expire old templates:', err.message);
  }
}

/** Processes a single active template: generates missing weeks, skips conflicts. */
async function processTemplate(template) {
  const dates = getOccurrencesInWindow(
    template.day_of_week,
    template.start_date instanceof Date ? toDateStr(template.start_date) : template.start_date,
    template.end_date instanceof Date ? toDateStr(template.end_date) : template.end_date,
    GENERATION_WINDOW_DAYS
  );

  for (const date of dates) {
    try {
      // Already generated (by this job before, or any other booking for
      // that slot/date -- one-off or otherwise)?
      const existingBooking = await dbGet(
        `SELECT * FROM bookings WHERE slot_id = ? AND booking_date = ?`,
        [template.slot_id, date]
      );

      if (existingBooking) {
        if (existingBooking.recurring_booking_id === template.id) {
          // Already generated by us on a previous run -- nothing to do.
          continue;
        }
        // Conflict: a one-off (or different recurring) booking already
        // occupies this slot/date. Per spec: skip + notify customer + admin.
        await notificationService.notifyRecurringConflict(template, date);
        await notificationService.notifyRecurringConflictAdmin(template, date);
        continue;
      }

      // Is someone mid-checkout holding this exact slot/date right now?
      // Don't fight an in-progress hold -- just skip this run, retry next
      // time (holds expire in minutes; this job runs daily).
      const liveHold = await dbGet(
        `SELECT * FROM slot_holds WHERE slot_id = ? AND booking_date = ? AND expires_at > CURRENT_TIMESTAMP`,
        [template.slot_id, date]
      );
      if (liveHold) {
        continue;
      }

      // Clear to generate this week's occurrence.
      const insertResult = await dbRun(
        `INSERT INTO bookings (slot_id, booking_date, customer_name, customer_phone, customer_email, team_name, status, payment_status, recurring_booking_id)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', 'unpaid', ?)`,
        [
          template.slot_id,
          date,
          template.customer_name,
          template.customer_phone,
          template.customer_email,
          template.team_name,
          template.id
        ]
      );

      // Reuse the standard booking-created notification, with the slot's
      // start/end time attached if the template row carries them (joined
      // in by the caller -- see runOnce()).
      notificationService.notifyBookingCreated({
        id: insertResult.lastID,
        booking_date: date,
        start_time: template.start_time,
        end_time: template.end_time,
        customer_name: template.customer_name,
        customer_phone: template.customer_phone,
        customer_email: template.customer_email,
        team_name: template.team_name,
        recurring_booking_id: template.id
      });
    } catch (err) {
      // A failure on one date/template should never stop the rest of the
      // run -- log and move on to the next date.
      console.error(`[RecurringScheduler] Failed processing template ${template.id} for date ${date}:`, err.message);
    }
  }
}

/** Runs one full pass: expire old templates, then generate for all active ones. */
async function runOnce() {
  await expireOldTemplates();

  let templates;
  try {
    templates = await dbAll(
      `SELECT rb.*, s.start_time, s.end_time
       FROM recurring_bookings rb
       JOIN slots s ON rb.slot_id = s.id
       WHERE rb.status = 'active'`,
      []
    );
  } catch (err) {
    console.error('[RecurringScheduler] Failed to fetch active templates:', err.message);
    return;
  }

  for (const template of templates) {
    await processTemplate(template);
  }
}

let intervalHandle = null;

/** Starts the daily scheduler. Call once from server.js at startup. */
function start() {
  if (intervalHandle) return; // already started, avoid double-scheduling
  console.log('[RecurringScheduler] Starting recurring booking scheduler (runs once now, then every 24h).');
  // Run once on startup so new/changed templates don't wait a full day for
  // their first generation pass, then repeat on the interval.
  runOnce().catch(err => console.error('[RecurringScheduler] Initial run failed:', err.message));
  intervalHandle = setInterval(() => {
    runOnce().catch(err => console.error('[RecurringScheduler] Scheduled run failed:', err.message));
  }, RUN_INTERVAL_MS);
}

function stop() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

module.exports = {
  start,
  stop,
  runOnce // exported for manual/admin-triggered runs and testing
};

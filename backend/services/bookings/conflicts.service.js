const db = require('../../database');

function findActiveRecurringConflict(slotId, dateStr, callback) {
  db.all(
    `SELECT * FROM recurring_bookings WHERE slot_id = ? AND status = 'active' AND start_date <= ? AND end_date >= ?`,
    [slotId, dateStr, dateStr],
    (err, candidates) => {
      if (err) return callback(err, null);
      const targetDayOfWeek = new Date(dateStr + 'T00:00:00Z').getUTCDay();
      const conflict = candidates.find(rb => rb.day_of_week === targetDayOfWeek);
      callback(null, conflict || null);
    }
  );
}
module.exports = { findActiveRecurringConflict };

const db = require('../database');
const notificationService = require('../services/notifications/notification.service');
const recurringScheduler = require('../services/recurring/recurring-booking.scheduler');

const MAX_RECURRING_RANGE_MONTHS = 3;
function addMonthsUTC(dateStr, months) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

exports.create = (req, res) => {
  const { slot_id, start_date, end_date, customer_name, customer_phone, customer_email, team_name } = req.body;

  if (!slot_id || !start_date || !end_date || !customer_name || !customer_phone) {
    return res.status(400).json({ message: 'Required fields: slot_id, start_date, end_date, customer_name, customer_phone' });
  }

  // Basic date format/order sanity checks
  const startDateObj = new Date(start_date + 'T00:00:00Z');
  const endDateObj = new Date(end_date + 'T00:00:00Z');
  if (isNaN(startDateObj.getTime()) || isNaN(endDateObj.getTime())) {
    return res.status(400).json({ message: 'start_date and end_date must be valid dates (YYYY-MM-DD)' });
  }
  if (endDateObj <= startDateObj) {
    return res.status(400).json({ message: 'end_date must be after start_date' });
  }

  // Enforce the 3-month maximum range for self-serve requests. Longer
  // arrangements are handled manually by the admin extending an active
  // template's end_date later -- not exposed through this public endpoint.
  const maxAllowedEndDate = addMonthsUTC(start_date, MAX_RECURRING_RANGE_MONTHS);
  if (end_date > maxAllowedEndDate) {
    return res.status(400).json({
      message: `Season booking range cannot exceed ${MAX_RECURRING_RANGE_MONTHS} months. Maximum end date for this start date is ${maxAllowedEndDate}.`
    });
  }

  // day_of_week is always derived from start_date server-side -- never
  // trust a client-supplied weekday, since it could be inconsistent with
  // start_date and corrupt the generation job's date math.
  const day_of_week = startDateObj.getUTCDay();

  // Verify slot is active
  db.get('SELECT * FROM slots WHERE id = ? AND is_active = 1', [slot_id], (err, slot) => {
    if (err) {
      return res.fail(err);
    }
    if (!slot) {
      return res.status(400).json({ message: 'Selected slot is not active or does not exist' });
    }

    db.run(
      `INSERT INTO recurring_bookings (slot_id, day_of_week, start_date, end_date, customer_name, customer_phone, customer_email, team_name, status, customer_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending_approval', ?)`,
      [slot_id, day_of_week, start_date, end_date, customer_name, customer_phone, customer_email, team_name, req.body.customer_id || null],
      function (err) {
        if (err) {
          return res.fail(err);
        }

        const created = {
          id: this.lastID,
          slot_id,
          day_of_week,
          start_date,
          end_date,
          customer_name,
          customer_phone,
          customer_email,
          team_name,
          status: 'pending_approval'
        };

        // Let the admin know a new request needs review.
        notificationService.notifyRecurringRequestSubmittedAdmin(created);

        res.status(201).json({
          message: 'Season booking request submitted! It is pending admin approval before any slots are reserved.',
          recurring_booking: created
        });
      }
    );
  });
};

exports.list = (req, res) => {
  const { status } = req.query;
  const validStatuses = ['pending_approval', 'active', 'paused', 'cancelled', 'expired'];

  if (status && !validStatuses.includes(status)) {
    return res.status(400).json({ message: 'Invalid status filter' });
  }

  const baseQuery = `
    SELECT rb.*, s.start_time, s.end_time, s.price
    FROM recurring_bookings rb
    JOIN slots s ON rb.slot_id = s.id
  `;

  if (status) {
    db.all(`${baseQuery} WHERE rb.status = ? ORDER BY rb.created_at DESC`, [status], (err, rows) => {
      if (err) {
        return res.fail(err);
      }
      res.json(rows);
    });
  } else {
    db.all(`${baseQuery} ORDER BY rb.created_at DESC`, [], (err, rows) => {
      if (err) {
        return res.fail(err);
      }
      res.json(rows);
    });
  }
};

exports.update = (req, res) => {
  const { id } = req.params;
  const { status, end_date } = req.body;

  const validStatuses = ['pending_approval', 'active', 'paused', 'cancelled', 'expired'];
  let updateFields = [];
  let params = [];

  if (status) {
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid status value' });
    }
    updateFields.push('status = ?');
    params.push(status);
  }

  if (end_date) {
    if (isNaN(new Date(end_date + 'T00:00:00Z').getTime())) {
      return res.status(400).json({ message: 'end_date must be a valid date (YYYY-MM-DD)' });
    }
    updateFields.push('end_date = ?');
    params.push(end_date);
  }

  if (updateFields.length === 0) {
    return res.status(400).json({ message: 'Provide status or end_date to update' });
  }

  params.push(id);

  db.run(
    `UPDATE recurring_bookings SET ${updateFields.join(', ')} WHERE id = ?`,
    params,
    function (err) {
      if (err) {
        return res.fail(err);
      }
      if (this.changes === 0) {
        return res.status(404).json({ message: 'Recurring booking not found' });
      }
      res.json({ message: 'Recurring booking updated successfully' });
    }
  );
};

exports.remove = (req, res) => {
  const { id } = req.params;

  db.run('DELETE FROM recurring_bookings WHERE id = ?', [id], function (err) {
    if (err) {
      return res.fail(err);
    }
    if (this.changes === 0) {
      return res.status(404).json({ message: 'Recurring booking not found' });
    }
    res.json({ message: 'Recurring booking deleted successfully' });
  });
};

exports.runNow = async (req, res) => {
  try {
    await recurringScheduler.runOnce();
    res.json({ message: 'Recurring booking generation pass completed' });
  } catch (err) {
    res.fail(err);
  }
};

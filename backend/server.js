const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
require('dotenv').config();
const crypto = require('crypto');
const { generateToken } = require('./utils/token');

const db = require('./database');
const authenticateAdmin = require('./middleware/auth');
const notificationService = require('./services/notifications/notification.service');
const recurringScheduler = require('./services/recurring/recurring-booking.scheduler');
const { isValidCategory, categoryLabel } = require('./constants/slot-categories');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'turf_booking_super_secret_key_123!@#';

// Middleware
app.use(cors());
app.use(express.json());

// Serve Angular static files from the 'public' subfolder
const frontendPath = path.join(__dirname, 'public');
app.use(express.static(frontendPath));

// --- Shared helper: recurring/season booking conflict check ---
//
// A one-off booking must never be created for a slot/date that an
// *active* recurring booking template already claims for that weekday --
// otherwise an admin or customer could double-book a slot the season
// customer is relying on, in the window before the daily scheduler has
// generated that week's actual `bookings` row (see
// services/recurring/recurring-booking.scheduler.js).
//
// This is checked independently at every place a new one-off booking can
// be created (hold, confirm, and the legacy direct-booking endpoint) --
// not just in the UI -- so a stale page, direct API call, or race
// condition can never slip a conflicting booking through.
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

// --- PUBLIC ROUTES ---

// 1. Admin Login
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required' });
  }

  db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
    if (err) {
      return res.status(500).json({ message: 'Database error occurred', error: err.message });
    }

    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const isMatch = bcrypt.compareSync(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      message: 'Login successful',
      token,
      admin: { id: user.id, username: user.username }
    });
  });
});

// 2. Get Available Slots for a Specific Date
app.get('/api/slots/available', (req, res) => {
  const { date } = req.query;

  if (!date) {
    return res.status(400).json({ message: 'Date query parameter is required (format: YYYY-MM-DD)' });
  }

  // Determine current server time in Bangladesh timezone (UTC+6)
  const now = new Date();
  const bdOffset = 6 * 60; // UTC+6 in minutes
  const bdNow = new Date(now.getTime() + (bdOffset + now.getTimezoneOffset()) * 60000);

  // Build today's date string in YYYY-MM-DD format
  const todayStr = bdNow.toISOString().slice(0, 10);
  const isToday = date === todayStr;

  // Current time as "HH:MM" string for comparison
  const currentTimeStr = bdNow.toTimeString().slice(0, 5);

  // First, get all configurations of active slots
  db.all('SELECT * FROM slots WHERE is_active = 1 ORDER BY TIME(start_time) ASC', [], (err, slots) => {
    if (err) {
      return res.status(500).json({ message: 'Failed to retrieve slots', error: err.message });
    }

    // If viewing today, remove slots whose end_time has already passed.
    // Special case: a slot ending at '00:00' represents midnight at the
    // END of this day (e.g. a 23:00-00:00 slot), not the start of it --
    // as a plain string, '00:00' is always <= any currentTimeStr, which
    // would make this comparison incorrectly treat it as already over
    // the instant the date is viewed. Treat '00:00' as '24:00' for this
    // comparison only, so the slot stays visible all day until it
    // actually passes at midnight (when `date` itself rolls over to the
    // next day and this slot belongs to a different day's listing).
    const visibleSlots = isToday
      ? slots.filter(slot => {
        const effectiveEndTime = slot.end_time === '00:00' ? '24:00' : slot.end_time;
        return effectiveEndTime > currentTimeStr;
      })
      : slots;

    // Next, get all approved/pending bookings for this date
    db.all(
      `SELECT b.*, s.start_time, s.end_time
       FROM bookings b
       JOIN slots s ON b.slot_id = s.id
       WHERE b.booking_date = ? AND b.status IN ('pending', 'approved')`,
      [date],
      (err, bookings) => {
        if (err) {
          return res.status(500).json({ message: 'Failed to retrieve bookings', error: err.message });
        }

        // Also fetch active holds for this date
        db.all(
          `SELECT slot_id FROM slot_holds WHERE booking_date = ? AND expires_at > CURRENT_TIMESTAMP`,
          [date],
          (err, holds) => {
            if (err) {
              return res.status(500).json({ message: 'Failed to retrieve slot holds', error: err.message });
            }
            const heldSlotIds = holds.map(h => h.slot_id);

            // Also fetch active recurring (season) booking templates whose
            // weekday matches this date and whose range covers it -- these
            // slots must show as reserved even before the daily scheduler
            // has generated this week's actual `bookings` row, otherwise
            // customers can (and did) book straight through the gap. See
            // findActiveRecurringConflict() for the matching write-side guard.
            const targetDayOfWeek = new Date(date + 'T00:00:00Z').getUTCDay();
            db.all(
              `SELECT slot_id FROM recurring_bookings WHERE status = 'active' AND day_of_week = ? AND start_date <= ? AND end_date >= ?`,
              [targetDayOfWeek, date, date],
              (err, recurringTemplates) => {
                if (err) {
                  return res.status(500).json({ message: 'Failed to retrieve season bookings', error: err.message });
                }
                const seasonReservedSlotIds = recurringTemplates.map(rb => rb.slot_id);

                // Map slot config and join bookings info
                const result = visibleSlots.map(slot => {
                  const bookingForSlot = bookings.find(b => b.slot_id === slot.id);
                  const isHeld = heldSlotIds.includes(slot.id);
                  const isSeasonReserved = seasonReservedSlotIds.includes(slot.id);

                  let status;
                  if (bookingForSlot) {
                    status = bookingForSlot.status;
                  } else if (isSeasonReserved) {
                    status = 'season_reserved';
                  } else if (isHeld) {
                    status = 'held';
                  } else {
                    status = 'available';
                  }

                  return {
                    id: slot.id,
                    start_time: slot.start_time,
                    end_time: slot.end_time,
                    price: slot.price,
                    is_active: slot.is_active,
                    category: slot.category,
                    category_label: categoryLabel(slot.category),
                    status,
                    booking_details: bookingForSlot ? {
                      booking_id: bookingForSlot.id,
                      team_name: bookingForSlot.team_name,
                      payment_status: bookingForSlot.payment_status
                    } : null
                  };
                });

                res.json({ date, slots: result, server_time: currentTimeStr, is_today: isToday });
              }
            );
          }
        );
      }
    );
  });
});

// 3. Request a Booking (Customer Facing)
// NOTE: Existing direct booking endpoint retained for admin/legacy usage. New flow uses hold + confirm.

// 3a. Create a temporary hold when booking form is opened
app.post('/api/slots/hold', (req, res) => {
  const { slot_id, booking_date } = req.body;
  if (!slot_id || !booking_date) {
    return res.status(400).json({ message: 'slot_id and booking_date are required' });
  }
  // Verify slot is active
  db.get('SELECT * FROM slots WHERE id = ? AND is_active = 1', [slot_id], (err, slot) => {
    if (err) return res.status(500).json({ message: 'Database error', error: err.message });
    if (!slot) return res.status(400).json({ message: 'Invalid or inactive slot' });

    // Reject if an active season booking template claims this slot/date
    findActiveRecurringConflict(slot_id, booking_date, (err, recurringConflict) => {
      if (err) return res.status(500).json({ message: 'Database error', error: err.message });
      if (recurringConflict) {
        return res.status(409).json({ message: 'This slot is reserved for a season booking on this date' });
      }

      // Reject if slot is already booked (pending/approved) for this date
      db.get(
        "SELECT * FROM bookings WHERE slot_id = ? AND booking_date = ? AND status IN ('pending', 'approved')",
        [slot_id, booking_date],
        (err, booking) => {
          if (err) return res.status(500).json({ message: 'Database error', error: err.message });
          if (booking) return res.status(409).json({ message: 'This slot is already booked for the selected date' });

          // Reject if another *live* hold exists for this slot/date.
          // Expired holds for the same slot_id/booking_date are deliberately
          // ignored here (and cleared below) -- there is no UNIQUE constraint
          // on (slot_id, booking_date) in slot_holds, so an old expired hold
          // can never block a brand new one.
          db.get(
            `SELECT * FROM slot_holds WHERE slot_id = ? AND booking_date = ? AND expires_at > CURRENT_TIMESTAMP`,
            [slot_id, booking_date],
            (err, liveHold) => {
              if (err) return res.status(500).json({ message: 'Database error', error: err.message });
              if (liveHold) return res.status(409).json({ message: 'Slot already held' });

              // Clear any stale expired holds for this slot/date before inserting
              db.run(
                `DELETE FROM slot_holds WHERE slot_id = ? AND booking_date = ? AND expires_at <= CURRENT_TIMESTAMP`,
                [slot_id, booking_date],
                (err) => {
                  if (err) return res.status(500).json({ message: 'Failed to clear stale hold', error: err.message });

                  const session_token = generateToken();
                  const expiryMinutes = process.env.HOLD_EXPIRY_MINUTES ? parseInt(process.env.HOLD_EXPIRY_MINUTES) : 7;
                  const expires_at = new Date(Date.now() + expiryMinutes * 60 * 1000);

                  db.run(
                    `INSERT INTO slot_holds (slot_id, booking_date, session_token, expires_at) VALUES (?, ?, ?, ?)`,
                    [slot_id, booking_date, session_token, expires_at],
                    function (err) {
                      if (err) {
                        if (err.code === 'ER_DUP_ENTRY') {
                          return res.status(409).json({ message: 'Slot already held' });
                        }
                        return res.status(500).json({ message: 'Failed to create hold', error: err.message });
                      }
                      res.json({ session_token, expires_at });
                    }
                  );
                }
              );
            }
          );
        }
      );
    });
  });
});

// 3b. Cancel a hold immediately (user clicked Cancel / closed the modal)
app.delete('/api/slots/hold', (req, res) => {
  const { slot_id, booking_date, session_token } = req.body;
  if (!session_token) {
    return res.status(400).json({ message: 'session_token is required' });
  }

  // session_token is unique on its own, but slot_id/booking_date are
  // accepted too (if present) as a defensive double-check against
  // deleting the wrong row.
  const conditions = ['session_token = ?'];
  const params = [session_token];
  if (slot_id) {
    conditions.push('slot_id = ?');
    params.push(slot_id);
  }
  if (booking_date) {
    conditions.push('booking_date = ?');
    params.push(booking_date);
  }

  db.run(
    `DELETE FROM slot_holds WHERE ${conditions.join(' AND ')}`,
    params,
    function (err) {
      if (err) {
        return res.status(500).json({ message: 'Failed to cancel hold', error: err.message });
      }
      // Not finding a row to delete isn't an error from the client's point
      // of view -- the hold may have already expired or been confirmed.
      res.json({ message: 'Hold cancelled', deleted: this.changes > 0 });
    }
  );
});

// 3c. Confirm booking using a valid hold
app.post('/api/slots/confirm', (req, res) => {
  const { slot_id, booking_date, customer_name, customer_phone, customer_email, team_name, session_token } = req.body;
  if (!slot_id || !booking_date || !customer_name || !customer_phone || !session_token) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  // Defense in depth: re-check the recurring conflict here too, even
  // though /api/slots/hold already checks it. A hold could have been
  // created in the brief window before a template was approved, or this
  // endpoint could be called directly without going through /hold at all.
  findActiveRecurringConflict(slot_id, booking_date, (err, recurringConflict) => {
    if (err) return res.status(500).json({ message: 'Database error', error: err.message });
    if (recurringConflict) {
      return res.status(409).json({ message: 'This slot is reserved for a season booking on this date' });
    }

    // Verify hold exists and is valid
    db.get(
      `SELECT * FROM slot_holds WHERE slot_id = ? AND booking_date = ? AND session_token = ? AND expires_at > CURRENT_TIMESTAMP`,
      [slot_id, booking_date, session_token],
      (err, hold) => {
        if (err) return res.status(500).json({ message: 'Database error', error: err.message });
        if (!hold) return res.status(400).json({ message: 'Invalid or expired hold token' });
        // Transaction: insert booking then delete hold
        db.getConnection((connErr, connection) => {
          if (connErr) return res.status(500).json({ message: 'Failed to obtain DB connection', error: connErr.message });
          connection.beginTransaction(trxErr => {
            if (trxErr) {
              connection.release();
              return res.status(500).json({ message: 'Transaction start error', error: trxErr.message });
            }
            // Insert booking
            connection.query(
              `INSERT INTO bookings (slot_id, booking_date, customer_name, customer_phone, customer_email, team_name, status, payment_status)
             VALUES (?, ?, ?, ?, ?, ?, 'pending', 'unpaid')`,
              [slot_id, booking_date, customer_name, customer_phone, customer_email, team_name],
              (insErr, result) => {
                if (insErr) {
                  return connection.rollback(() => {
                    connection.release();
                    if (insErr.code === 'ER_DUP_ENTRY') {
                      res.status(409).json({ message: 'Slot already booked' });
                    } else {
                      res.status(500).json({ message: 'Failed to create booking', error: insErr.message });
                    }
                  });
                }
                // Delete hold
                connection.query(
                  'DELETE FROM slot_holds WHERE id = ?',
                  [hold.id],
                  (delErr) => {
                    if (delErr) {
                      return connection.rollback(() => {
                        connection.release();
                        res.status(500).json({ message: 'Failed to delete hold', error: delErr.message });
                      });
                    }
                    connection.commit(commitErr => {
                      if (commitErr) {
                        return connection.rollback(() => {
                          connection.release();
                          res.status(500).json({ message: 'Commit error', error: commitErr.message });
                        });
                      }
                      connection.release();

                      // Fire-and-forget: notification failures must never
                      // affect the booking response already sent below.
                      notificationService.notifyBookingCreated({
                        id: result.insertId,
                        booking_date,
                        customer_name,
                        customer_phone,
                        customer_email,
                        team_name
                      });

                      res.status(201).json({
                        message: 'Booking confirmed',
                        booking_id: result.insertId,
                        details: { slot_id, booking_date, customer_name, customer_phone, team_name }
                      });
                    });
                  }
                );
              }
            );
          });
        });
      }
    );
  });
});

// NOTE: Existing direct booking endpoint retained for admin/legacy usage. New flow uses hold + confirm.
app.post('/api/bookings', (req, res) => {
  const { slot_id, booking_date, customer_name, customer_phone, customer_email, team_name } = req.body;

  if (!slot_id || !booking_date || !customer_name || !customer_phone) {
    return res.status(400).json({ message: 'Required fields: slot_id, booking_date, customer_name, customer_phone' });
  }

  // Verify slot is active
  db.get('SELECT * FROM slots WHERE id = ? AND is_active = 1', [slot_id], (err, slot) => {
    if (err) {
      return res.status(500).json({ message: 'Database error', error: err.message });
    }
    if (!slot) {
      return res.status(400).json({ message: 'Selected slot is not active or does not exist' });
    }

    // Reject if an active season booking template claims this slot/date
    findActiveRecurringConflict(slot_id, booking_date, (err, recurringConflict) => {
      if (err) {
        return res.status(500).json({ message: 'Database error', error: err.message });
      }
      if (recurringConflict) {
        return res.status(409).json({ message: 'This slot is reserved for a season booking on this date' });
      }

      // Verify slot is not already booked/pending for this date
      db.get(
        "SELECT * FROM bookings WHERE slot_id = ? AND booking_date = ? AND status IN ('pending', 'approved')",
        [slot_id, booking_date],
        (err, booking) => {
          if (err) {
            return res.status(500).json({ message: 'Database error', error: err.message });
          }
          if (booking) {
            return res.status(409).json({ message: 'This slot is already booked or has a pending reservation for the selected date' });
          }

          // Create booking with status 'pending'
          db.run(
            `INSERT INTO bookings (slot_id, booking_date, customer_name, customer_phone, customer_email, team_name, status, payment_status)
           VALUES (?, ?, ?, ?, ?, ?, 'pending', 'unpaid')`,
            [slot_id, booking_date, customer_name, customer_phone, customer_email, team_name],
            function (err) {
              if (err) {
                if (err.code === 'ER_DUP_ENTRY') {
                  return res.status(409).json({ message: 'This slot was just taken by another request' });
                }
                return res.status(500).json({ message: 'Failed to create booking request', error: err.message });
              }

              notificationService.notifyBookingCreated({
                id: this.lastID,
                booking_date,
                customer_name,
                customer_phone,
                customer_email,
                team_name
              });

              res.status(201).json({
                message: 'Booking request submitted successfully! Pending admin approval.',
                booking_id: this.lastID,
                details: {
                  slot_id,
                  booking_date,
                  customer_name,
                  customer_phone,
                  team_name,
                  price: slot.price
                }
              });
            }
          );
        }
      );
    });
  });
});

// 4. Request a Season/Recurring Booking (Customer Facing, self-serve)
// Creates a `recurring_bookings` TEMPLATE only -- no individual `bookings`
// rows are generated until an admin approves it (status: pending_approval
// -> active). The weekly generation job (services/recurring/recurring-booking.scheduler.js)
// only ever looks at 'active' templates.
const MAX_RECURRING_RANGE_MONTHS = 3;

function addMonthsUTC(dateStr, months) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

app.post('/api/recurring-bookings', (req, res) => {
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
      return res.status(500).json({ message: 'Database error', error: err.message });
    }
    if (!slot) {
      return res.status(400).json({ message: 'Selected slot is not active or does not exist' });
    }

    db.run(
      `INSERT INTO recurring_bookings (slot_id, day_of_week, start_date, end_date, customer_name, customer_phone, customer_email, team_name, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending_approval')`,
      [slot_id, day_of_week, start_date, end_date, customer_name, customer_phone, customer_email, team_name],
      function (err) {
        if (err) {
          return res.status(500).json({ message: 'Failed to create season booking request', error: err.message });
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
});


// --- ADMIN SECURE ROUTES ---

// 1. Get All Bookings for Admin Dashboard
app.get('/api/admin/bookings', authenticateAdmin, (req, res) => {
  db.all(
    `SELECT b.*, s.start_time, s.end_time, s.price 
     FROM bookings b
     JOIN slots s ON b.slot_id = s.id
     ORDER BY b.booking_date DESC, TIME(s.start_time) ASC`,
    [],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ message: 'Failed to retrieve bookings', error: err.message });
      }
      res.json(rows);
    }
  );
});

// 2. Update Booking Status / Payment Status (Approve/Cancel/Pay)
app.put('/api/admin/bookings/:id', authenticateAdmin, (req, res) => {
  const { id } = req.params;
  const { status, payment_status } = req.body;

  // Build dynamic update query
  let updateFields = [];
  let params = [];

  if (status) {
    if (!['pending', 'approved', 'cancelled'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status value' });
    }
    updateFields.push('status = ?');
    params.push(status);
  }

  if (payment_status) {
    if (!['paid', 'unpaid'].includes(payment_status)) {
      return res.status(400).json({ message: 'Invalid payment status value' });
    }
    updateFields.push('payment_status = ?');
    params.push(payment_status);
  }

  if (updateFields.length === 0) {
    return res.status(400).json({ message: 'Provide status or payment_status to update' });
  }

  params.push(id);

  // Fetch booking + slot details first so we have customer contact info
  // and slot timing available for the notification, regardless of which
  // fields the UPDATE below actually changes.
  db.get(
    `SELECT b.*, s.start_time, s.end_time, s.price
     FROM bookings b
     JOIN slots s ON b.slot_id = s.id
     WHERE b.id = ?`,
    [id],
    (fetchErr, bookingBeforeUpdate) => {
      if (fetchErr) {
        return res.status(500).json({ message: 'Failed to look up booking', error: fetchErr.message });
      }

      db.run(
        `UPDATE bookings SET ${updateFields.join(', ')} WHERE id = ?`,
        params,
        function (err) {
          if (err) {
            return res.status(500).json({ message: 'Failed to update booking', error: err.message });
          }
          if (this.changes === 0) {
            return res.status(404).json({ message: 'Booking not found' });
          }

          // Fire the relevant notification based on what status changed to.
          // bookingBeforeUpdate may be null if the booking vanished between
          // the SELECT and UPDATE (extremely unlikely) -- guard against that.
          if (bookingBeforeUpdate && status === 'approved') {
            notificationService.notifyBookingApproved(bookingBeforeUpdate);
          } else if (bookingBeforeUpdate && status === 'cancelled') {
            notificationService.notifyBookingCancelled(bookingBeforeUpdate);
          }

          res.json({ message: 'Booking updated successfully' });
        }
      );
    }
  );
});

// 3. Delete Booking
app.delete('/api/admin/bookings/:id', authenticateAdmin, (req, res) => {
  const { id } = req.params;

  db.run('DELETE FROM bookings WHERE id = ?', [id], function (err) {
    if (err) {
      return res.status(500).json({ message: 'Failed to delete booking', error: err.message });
    }
    if (this.changes === 0) {
      return res.status(404).json({ message: 'Booking not found' });
    }
    res.json({ message: 'Booking deleted successfully' });
  });
});

// 4. Manage Slots Configurations
app.get('/api/admin/slots', authenticateAdmin, (req, res) => {
  db.all('SELECT * FROM slots ORDER BY TIME(start_time) ASC', [], (err, rows) => {
    if (err) {
      return res.status(500).json({ message: 'Failed to retrieve slots template', error: err.message });
    }
    res.json(rows);
  });
});

app.post('/api/admin/slots', authenticateAdmin, (req, res) => {
  const { start_time, end_time, price, is_active, category } = req.body;

  if (!start_time || !end_time || price === undefined) {
    return res.status(400).json({ message: 'Required fields: start_time, end_time, price' });
  }

  // category is optional (NULL = "Uncategorized"), but if provided it
  // must be one of the known category IDs. Category is always set
  // manually by the admin -- it is never auto-derived from start_time.
  if (category !== undefined && category !== null && !isValidCategory(category)) {
    return res.status(400).json({ message: 'Invalid category value' });
  }

  db.run(
    'INSERT INTO slots (start_time, end_time, price, is_active, category) VALUES (?, ?, ?, ?, ?)',
    [start_time, end_time, price, is_active !== undefined ? is_active : 1, category ?? null],
    function (err) {
      if (err) {
        return res.status(500).json({ message: 'Failed to create slot template', error: err.message });
      }
      res.status(201).json({
        message: 'Slot template created successfully',
        slot_id: this.lastID
      });
    }
  );
});

app.put('/api/admin/slots/:id', authenticateAdmin, (req, res) => {
  const { id } = req.params;
  const { start_time, end_time, price, is_active, category } = req.body;

  // category is optional. If provided and not null, it must be valid.
  // Note: COALESCE(?, category) below means passing `null` explicitly
  // would NOT clear an existing category (COALESCE skips to the existing
  // column value on a NULL parameter) -- to genuinely clear a category
  // back to "Uncategorized", the frontend sends category_clear: true
  // instead, handled as a separate explicit UPDATE below.
  if (category !== undefined && category !== null && !isValidCategory(category)) {
    return res.status(400).json({ message: 'Invalid category value' });
  }

  const { category_clear } = req.body;

  db.run(
    `UPDATE slots 
     SET start_time = COALESCE(?, start_time), 
         end_time = COALESCE(?, end_time), 
         price = COALESCE(?, price), 
         is_active = COALESCE(?, is_active),
         category = ${category_clear ? 'NULL' : 'COALESCE(?, category)'}
     WHERE id = ?`,
    category_clear
      ? [start_time, end_time, price, is_active, id]
      : [start_time, end_time, price, is_active, category, id],
    function (err) {
      if (err) {
        return res.status(500).json({ message: 'Failed to update slot configuration', error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ message: 'Slot configuration not found' });
      }
      res.json({ message: 'Slot configuration updated successfully' });
    }
  );
});

app.delete('/api/admin/slots/:id', authenticateAdmin, (req, res) => {
  const { id } = req.params;

  db.run('DELETE FROM slots WHERE id = ?', [id], function (err) {
    if (err) {
      return res.status(500).json({ message: 'Failed to delete slot configuration', error: err.message });
    }
    if (this.changes === 0) {
      return res.status(404).json({ message: 'Slot configuration not found' });
    }
    res.json({ message: 'Slot configuration deleted successfully' });
  });
});

// 4b. Manage Recurring / Season Booking Templates

// List all recurring booking templates, optionally filtered by status
// (e.g. ?status=pending_approval doubles as the admin's approval inbox).
app.get('/api/admin/recurring-bookings', authenticateAdmin, (req, res) => {
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
        return res.status(500).json({ message: 'Failed to retrieve recurring bookings', error: err.message });
      }
      res.json(rows);
    });
  } else {
    db.all(`${baseQuery} ORDER BY rb.created_at DESC`, [], (err, rows) => {
      if (err) {
        return res.status(500).json({ message: 'Failed to retrieve recurring bookings', error: err.message });
      }
      res.json(rows);
    });
  }
});

// Update a recurring booking template's status (approve / pause / resume /
// cancel) or extend its end_date (e.g. admin manually renewing a season
// beyond the 3-month self-serve cap).
app.put('/api/admin/recurring-bookings/:id', authenticateAdmin, (req, res) => {
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
        return res.status(500).json({ message: 'Failed to update recurring booking', error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ message: 'Recurring booking not found' });
      }
      res.json({ message: 'Recurring booking updated successfully' });
    }
  );
});

// Hard delete a recurring booking template. Existing generated `bookings`
// rows are NOT deleted (their recurring_booking_id is set to NULL via the
// ON DELETE SET NULL foreign key) -- only future generation stops.
app.delete('/api/admin/recurring-bookings/:id', authenticateAdmin, (req, res) => {
  const { id } = req.params;

  db.run('DELETE FROM recurring_bookings WHERE id = ?', [id], function (err) {
    if (err) {
      return res.status(500).json({ message: 'Failed to delete recurring booking', error: err.message });
    }
    if (this.changes === 0) {
      return res.status(404).json({ message: 'Recurring booking not found' });
    }
    res.json({ message: 'Recurring booking deleted successfully' });
  });
});

// Manually trigger one generation pass (useful for admin testing/debugging
// without waiting for the daily interval).
app.post('/api/admin/recurring-bookings/run-now', authenticateAdmin, async (req, res) => {
  try {
    await recurringScheduler.runOnce();
    res.json({ message: 'Recurring booking generation pass completed' });
  } catch (err) {
    res.status(500).json({ message: 'Generation pass failed', error: err.message });
  }
});

// 5. Admin Dashboard Statistics
// Endpoint to manually trigger cleanup of expired holds (for admin use)
app.post('/api/admin/cleanup-holds', authenticateAdmin, (req, res) => {
  db.run('DELETE FROM slot_holds WHERE expires_at <= CURRENT_TIMESTAMP', [], function (err) {
    if (err) {
      return res.status(500).json({ message: 'Cleanup failed', error: err.message });
    }
    res.json({ message: 'Expired holds cleaned', rowsDeleted: this.changes });
  });
});
app.get('/api/admin/stats', authenticateAdmin, (req, res) => {
  const stats = {};

  // Query 1: Total Bookings by status
  db.all(
    `SELECT status, COUNT(*) as count FROM bookings GROUP BY status`,
    [],
    (err, statusCounts) => {
      if (err) return res.status(500).json({ message: 'Stats error', error: err.message });

      stats.bookings = {
        total: 0,
        pending: 0,
        approved: 0,
        cancelled: 0
      };

      statusCounts.forEach(row => {
        stats.bookings[row.status] = row.count;
        stats.bookings.total += row.count;
      });

      // Query 2: Revenue metrics (sum price of approved slots)
      db.get(
        `SELECT SUM(s.price) as total_revenue,
                SUM(CASE WHEN b.payment_status = 'paid' THEN s.price ELSE 0 END) as paid_revenue
         FROM bookings b
         JOIN slots s ON b.slot_id = s.id
         WHERE b.status = 'approved'`,
        [],
        (err, revRow) => {
          if (err) return res.status(500).json({ message: 'Stats error', error: err.message });

          stats.revenue = {
            total_approved: revRow.total_revenue || 0,
            total_paid: revRow.paid_revenue || 0,
            pending_payment: (revRow.total_revenue || 0) - (revRow.paid_revenue || 0)
          };

          // Query 3: Slot Popularity (Which hours booked most)
          db.all(
            `SELECT s.start_time, s.end_time, COUNT(*) as booking_count 
             FROM bookings b
             JOIN slots s ON b.slot_id = s.id
             WHERE b.status = 'approved'
             GROUP BY b.slot_id, s.start_time, s.end_time
             ORDER BY booking_count DESC
             LIMIT 5`,
            [],
            (err, popularSlots) => {
              if (err) return res.status(500).json({ message: 'Stats error', error: err.message });

              stats.popular_slots = popularSlots;

              // Query 4: Daily occupancy for the last 7 days
              db.all(
                `SELECT b.booking_date, COUNT(*) as count
                 FROM bookings b
                 WHERE b.status = 'approved'
                 GROUP BY b.booking_date
                 ORDER BY b.booking_date DESC
                 LIMIT 7`,
                [],
                (err, dailyCounts) => {
                  if (err) return res.status(500).json({ message: 'Stats error', error: err.message });

                  stats.recent_occupancy = dailyCounts;
                  res.json(stats);
                }
              );
            }
          );
        }
      );
    }
  );
});


// --- FUTURE PAYMENT GATEWAY INTEGRATION PLACEHOLDER ---
// Under normal circumstances, this endpoint would trigger checkout page for Bkash/SSLCommerz/Stripe
app.post('/api/payments/checkout', (req, res) => {
  const { booking_id, payment_method } = req.body;

  if (!booking_id || !payment_method) {
    return res.status(400).json({ message: 'Required fields: booking_id, payment_method' });
  }

  // 1. Fetch booking details to get the amount
  db.get(
    `SELECT b.*, s.price 
     FROM bookings b 
     JOIN slots s ON b.slot_id = s.id 
     WHERE b.id = ?`,
    [booking_id],
    (err, booking) => {
      if (err) {
        return res.status(500).json({ message: 'Database error', error: err.message });
      }
      if (!booking) {
        return res.status(404).json({ message: 'Booking not found' });
      }

      // Mock Transaction
      const mockTransactionId = 'TRX_MOCK_' + Math.random().toString(36).substring(2, 10).toUpperCase();

      // If SSLCommerz/Bkash/Stripe is integrated, you would make an API call to their server here
      // and send back a redirect URL (checkout URL) to the frontend.
      // For now, we mock the success response.
      res.json({
        message: 'Payment checkout initiated (MOCK)',
        booking_id: booking.id,
        amount: booking.price,
        payment_method,
        transaction_id: mockTransactionId,
        checkout_url: `http://localhost:${PORT}/api/payments/mock-redirect?trx_id=${mockTransactionId}&booking_id=${booking.id}`
      });
    }
  );
});

// Mock redirect endpoint that simulates payment processor approval redirection
app.get('/api/payments/mock-redirect', (req, res) => {
  const { trx_id, booking_id } = req.query;

  if (!booking_id) {
    return res.send('<h1>Error: Missing booking details</h1>');
  }

  // Update booking as approved and paid
  db.run(
    "UPDATE bookings SET status = 'approved', payment_status = 'paid' WHERE id = ?",
    [booking_id],
    (err) => {
      if (err) {
        return res.status(500).send('<h1>Database error during payment verification</h1>');
      }

      // Fetch full booking + slot details for the notification (the
      // UPDATE above only returns affected-row info, not the row itself).
      db.get(
        `SELECT b.*, s.start_time, s.end_time, s.price
         FROM bookings b
         JOIN slots s ON b.slot_id = s.id
         WHERE b.id = ?`,
        [booking_id],
        (fetchErr, fullBooking) => {
          if (!fetchErr && fullBooking) {
            notificationService.notifyPaymentReceived(fullBooking);
          }

          // In a real app, this redirects back to the Angular frontend success page
          res.send(`
            <div style="font-family: Arial, sans-serif; text-align: center; margin-top: 100px; padding: 20px;">
              <h1 style="color: #047857;">⚽ Payment Successful!</h1>
              <p style="font-size: 18px; color: #4b5563;">Your payment has been successfully processed.</p>
              <p><strong>Booking ID:</strong> ${booking_id}</p>
              <p><strong>Transaction ID:</strong> ${trx_id}</p>
              <p style="margin-top: 30px;">
                <a href="http://localhost:4200/" style="background-color: #10b981; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">Return to Turf Site</a>
              </p>
            </div>
          `);
        }
      );
    }
  );
});


// Catch-all: serve Angular index.html for any non-API route
// This enables Angular client-side routing to work correctly
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log(`Express server running on http://localhost:${PORT}`);
  recurringScheduler.start();
});
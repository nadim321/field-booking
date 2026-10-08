const db = require('../database');
const bookingService = require('../services/bookings/booking.service');
const { categoryLabel } = require('../constants/slot-categories');
const notificationService = require('../services/notifications/notification.service');

exports.result = (req, res) => {
  if (!db.cancellationReady) return res.status(503).json({ message: 'Booking maintenance in progress' });
  const { id } = req.params;

  db.get(
    `SELECT b.id, b.booking_date, b.status, b.payment_status, b.amount_paid,
            s.start_time, s.end_time, s.price, c.refund_amount, c.refunded_amount,
            EXISTS(SELECT 1 FROM payment_transactions WHERE booking_id = b.id AND status = 'valid') AS has_verified_payment,
            p.status AS attempt_status, p.terminal_verified, p.initialization_state
     FROM bookings b
     JOIN slots s ON b.slot_id = s.id
     LEFT JOIN booking_cancellations c ON c.booking_id = b.id
     LEFT JOIN payment_transactions p ON p.id = (SELECT MAX(id) FROM payment_transactions WHERE booking_id = b.id)
     WHERE b.id = ?`,
    [id],
    (err, booking) => {
      if (err) {
        return res.fail(err);
      }
      if (!booking) {
        return res.status(404).json({ message: 'Booking not found' });
      }

      const balanceDue = Math.max(parseFloat(booking.price) - parseFloat(booking.amount_paid || 0), 0);

      res.json({
        booking_id: booking.id,
        booking_date: booking.booking_date,
        start_time: booking.start_time,
        end_time: booking.end_time,
        price: booking.price,
        amount_paid: booking.amount_paid,
        balance_due: booking.status === 'cancelled' ? 0 : Math.round(balanceDue * 100) / 100,
        refund_amount: booking.refund_amount,
        refunded_amount: booking.refunded_amount,
        status: booking.status,
        payment_status: booking.payment_status,
        payment_attempt: {
          verified_payment: !!booking.has_verified_payment,
          state: booking.attempt_status === 'valid' ? 'paid' : booking.terminal_verified ? booking.attempt_status : booking.attempt_status ? 'pending' : 'none',
          verification_needed: booking.initialization_state === 'unknown'
        }
      });
    }
  );
};

exports.pdf = (req, res) => {
  const { id } = req.params;

  db.get(
    `SELECT b.*, s.start_time, s.end_time, s.price
     FROM bookings b
     JOIN slots s ON b.slot_id = s.id
     WHERE b.id = ?`,
    [id],
    async (err, booking) => {
      if (err) {
        return res.fail(err);
      }
      if (!booking) {
        return res.status(404).json({ message: 'Booking not found' });
      }

      try {
        const pdfService = require('../services/pdf/pdf.service');
        const pdfBuffer = await pdfService.generateBookingSlipPDF(booking);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=booking_slip_${id}.pdf`);
        res.send(pdfBuffer);
      } catch (pdfErr) {
        res.fail(pdfErr);
      }
    }
  );
};

exports.available = (req, res) => {
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
      return res.fail(err);
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
          return res.fail(err);
        }

        // Also fetch active holds for this date
        db.all(
          `SELECT slot_id FROM slot_holds WHERE booking_date = ? AND expires_at > CURRENT_TIMESTAMP`,
          [date],
          (err, holds) => {
            if (err) {
              return res.fail(err);
            }
            const heldSlotIds = holds.map(h => h.slot_id);

            // Fetch admin-created permanent blocks for this date.
            // These have the highest priority -- a slot blocked by the admin
            // is unavailable even if a season booking or hold also exists
            // for it. Blocks are set via POST /api/admin/slot-blocks/bulk.
            db.all(
              `SELECT slot_id, reason FROM slot_blocks WHERE block_date = ?`,
              [date],
              (err, adminBlocks) => {
                if (err) {
                  return res.fail(err);
                }
                const blockedSlotMap = {};
                adminBlocks.forEach(b => { blockedSlotMap[b.slot_id] = b.reason || 'Blocked'; });

                // Also fetch active recurring (season) booking templates whose
                // weekday matches this date and whose range covers it.
                const targetDayOfWeek = new Date(date + 'T00:00:00Z').getUTCDay();
                db.all(
                  `SELECT slot_id FROM recurring_bookings WHERE status = 'active' AND day_of_week = ? AND start_date <= ? AND end_date >= ?`,
                  [targetDayOfWeek, date, date],
                  (err, recurringTemplates) => {
                    if (err) {
                      return res.fail(err);
                    }
                    const seasonReservedSlotIds = recurringTemplates.map(rb => rb.slot_id);

                    // Map slot config and join bookings info
                    const result = visibleSlots.map(slot => {
                      const bookingForSlot = bookings.find(b => b.slot_id === slot.id);
                      const isAdminBlocked = slot.id in blockedSlotMap;
                      const isHeld = heldSlotIds.includes(slot.id);
                      const isSeasonReserved = seasonReservedSlotIds.includes(slot.id);

                      let status;
                      // Priority: admin block > booking > season reserved > held > available
                      if (isAdminBlocked) {
                        status = 'blocked';
                      } else if (bookingForSlot) {
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
                        block_reason: isAdminBlocked ? blockedSlotMap[slot.id] : null,
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
      }
    );
  });
};

exports.hold = async (req, res, next) => {
  try {
    const result = await bookingService.hold(req.body);
    
    res.status(200).json(result);
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Slot already booked' });
    next(error);
  }
};

exports.releaseHold = (req, res) => {
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
        return res.fail(err);
      }
      // Not finding a row to delete isn't an error from the client's point
      // of view -- the hold may have already expired or been confirmed.
      res.json({ message: 'Hold cancelled', deleted: this.changes > 0 });
    }
  );
};

exports.confirm = async (req, res, next) => {
  try {
    const result = await bookingService.confirm(req.body);
    notificationService.notifyBookingCreated({ id: result.booking_id, ...result.details, customer_email: req.body.customer_email });
    res.status(201).json(result);
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Slot already booked' });
    next(error);
  }
};

exports.create = async (req, res, next) => {
  try {
    const result = await bookingService.confirm(req.body, { requireHold: false });
    notificationService.notifyBookingCreated({ id: result.booking_id, ...result.details, customer_email: req.body.customer_email });
    res.status(201).json(result);
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Slot already booked' });
    next(error);
  }
};

const db = require('../database');
const notificationService = require('../services/notifications/notification.service');
const cancellationService = require('../services/bookings/cancellation.service');

function cancellationError(res, error) {
  if (!error.status || error.status >= 500) return res.fail(error);
  return res.status(error.status || 500).json({ message: error.status ? error.message : 'Could not complete cancellation/refund operation' });
}

exports.list = (req, res) => {
  if (!db.cancellationReady) return res.status(503).json({ message: 'Booking maintenance in progress' });
  db.all(
    `SELECT b.*, s.start_time, s.end_time, s.price, c.refund_amount, c.refunded_amount, c.source AS cancellation_source, c.reason AS cancellation_reason
     FROM bookings b
     JOIN slots s ON b.slot_id = s.id
     LEFT JOIN booking_cancellations c ON c.booking_id = b.id
     ORDER BY b.booking_date DESC, TIME(s.start_time) ASC`,
    [],
    (err, rows) => {
      if (err) {
        return res.fail(err);
      }
      res.json(rows);
    }
  );
};

exports.quote = async (req, res) => {
  try { res.json(await cancellationService.cancel(req.params.id, req.query.source || 'customer', '', req.user.id, true)); }
  catch (error) { cancellationError(res, error); }
};

exports.cancel = async (req, res) => {
  try {
    const result = await cancellationService.cancel(req.params.id, req.body.source, req.body.reason, req.user.id);
    if (result.booking) notificationService.notifyBookingCancelled({ ...result.booking, refund_amount: result.refund_amount });
    const { booking, ...response } = result;
    res.json(response);
  } catch (error) { cancellationError(res, error); }
};

exports.refund = async (req, res) => {
  try { res.json(await cancellationService.recordRefund(req.params.id, req.body.reference, req.body.amount, req.user.id)); }
  catch (error) { cancellationError(res, error); }
};

exports.update = (req, res) => {
  const { id } = req.params;
  const { status, payment_status } = req.body;

  if (status === 'cancelled') return res.status(400).json({ message: 'Use the cancellation workflow to calculate and record the refund.' });
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
        return res.fail(fetchErr);
      }

      if (!bookingBeforeUpdate) return res.status(404).json({ message: 'Booking not found' });
      if (bookingBeforeUpdate.status === 'cancelled') return res.status(409).json({ message: 'Cancelled bookings cannot be reopened or have payments edited.' });
      if (payment_status === 'paid') {
        updateFields.push('amount_paid = ?');
        params.splice(params.length - 1, 0, bookingBeforeUpdate.price);
      }
      db.run(
        `UPDATE bookings SET ${updateFields.join(', ')} WHERE id = ? AND status <> 'cancelled'`,
        params,
        function (err) {
          if (err) {
            return res.fail(err);
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
};

exports.remove = (req, res) => {
  const { id } = req.params;

  db.run("DELETE FROM bookings WHERE id = ? AND amount_paid = 0 AND payment_status = 'unpaid' AND NOT EXISTS (SELECT 1 FROM payment_transactions WHERE booking_id = ?) AND NOT EXISTS (SELECT 1 FROM booking_cancellations WHERE booking_id = ?)", [id, id, id], function (err) {
    if (err) {
      return res.fail(err);
    }
    if (this.changes === 0) {
      return res.status(409).json({ message: 'Booking not found or protected by payment/refund history. Cancel instead of deleting.' });
    }
    res.json({ message: 'Booking deleted successfully' });
  });
};

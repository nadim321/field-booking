const db = require('../../database');
const outbox = require('../notifications/outbox.service');
const { quoteCancellation } = require('./cancellation-policy');

function failure(message, status = 409) { return Object.assign(new Error(message), { status }); }
async function transaction(work) {
  if (!db.cancellationReady) throw failure('Booking maintenance in progress. Please retry shortly.', 503);
  const raw = await new Promise((resolve, reject) => db.getConnection((error, connection) => error ? reject(error) : resolve(connection)));
  const connection = raw.promise();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { raw.release(); }
}

async function getBooking(connection, id) {
  const [[booking]] = await connection.query(`SELECT b.*, s.start_time, s.end_time, b.booking_price AS price FROM bookings b
    JOIN slots s ON s.id = b.slot_id WHERE b.id = ? FOR UPDATE`, [id]);
  if (!booking) throw failure('Booking not found', 404);
  return booking;
}

async function cancel(id, source, reason, adminId, previewOnly = false) {
  if (!['customer', 'venue'].includes(source)) throw failure('Select customer or venue cancellation', 400);
  if (!previewOnly && (typeof reason !== 'string' || !reason.trim() || reason.length > 500)) throw failure('A cancellation reason (up to 500 characters) is required', 400);
  return transaction(async connection => {
    const booking = await getBooking(connection, id);
    const [[existing]] = await connection.query('SELECT * FROM booking_cancellations WHERE booking_id = ?', [id]);
    if (existing) return { cancellation: existing, already_cancelled: true };
    if (booking.status === 'cancelled') throw failure('Legacy cancellation: review refund manually before making changes');
    if (booking.recurring_booking_id) {
      const [[plan]] = await connection.query('SELECT status FROM recurring_bookings WHERE id = ? FOR UPDATE', [booking.recurring_booking_id]);
      if (plan?.status === 'active') throw failure('Pause or cancel the active season plan first, then cancel this individual booking.');
    }
    // Old admin "paid" flags sometimes have no corresponding received amount.
    if (booking.payment_status === 'paid' && Number(booking.amount_paid) <= 0) throw failure('Recorded paid amount is missing. Reconcile payment before cancellation.');
    const quote = quoteCancellation(booking, source);
    if (previewOnly) return quote;
    await connection.query(`INSERT INTO booking_cancellations
      (booking_id, policy_version, source, reason, refund_percent, amount_paid_at_cancellation, refund_amount, cancelled_by, cancelled_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
    [id, quote.policy_version, source, reason.trim(), quote.refund_percent, quote.amount_paid, quote.refund_amount, adminId]);
    await connection.query("UPDATE bookings SET status = 'cancelled' WHERE id = ?", [id]);
    await outbox.transition(connection, booking, { status: 'cancelled' });
    return { ...quote, booking_id: Number(id), refund_status: quote.refund_amount > 0 ? 'pending' : 'not_due', booking };
  });
}

async function recordRefund(id, reference, expectedAmount, adminId) {
  if (typeof reference !== 'string' || !reference.trim() || reference.length > 150) throw failure('Original payment refund reference is required (up to 150 characters)', 400);
  return transaction(async connection => {
    await getBooking(connection, id);
    const [[record]] = await connection.query('SELECT * FROM booking_cancellations WHERE booking_id = ? FOR UPDATE', [id]);
    if (!record) throw failure('No cancellation record found', 404);
    const amount = Math.round((Number(record.refund_amount) - Number(record.refunded_amount)) * 100) / 100;
    if (amount <= 0) return { message: 'No outstanding refund', amount: 0 };
    if (!Number.isFinite(Number(expectedAmount)) || Number(expectedAmount) !== amount) throw failure('Refund amount changed. Refresh and verify the amount actually returned before recording.');
    const [[used]] = await connection.query('SELECT id FROM refund_settlements WHERE reference = ?', [reference.trim()]);
    if (used) throw failure('This refund reference has already been recorded');
    await connection.query('INSERT INTO refund_settlements (booking_id, amount, reference, recorded_by) VALUES (?, ?, ?, ?)', [id, amount, reference.trim(), adminId]);
    await connection.query('UPDATE booking_cancellations SET refunded_amount = refund_amount WHERE booking_id = ?', [id]);
    return { message: 'Refund recorded; no money was transferred by this action', amount };
  });
}
async function creditValidatedPayment(transactionId, bookingId, validation, requiredAdvance) {
  return transaction(async connection => {
    const booking = await getBooking(connection, bookingId);
    const [[payment]] = await connection.query('SELECT * FROM payment_transactions WHERE id = ? FOR UPDATE', [transactionId]);
    if (!payment || payment.booking_id !== booking.id) throw failure('Payment does not belong to booking');
    if (payment.status === 'valid') return { ok: true, alreadyProcessed: true, bookingId: booking.id };
    const amount = Number(validation.amount);
    if (!Number.isFinite(amount) || amount <= 0 || Math.abs(Number(payment.amount) - amount) > 0.01 || payment.currency !== validation.currency || !['VALID', 'VALIDATED'].includes(validation.status)) throw failure('Payment validation mismatch');
    await require('../collections/collection.service').gateway(connection, booking, payment, validation);
    const newAmountPaid = Math.round((Number(booking.amount_paid || 0) + amount) * 100) / 100;
    const autoApproved = booking.status !== 'cancelled' && newAmountPaid >= requiredAdvance - 0.01;
    const paymentStatus = newAmountPaid >= Number(booking.price) - 0.01 ? 'paid' : 'partially_paid';
    await connection.query(`UPDATE payment_transactions SET status = 'valid', val_id = ?, card_type = ?, bank_tran_id = ? WHERE id = ?`,
      [validation.val_id, validation.card_type || null, validation.bank_tran_id || null, transactionId]);
    await connection.query(`UPDATE bookings SET amount_paid = ?, payment_status = ?, payment_method = 'sslcommerz', transaction_id = ?, status = ? WHERE id = ?`,
      [newAmountPaid, paymentStatus, validation.tran_id, autoApproved ? 'approved' : booking.status, booking.id]);
    if (autoApproved) await outbox.transition(connection, booking, { status: 'approved', amount_paid: newAmountPaid });
    if (booking.status === 'cancelled') {
      await connection.query(`INSERT INTO booking_cancellations
        (booking_id, policy_version, source, reason, refund_percent, amount_paid_at_cancellation, refund_amount, cancelled_by, cancelled_at)
        VALUES (?, 'legacy-goodwill', 'venue', 'Payment received after cancellation', 100, 0, ?, 0, UTC_TIMESTAMP())
        ON DUPLICATE KEY UPDATE refund_amount = refund_amount + VALUES(refund_amount)`, [booking.id, amount]);
    }
    return { ok: true, bookingId: booking.id, autoApproved, notifyBooking: autoApproved && booking.status !== 'approved' ? { ...booking, amount_paid: newAmountPaid } : null };
  });
}
module.exports = { transaction, getBooking, cancel, recordRefund, creditValidatedPayment };

const db = require('../database');
async function query(sql, params = []) {
  const connection = await db.promiseConnection();
  try { return await connection.query(sql, params); }
  finally { connection.release(); }
}

exports.list = async (req, res) => {
  const connection = await db.promiseConnection();
  try {
    const [bookings] = await connection.query(`SELECT b.id AS booking_id, b.booking_date, b.customer_name,
        b.team_name, b.status, b.payment_status, b.amount_paid, b.booking_price AS price,
        s.start_time, s.end_time, c.refund_amount, c.refunded_amount,
        (SELECT rp.status FROM refund_payouts rp WHERE rp.booking_id=b.id ORDER BY rp.id DESC LIMIT 1) AS refund_payout_status,
        (SELECT cr.status FROM customer_cancellation_requests cr WHERE cr.booking_id=b.id ORDER BY cr.id DESC LIMIT 1) AS cancellation_request_status
      FROM bookings b JOIN slots s ON s.id=b.slot_id
      LEFT JOIN booking_cancellations c ON c.booking_id=b.id
      WHERE b.customer_id=? ORDER BY b.booking_date DESC, s.start_time DESC`, [req.customer.id]);
    const [recurringBookings] = await connection.query(`SELECT rb.id, rb.start_date, rb.end_date, rb.day_of_week,
        rb.status, rb.team_name, s.start_time, s.end_time, s.price
      FROM recurring_bookings rb JOIN slots s ON s.id=rb.slot_id WHERE rb.customer_id=? ORDER BY rb.start_date DESC`, [req.customer.id]);
    res.set('Cache-Control', 'no-store').json({ bookings, recurring_bookings: recurringBookings });
  } finally { connection.release(); }
};

function failure(message, status = 400) { return Object.assign(new Error(message), { status }); }
function localNow() {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return { date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}` };
}

exports.requestCancellation = async (req, res) => {
  const id = Number(req.params.id), reason = String(req.body?.reason || '').trim();
  if (!Number.isSafeInteger(id) || id < 1) throw failure('Invalid booking ID');
  if (!reason || reason.length > 500) throw failure('Please enter a reason of at most 500 characters');
  const connection = await db.promiseConnection();
  try {
    await connection.beginTransaction();
    const [[booking]] = await connection.query(`SELECT b.id,b.status,b.booking_date,s.start_time FROM bookings b JOIN slots s ON s.id=b.slot_id
      WHERE b.id=? AND b.customer_id=? FOR UPDATE`, [id, req.customer.id]);
    if (!booking) throw failure('Booking not found', 404);
    if (booking.status === 'cancelled') throw failure('This booking is already cancelled', 409);
    const now = localNow();
    const date = String(booking.booking_date).slice(0, 10), time = String(booking.start_time).slice(0, 5);
    if (date < now.date || (date === now.date && time <= now.time)) throw failure('Cancellation requests are only available before the booking starts', 409);
    const [[existing]] = await connection.query(`SELECT id,status FROM customer_cancellation_requests WHERE booking_id=? AND status IN ('pending','reviewing') ORDER BY id DESC LIMIT 1`, [id]);
    if (existing) { await connection.commit(); return res.status(200).json({ id: existing.id, status: existing.status, already_pending: true }); }
    const [result] = await connection.query(`INSERT INTO customer_cancellation_requests (booking_id,customer_id,reason) VALUES (?,?,?)`, [id, req.customer.id, reason]);
    await connection.commit();
    res.status(201).json({ id: result.insertId, status: 'pending' });
  } catch (error) { try { await connection.rollback(); } catch { /* Transaction may not have started. */ } throw error; }
  finally { connection.release(); }
};

exports.cancellationRequests = async (req, res) => {
  const [rows] = await query(`SELECT id,booking_id,reason,status,review_note,created_at,reviewed_at
    FROM customer_cancellation_requests WHERE customer_id=? ORDER BY id DESC`, [req.customer.id]);
  res.set('Cache-Control', 'no-store').json(rows);
};

exports.adminCancellationRequests = async (req, res) => {
  if (!['admin','owner','manager'].includes(req.user.role)) throw failure('Owner or manager access required', 403);
  const [rows] = await query(`SELECT r.id,r.booking_id,r.customer_id,r.reason,r.status,r.review_note,r.created_at,
      b.booking_date,b.customer_name,b.customer_phone,s.start_time,s.end_time
    FROM customer_cancellation_requests r JOIN bookings b ON b.id=r.booking_id JOIN slots s ON s.id=b.slot_id
    ORDER BY CASE WHEN r.status='pending' THEN 0 WHEN r.status='reviewing' THEN 1 ELSE 2 END,r.id DESC LIMIT 200`);
  res.set('Cache-Control', 'no-store').json(rows);
};

exports.reviewCancellationRequest = async (req, res) => {
  if (!['admin','owner','manager'].includes(req.user.role)) throw failure('Owner or manager access required', 403);
  const id = Number(req.params.id), decision = req.body?.decision, note = String(req.body?.note || '').trim();
  if (!Number.isSafeInteger(id) || id < 1) throw failure('Invalid cancellation request ID');
  if (!['approve','reject'].includes(decision)) throw failure('Choose approve or reject');
  if (note.length > 500 || (decision === 'reject' && !note)) throw failure('Enter a rejection reason of at most 500 characters');
  if (decision === 'reject') {
    const [result] = await query(`UPDATE customer_cancellation_requests SET status='rejected',reviewed_by=?,review_note=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'`, [req.user.id,note,id]);
    if (!result.affectedRows) throw failure('Request not found or already reviewed', 409);
    return res.json({ id, status: 'rejected' });
  }
  const [claim] = await query(`UPDATE customer_cancellation_requests SET status='reviewing',reviewed_by=?,review_note=? WHERE id=? AND status IN ('pending','reviewing')`, [req.user.id,note,id]);
  if (!claim.affectedRows) throw failure('Request not found or already reviewed', 409);
  try {
    const [[request]] = await query('SELECT booking_id,reason FROM customer_cancellation_requests WHERE id=?', [id]);
    const result = await require('../services/bookings/cancellation.service').cancel(request.booking_id, 'customer', request.reason, req.user.id);
    if (result.booking) require('../services/notifications/notification.service').notifyBookingCancelled({ ...result.booking, refund_amount: result.refund_amount });
    await query(`UPDATE customer_cancellation_requests SET status='approved',reviewed_at=CURRENT_TIMESTAMP WHERE id=? AND status='reviewing'`, [id]);
    res.json({ id, status: 'approved', refund_amount: result.refund_amount });
  } catch (error) {
    await query(`UPDATE customer_cancellation_requests SET status='pending',reviewed_by=NULL,review_note=NULL WHERE id=? AND status='reviewing'`, [id]).catch(() => {});
    throw error;
  }
};

const db = require('../database');

exports.list = async (req, res) => {
  const connection = await db.promiseConnection();
  try {
    const [bookings] = await connection.query(`SELECT b.id AS booking_id, b.booking_date, b.customer_name,
        b.team_name, b.status, b.payment_status, b.amount_paid, b.booking_price AS price,
        s.start_time, s.end_time, c.refund_amount, c.refunded_amount,
        (SELECT rp.status FROM refund_payouts rp WHERE rp.booking_id=b.id ORDER BY rp.id DESC LIMIT 1) AS refund_payout_status
      FROM bookings b JOIN slots s ON s.id=b.slot_id
      LEFT JOIN booking_cancellations c ON c.booking_id=b.id
      WHERE b.customer_id=? ORDER BY b.booking_date DESC, s.start_time DESC`, [req.customer.id]);
    const [recurringBookings] = await connection.query(`SELECT rb.id, rb.start_date, rb.end_date, rb.day_of_week,
        rb.status, rb.team_name, s.start_time, s.end_time, s.price
      FROM recurring_bookings rb JOIN slots s ON s.id=rb.slot_id WHERE rb.customer_id=? ORDER BY rb.start_date DESC`, [req.customer.id]);
    res.set('Cache-Control', 'no-store').json({ bookings, recurring_bookings: recurringBookings });
  } finally { connection.release(); }
};

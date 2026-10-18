const db = require('../../database');

async function summary() {
  const connection = await db.promiseConnection();
  try {
    await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await connection.beginTransaction();
    const [statuses] = await connection.query('SELECT status, COUNT(*) AS count FROM bookings GROUP BY status');
    const bookings = { total: 0, pending: 0, approved: 0, cancelled: 0 };
    for (const row of statuses) { bookings[row.status] = Number(row.count); bookings.total += Number(row.count); }
    // DECIMAL arithmetic stays in MySQL; each booking contributes exactly once.
    const [[totals]] = await connection.query(`SELECT
      COALESCE(SUM(CASE WHEN status = 'approved' THEN booking_price ELSE 0 END), 0) AS approved_booking_value,
      COALESCE(SUM(amount_paid), 0) AS received_amount,
      COALESCE(SUM(CASE WHEN status = 'approved' THEN GREATEST(booking_price - amount_paid, 0) ELSE 0 END), 0) AS approved_outstanding,
      COALESCE(SUM(CASE WHEN status = 'pending' THEN GREATEST(booking_price - amount_paid, 0) ELSE 0 END), 0) AS pending_outstanding,
      COALESCE(SUM(price_source = 'legacy_estimate'), 0) AS legacy_estimate_count,
      COALESCE(SUM(payment_status = 'paid' AND amount_paid <= 0), 0) AS missing_paid_amount_count
      FROM bookings`);
    const [[refunds]] = await connection.query(`SELECT
      COALESCE((SELECT SUM(amount) FROM refund_settlements), 0) AS refunded_amount,
      COALESCE(SUM(GREATEST(c.refund_amount - COALESCE(r.returned, 0), 0)), 0) AS refund_outstanding
      FROM booking_cancellations c LEFT JOIN
      (SELECT booking_id, SUM(amount) AS returned FROM refund_settlements GROUP BY booking_id) r ON r.booking_id = c.booking_id`);
    const [[net]] = await connection.query(`SELECT
      COALESCE((SELECT SUM(amount_paid) FROM bookings), 0) -
      COALESCE((SELECT SUM(amount) FROM refund_settlements), 0) AS net_received`);
    const revenue = Object.fromEntries(Object.entries({ ...totals, ...refunds, ...net }).map(([key, value]) => [key, Number(value)]));
    // Compatibility aliases now use the corrected financial definitions.
    revenue.total_approved = revenue.approved_booking_value;
    revenue.total_paid = revenue.received_amount;
    revenue.pending_payment = revenue.approved_outstanding;
    const [popular_slots] = await connection.query(`SELECT s.start_time, s.end_time, COUNT(*) AS booking_count
      FROM bookings b JOIN slots s ON s.id = b.slot_id WHERE b.status = 'approved'
      GROUP BY b.slot_id, s.start_time, s.end_time ORDER BY booking_count DESC LIMIT 5`);
    const [recent_occupancy] = await connection.query(`SELECT booking_date, COUNT(*) AS count FROM bookings
      WHERE status = 'approved' GROUP BY booking_date ORDER BY booking_date DESC LIMIT 7`);
    await connection.commit();
    return { bookings, revenue, popular_slots, recent_occupancy };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}

module.exports = { summary };

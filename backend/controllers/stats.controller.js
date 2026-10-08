const db = require('../database');

exports.cleanup = (req, res) => {
  db.run('DELETE FROM slot_holds WHERE expires_at <= CURRENT_TIMESTAMP', [], function (err) {
    if (err) {
      return res.fail(err);
    }
    res.json({ message: 'Expired holds cleaned', rowsDeleted: this.changes });
  });
};

exports.summary = (req, res) => {
  const stats = {};

  // Query 1: Total Bookings by status
  db.all(
    `SELECT status, COUNT(*) as count FROM bookings GROUP BY status`,
    [],
    (err, statusCounts) => {
      if (err) return res.fail(err);

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
          if (err) return res.fail(err);

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
              if (err) return res.fail(err);

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
                  if (err) return res.fail(err);

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
};

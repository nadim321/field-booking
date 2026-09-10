// Additive, restart-safe migration. Existing bookings retain NULL policy acceptance.
module.exports = async function migrateCancellation(pool) {
  const connection = await pool.promise().getConnection();
  try {
    const [[lock]] = await connection.query("SELECT GET_LOCK('booking_cancellation_migration', 30) AS acquired");
    if (!lock.acquired) throw new Error('Could not lock cancellation migration');
    const [columns] = await connection.query('SHOW COLUMNS FROM bookings');
    const names = new Set(columns.map(column => column.Field));
    if (!names.has('cancellation_policy_version')) await connection.query('ALTER TABLE bookings ADD COLUMN cancellation_policy_version VARCHAR(40) NULL, ADD COLUMN policy_accepted_at DATETIME NULL');
    if (!names.has('active_booking_date')) await connection.query("ALTER TABLE bookings ADD COLUMN active_booking_date VARCHAR(50) GENERATED ALWAYS AS (CASE WHEN status <> 'cancelled' THEN booking_date ELSE NULL END) STORED");
    const [indexes] = await connection.query('SHOW INDEX FROM bookings');
    if (!indexes.some(index => index.Key_name === 'uq_active_slot_date')) await connection.query('ALTER TABLE bookings ADD UNIQUE KEY uq_active_slot_date (slot_id, active_booking_date)');
    if (indexes.some(index => index.Key_name === 'uq_slot_date')) await connection.query('ALTER TABLE bookings DROP INDEX uq_slot_date');
    await connection.query(`CREATE TABLE IF NOT EXISTS booking_cancellations (
      booking_id INT PRIMARY KEY,
      policy_version VARCHAR(40) NOT NULL,
      source VARCHAR(20) NOT NULL,
      reason VARCHAR(500) NOT NULL,
      refund_percent INT NOT NULL,
      amount_paid_at_cancellation DECIMAL(10,2) NOT NULL,
      refund_amount DECIMAL(10,2) NOT NULL,
      refunded_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
      cancelled_by INT NOT NULL,
      cancelled_at DATETIME NOT NULL,
      FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB`);
    await connection.query(`CREATE TABLE IF NOT EXISTS refund_settlements (
      id INT AUTO_INCREMENT PRIMARY KEY,
      booking_id INT NOT NULL,
      amount DECIMAL(10,2) NOT NULL,
      reference VARCHAR(150) NOT NULL UNIQUE,
      recorded_by INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (booking_id) REFERENCES booking_cancellations(booking_id) ON DELETE RESTRICT
    ) ENGINE=InnoDB`);
  } finally {
    await connection.query("SELECT RELEASE_LOCK('booking_cancellation_migration')");
    connection.release();
  }
};

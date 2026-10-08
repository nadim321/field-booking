exports.up = async connection => {
  const [columns] = await connection.query('SHOW COLUMNS FROM payment_transactions');
  const names = new Set(columns.map(column => column.Field));
  for (const [name, definition] of Object.entries({
    initialization_state: "VARCHAR(30) NOT NULL DEFAULT 'unknown'",
    gateway_url: 'TEXT NULL',
    gateway_session: 'VARCHAR(255) NULL',
    terminal_verified: 'BOOLEAN NOT NULL DEFAULT FALSE',
    started_at: 'DATETIME NULL'
  })) {
    if (!names.has(name)) await connection.query(`ALTER TABLE payment_transactions ADD COLUMN ${name} ${definition}`);
  }
  // Old failed/cancelled callbacks were not authenticated: do not backfill them as verified.
  await connection.query(`CREATE TABLE IF NOT EXISTS payment_attempt_keys (
    booking_id INT NOT NULL,
    request_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    payment_id INT NOT NULL,
    PRIMARY KEY (booking_id, request_key),
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
    FOREIGN KEY (payment_id) REFERENCES payment_transactions(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`);
};

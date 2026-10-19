exports.up = async connection => {
  const pg = connection.isPostgres === true;
  const engine = pg ? '' : ' ENGINE=InnoDB';
  const customerId = pg ? 'SERIAL' : 'INT AUTO_INCREMENT';
  const bigId = pg ? 'BIGSERIAL' : 'BIGINT UNSIGNED AUTO_INCREMENT';
  const timestamp = pg ? 'TIMESTAMP' : 'DATETIME';

  await connection.query(`CREATE TABLE IF NOT EXISTS customers (
    id ${customerId} PRIMARY KEY,
    phone_e164 VARCHAR(16) NOT NULL UNIQUE,
    created_at ${timestamp} NOT NULL DEFAULT CURRENT_TIMESTAMP
  )${engine}`);
  await connection.query(`CREATE TABLE IF NOT EXISTS customer_otp_challenges (
    id ${bigId} PRIMARY KEY,
    phone_e164 VARCHAR(16) NOT NULL,
    code_hash CHAR(64) NOT NULL,
    ip_hash CHAR(64) NOT NULL,
    attempts INT NOT NULL DEFAULT 0,
    created_at ${timestamp} NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at ${timestamp} NOT NULL,
    consumed_at ${timestamp} NULL
  )${engine}`);
  await connection.query(`CREATE TABLE IF NOT EXISTS refund_payouts (
    id ${bigId} PRIMARY KEY,
    booking_id INT NOT NULL,
    payment_transaction_id INT NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    refund_trans_id VARCHAR(30) NOT NULL UNIQUE,
    provider_ref VARCHAR(50) NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'pending',
    attempts INT NOT NULL DEFAULT 0,
    next_attempt_at ${timestamp} NOT NULL DEFAULT CURRENT_TIMESTAMP,
    lease_token VARCHAR(64) NULL,
    lease_until ${timestamp} NULL,
    last_error VARCHAR(100) NULL,
    created_at ${timestamp} NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at ${timestamp} NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_refund_payment UNIQUE (booking_id, payment_transaction_id),
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE RESTRICT,
    FOREIGN KEY (payment_transaction_id) REFERENCES payment_transactions(id) ON DELETE RESTRICT
  )${engine}`);

  for (const table of ['bookings', 'recurring_bookings']) {
    const [columns] = await connection.query('SHOW COLUMNS FROM ' + table);
    if (!columns.some(column => column.Field === 'customer_id')) {
      await connection.query(`ALTER TABLE ${table} ADD COLUMN customer_id INT NULL`);
    }
    if (pg) {
      await connection.query(`CREATE INDEX IF NOT EXISTS ix_${table}_customer ON ${table}(customer_id)`);
    } else {
      const [indexes] = await connection.query(`SHOW INDEX FROM ${table}`);
      if (!indexes.some(index => index.Key_name === `ix_${table}_customer`)) {
        await connection.query(`ALTER TABLE ${table} ADD INDEX ix_${table}_customer (customer_id)`);
      }
    }
  }

  if (pg) {
    await connection.query('CREATE INDEX IF NOT EXISTS ix_otp_phone_created ON customer_otp_challenges(phone_e164, created_at)');
    await connection.query('CREATE INDEX IF NOT EXISTS ix_otp_ip_created ON customer_otp_challenges(ip_hash, created_at)');
    await connection.query('CREATE INDEX IF NOT EXISTS ix_refund_payout_due ON refund_payouts(status, next_attempt_at)');
  } else {
    await connection.query('ALTER TABLE customer_otp_challenges ADD INDEX ix_otp_phone_created (phone_e164, created_at), ADD INDEX ix_otp_ip_created (ip_hash, created_at)');
    await connection.query('ALTER TABLE refund_payouts ADD INDEX ix_refund_payout_due (status, next_attempt_at)');
  }
};

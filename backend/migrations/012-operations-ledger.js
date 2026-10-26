exports.up = async c => {
  const pg = c.isPostgres === true;
  const engine = pg ? '' : ' ENGINE=InnoDB';
  const id = pg ? 'BIGSERIAL' : 'BIGINT UNSIGNED AUTO_INCREMENT';
  const timestamp = pg ? 'TIMESTAMP' : 'DATETIME';
  await c.query(`CREATE TABLE IF NOT EXISTS admin_audit_log (
    id ${id} PRIMARY KEY, actor_id INT NULL, actor_name VARCHAR(255) NOT NULL,
    action VARCHAR(80) NOT NULL, resource VARCHAR(255) NOT NULL, resource_id VARCHAR(100) NULL,
    http_method VARCHAR(10) NOT NULL, response_status INT NOT NULL,
    created_at ${timestamp} NOT NULL DEFAULT CURRENT_TIMESTAMP
  )${engine}`);
  await c.query(`CREATE TABLE IF NOT EXISTS venue_expenses (
    id ${id} PRIMARY KEY, expense_date DATE NOT NULL, category VARCHAR(80) NOT NULL,
    amount DECIMAL(10,2) NOT NULL, method VARCHAR(30) NOT NULL,
    reference VARCHAR(150) NULL, note VARCHAR(500) NOT NULL DEFAULT '',
    actor_id INT NULL, actor_name VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active', void_reason VARCHAR(500) NULL,
    created_at ${timestamp} NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at ${timestamp} NOT NULL DEFAULT CURRENT_TIMESTAMP
  )${engine}`);
  await c.query(`CREATE TABLE IF NOT EXISTS customer_cancellation_requests (
    id ${id} PRIMARY KEY, booking_id INT NOT NULL, customer_id INT NOT NULL,
    reason VARCHAR(500) NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'pending',
    reviewed_by INT NULL, review_note VARCHAR(500) NULL,
    created_at ${timestamp} NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at ${timestamp} NULL,
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE RESTRICT,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT
  )${engine}`);
  if (pg) {
    await c.query('CREATE INDEX IF NOT EXISTS ix_audit_created ON admin_audit_log(created_at,id)');
    await c.query('CREATE INDEX IF NOT EXISTS ix_expense_date_status ON venue_expenses(expense_date,status)');
    await c.query('CREATE INDEX IF NOT EXISTS ix_cancel_request_status ON customer_cancellation_requests(status,created_at)');
  } else {
    for (const [table, name, columns] of [
      ['admin_audit_log', 'ix_audit_created', 'created_at,id'],
      ['venue_expenses', 'ix_expense_date_status', 'expense_date,status'],
      ['customer_cancellation_requests', 'ix_cancel_request_status', 'status,created_at']
    ]) {
      const [indexes] = await c.query(`SHOW INDEX FROM ${table}`);
      if (!indexes.some(index => index.Key_name === name)) await c.query(`ALTER TABLE ${table} ADD INDEX ${name} (${columns})`);
    }
  }
};

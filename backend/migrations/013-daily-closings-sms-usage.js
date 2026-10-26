exports.up = async c => {
  const pg = c.isPostgres === true;
  const engine = pg ? '' : ' ENGINE=InnoDB';
  const id = pg ? 'BIGSERIAL' : 'BIGINT UNSIGNED AUTO_INCREMENT';
  const timestamp = pg ? 'TIMESTAMP' : 'DATETIME';

  // One row per submitted day-close. A correction supersedes the earlier row
  // (status='superseded', active_key=NULL); history is never overwritten.
  // active_key holds the date only for the active row, so UNIQUE allows exactly
  // one active closing per date on both MySQL and PostgreSQL (NULLs never clash).
  await c.query(`CREATE TABLE IF NOT EXISTS daily_closings (
    id ${id} PRIMARY KEY, close_date DATE NOT NULL,
    expected_cash DECIMAL(12,2) NOT NULL, counted_cash DECIMAL(12,2) NOT NULL,
    cash_refunds_paid DECIMAL(12,2) NOT NULL DEFAULT 0, variance DECIMAL(12,2) NOT NULL,
    note VARCHAR(500) NOT NULL DEFAULT '', status VARCHAR(20) NOT NULL DEFAULT 'active',
    active_key VARCHAR(10) NULL UNIQUE,
    actor_id INT NULL, actor_name VARCHAR(255) NOT NULL,
    created_at ${timestamp} NOT NULL DEFAULT CURRENT_TIMESTAMP
  )${engine}`);

  // One row per SMS handed to a provider (OTP or booking). unit_cost is an
  // estimate snapshot from SMS_UNIT_COST_BDT at send time, not a provider invoice.
  await c.query(`CREATE TABLE IF NOT EXISTS sms_usage_log (
    id ${id} PRIMARY KEY, purpose VARCHAR(20) NOT NULL, provider VARCHAR(30) NOT NULL,
    status VARCHAR(20) NOT NULL, units INT NOT NULL DEFAULT 1, unit_cost DECIMAL(10,4) NULL,
    provider_message_id VARCHAR(190) NULL, delivery_status VARCHAR(20) NULL,
    delivery_updated_at BIGINT NULL, job_id BIGINT NULL, created_at BIGINT NOT NULL
  )${engine}`);

  const [columns] = await c.query('SHOW COLUMNS FROM notification_jobs');
  const names = new Set(columns.map(x => x.Field));
  for (const [name, definition] of Object.entries({
    provider_message_id: 'VARCHAR(190) NULL',
    delivery_status: 'VARCHAR(20) NULL',
    delivery_updated_at: 'BIGINT NULL'
  })) if (!names.has(name)) await c.query(`ALTER TABLE notification_jobs ADD COLUMN ${name} ${definition}`);

  for (const [table, name, cols] of [
    ['daily_closings', 'ix_closing_date', 'close_date,id'],
    ['sms_usage_log', 'ix_sms_usage_created', 'created_at,id'],
    ['sms_usage_log', 'ix_sms_usage_message', 'provider_message_id'],
    ['notification_jobs', 'ix_notification_provider_message', 'provider_message_id']
  ]) {
    if (pg) {
      await c.query(`CREATE INDEX IF NOT EXISTS ${name} ON ${table}(${cols})`);
    } else {
      const [indexes] = await c.query(`SHOW INDEX FROM ${table}`);
      if (!indexes.some(index => index.Key_name === name)) await c.query(`ALTER TABLE ${table} ADD INDEX ${name} (${cols})`);
    }
  }
};

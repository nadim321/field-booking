exports.up = async c => {
  const [columns] = await c.query('SHOW COLUMNS FROM notification_jobs');
  const names = new Set(columns.map(x => x.Field));
  for (const [name, definition] of Object.entries({
    dispatch_key: "VARCHAR(64) NOT NULL DEFAULT 'automatic'",
    source_job_id: 'BIGINT UNSIGNED NULL', requested_by: 'INT NULL'
  })) if (!names.has(name)) await c.query(`ALTER TABLE notification_jobs ADD COLUMN ${name} ${definition}`);
  const [indexes] = await c.query('SHOW INDEX FROM notification_jobs');
  if (!indexes.some(x => x.Key_name === 'uq_notification_dispatch')) {
    await c.query('ALTER TABLE notification_jobs DROP INDEX uq_notification_event, ADD UNIQUE KEY uq_notification_dispatch (booking_id,event,version,dispatch_key), ADD KEY ix_notification_source (source_job_id,status)');
  }
  await c.query(`CREATE TABLE IF NOT EXISTS notification_resend_requests (
    request_key VARCHAR(64) PRIMARY KEY, source_job_id BIGINT UNSIGNED NOT NULL,
    job_id BIGINT UNSIGNED NOT NULL, actor_id INT NOT NULL, created_at BIGINT NOT NULL
  ) ENGINE=InnoDB`);
};

exports.up = async c => {
  const [columns] = await c.query('SHOW COLUMNS FROM bookings');
  const names = new Set(columns.map(x => x.Field));
  if (!names.has('notification_version')) await c.query('ALTER TABLE bookings ADD notification_version INT NOT NULL DEFAULT 0');
  if (!names.has('notification_initialized')) await c.query('ALTER TABLE bookings ADD notification_initialized TINYINT NOT NULL DEFAULT 0');
  await c.query(`CREATE TABLE IF NOT EXISTS notification_jobs (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    booking_id INT NOT NULL, event VARCHAR(30) NOT NULL, version INT NOT NULL,
    recipient VARCHAR(50) NOT NULL, message TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'queued', scheduled_at BIGINT NOT NULL,
    next_attempt_at BIGINT NOT NULL, kickoff_at BIGINT NULL,
    attempts INT NOT NULL DEFAULT 0, cycle_attempts INT NOT NULL DEFAULT 0,
    lease_token CHAR(36) NULL, lease_until BIGINT NULL,
    last_error VARCHAR(100) NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
    UNIQUE KEY uq_notification_event (booking_id,event,version),
    KEY ix_notification_due (status,next_attempt_at), KEY ix_notification_booking (booking_id,id)
  ) ENGINE=InnoDB`);
  // Booking IDs deliberately have no cascade: audit survives permitted booking deletion.
  await c.query(`CREATE TABLE IF NOT EXISTS notification_attempts (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, job_id BIGINT UNSIGNED NOT NULL,
    attempt_number INT NOT NULL, outcome VARCHAR(30) NOT NULL,
    started_at BIGINT NOT NULL, finished_at BIGINT NULL, error_code VARCHAR(100) NULL,
    message TEXT NULL, actor_id INT NULL, lease_token CHAR(36) NULL,
    KEY ix_notification_attempt (job_id,id), FOREIGN KEY (job_id) REFERENCES notification_jobs(id) ON DELETE RESTRICT
  ) ENGINE=InnoDB`);
};

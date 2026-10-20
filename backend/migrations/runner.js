const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const migrations = ['001-initial-schema.js', '002-cancellation.js', '003-payment-attempts.js', '004-booking-prices.js', '005-venue-branding.js', '006-notifications.js', '007-notification-resend.js', '008-collections.js', '009-booking-search.js', '010-customers-and-refunds.js', '011-admin-auth-version.js'];
function checksum(file) { return createHash('sha256').update(fs.readFileSync(path.join(__dirname, file))).digest('hex'); }
const postgres = require('../database/postgres');
const isPostgres = connection => connection?.isPostgres === true;
async function run(pool) {
  const connection = await pool.promise().getConnection();
  let locked = false;
  try {
    if (isPostgres(connection)) {
      await connection.query("SELECT pg_advisory_lock(hashtext(current_database() || ':migrations'))");
      locked = true;
    } else {
      const [[lock]] = await connection.query("SELECT GET_LOCK(CONCAT(DATABASE(), ':migrations'), 30) AS acquired");
      if (!lock.acquired) throw new Error('Migration lock unavailable');
      locked = true;
    }
    const migrationTable = `CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(100) PRIMARY KEY, checksum CHAR(64) NOT NULL, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )${isPostgres(connection) ? '' : ' ENGINE=InnoDB'}`;
    await connection.query(isPostgres(connection) ? postgres.migrationSql(migrationTable) : migrationTable);
    const [applied] = await connection.query('SELECT name, checksum FROM schema_migrations');
    for (const file of migrations) {
      const existing = applied.find(row => row.name === file);
      const hash = checksum(file);
      if (existing) {
        if (existing.checksum !== hash) throw new Error(`Applied migration changed: ${file}. Add a new migration instead.`);
        continue;
      }
      // MySQL DDL auto-commits. Each migration is restart-safe; record it only
      // after every statement succeeds, and never claim transactional rollback.
      await require(path.join(__dirname, file)).up(connection);
      await connection.query('INSERT INTO schema_migrations (name, checksum) VALUES (?, ?)', [file, hash]);
    }
  } finally {
      try {
        if (locked) await connection.query(isPostgres(connection)
          ? "SELECT pg_advisory_unlock(hashtext(current_database() || ':migrations'))"
          : "SELECT RELEASE_LOCK(CONCAT(DATABASE(), ':migrations'))");
      }
    finally { connection.release(); }
  }
}
async function assertCurrent(pool) {
  const [rows] = await pool.promise().query('SELECT name, checksum FROM schema_migrations');
  for (const file of migrations) if (!rows.some(row => row.name === file && row.checksum === checksum(file))) throw new Error(`Pending or modified migration: ${file}`);
}
module.exports = { run, assertCurrent, migrations };

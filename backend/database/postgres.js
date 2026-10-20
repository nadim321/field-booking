const { Pool } = require('pg');

const ID_TABLES = new Set([
  'users', 'slots', 'slot_holds', 'recurring_bookings', 'bookings', 'payment_transactions',
  'slot_blocks', 'refund_settlements', 'notification_jobs', 'notification_attempts', 'booking_collections',
  'customers', 'customer_otp_challenges', 'refund_payouts'
]);

function placeholders(sql, values) {
  let index = 0;
  const expanded = [];
  const text = sql.replace(/\?/g, () => {
    const value = values[index++];
    if (Array.isArray(value)) {
      if (!value.length) return 'NULL';
      const first = expanded.length + 1;
      expanded.push(...value);
      return value.map((_, offset) => `$${first + offset}`).join(', ');
    }
    expanded.push(value);
    return `$${expanded.length}`;
  });
  return { text, values: expanded };
}

function translate(sql, values = []) {
  let text = String(sql);
  if (/ON DUPLICATE KEY UPDATE\s+setting_value\s*=\s*\?/i.test(text)) values = values.slice(0, -1);
  const ignore = /^\s*INSERT\s+IGNORE\b/i.test(text);
  text = text.replace(/\bINSERT\s+IGNORE\b/i, 'INSERT')
    .replace(/\s+ON DUPLICATE KEY UPDATE\s+setting_value\s*=\s*VALUES\(setting_value\)\s*;?$/i, ' ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value')
    .replace(/\s+ON DUPLICATE KEY UPDATE\s+setting_value\s*=\s*\?\s*;?$/i, ' ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value')
    .replace(/\s+ON DUPLICATE KEY UPDATE\s+refund_amount\s*=\s*refund_amount\s*\+\s*VALUES\(refund_amount\)\s*;?$/i, ' ON CONFLICT (booking_id) DO UPDATE SET refund_amount = booking_cancellations.refund_amount + EXCLUDED.refund_amount')
    .replace(/\s+ON DUPLICATE KEY UPDATE\s+id\s*=\s*id\s*;?$/i, ' ON CONFLICT DO NOTHING')
    .replace(/\s+ON DUPLICATE KEY UPDATE\s+legacy_booking_id\s*=\s*VALUES\(legacy_booking_id\)\s*;?$/i, ' ON CONFLICT (legacy_booking_id) DO NOTHING');
  text = text.replace(/TIMESTAMPDIFF\(MICROSECOND,\s*CURRENT_TIMESTAMP\(6\),\s*([\w.]+)\)\s*\/\s*1000000/gi, 'EXTRACT(EPOCH FROM ($1 - CURRENT_TIMESTAMP))')
    .replace(/TIMESTAMPDIFF\(SECOND,\s*([\w.]+),\s*UTC_TIMESTAMP\(\)\)/gi, 'EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - $1))')
    .replace(/UNIX_TIMESTAMP\(CURRENT_TIMESTAMP\(3\)\)/gi, 'EXTRACT(EPOCH FROM CURRENT_TIMESTAMP)')
    .replace(/\bTIME\(([^()]+)\)/gi, '($1)::time')
    .replace(/\bGROUP_CONCAT\(DISTINCT\s+([^\s)]+)\s+ORDER BY\s+([^\s)]+)\s+SEPARATOR\s+'([^']*)'\)/gi, "STRING_AGG(DISTINCT $1, '$3' ORDER BY $2)")
    .replace(/\bDATE_FORMAT\(\s*([\w.]+)\s*,\s*'%Y-%m-%d'\s*\)/gi, "TO_CHAR($1, 'YYYY-MM-DD')")
    .replace(/\bUTC_TIMESTAMP\(\s*\)/gi, 'CURRENT_TIMESTAMP')
    .replace(/\bUNIX_TIMESTAMP\(([^()]+)\)/gi, "EXTRACT(EPOCH FROM $1)")
    .replace(/\bDATE_ADD\(CURRENT_TIMESTAMP,\s*INTERVAL\s+(\?)\s+(MINUTE|HOUR|DAY)\)/gi, "(CURRENT_TIMESTAMP + ($1 * INTERVAL '1 $2'))")
    .replace(/\bDATE_SUB\(CURRENT_TIMESTAMP,\s*INTERVAL\s+(\d+)\s+(MINUTE|HOUR|DAY)\)/gi, "(CURRENT_TIMESTAMP - INTERVAL '$1 $2')")
    .replace(/\bLOCATE\(LOWER\((\?)\),\s*LOWER\(([^()]*(?:\([^()]*\)[^()]*)*)\)\)/gi, 'POSITION(LOWER($1) IN LOWER($2))');
  const bound = placeholders(text, values);
  text = bound.text;
  if (ignore && !/\bON CONFLICT\b/i.test(text)) text = `${text.replace(/;\s*$/, '')} ON CONFLICT DO NOTHING`;
  return { text, values: bound.values };
}

function migrationSql(sql) {
  let text = String(sql).replace(/\s+ENGINE\s*=\s*InnoDB/gi, '')
    .replace(/,\s*(?:KEY|INDEX)\s+[\w]+\s*\([^)]+\)/gi, '')
    .replace(/\bBIGINT\s+UNSIGNED\s+AUTO_INCREMENT\s+PRIMARY KEY\b/gi, 'BIGSERIAL PRIMARY KEY')
    .replace(/\bINT\s+AUTO_INCREMENT\s+PRIMARY KEY\b/gi, 'SERIAL PRIMARY KEY')
    .replace(/\bBIGINT\s+UNSIGNED\b/gi, 'BIGINT')
    .replace(/\bINT\s+UNSIGNED\b/gi, 'INTEGER')
    .replace(/\bTINYINT\b/gi, 'SMALLINT')
    .replace(/\bDATETIME\b/gi, 'TIMESTAMP')
    .replace(/\s+CHARACTER SET\s+ascii/gi, '')
    .replace(/\s+COLLATE\s+ascii_bin/gi, '')
    .replace(/\bUNIQUE KEY\s+([\w]+)\s*\(/gi, 'CONSTRAINT $1 UNIQUE (')
    .replace(/\bMODIFY\s+([\w]+)\s+(DECIMAL\([^)]+\)|VARCHAR\([^)]+\)|TEXT|INT|BIGINT)(?:\s+(NOT NULL|NULL))?/gi, (_, col, type, nullable) => `ALTER COLUMN ${col} TYPE ${type}${nullable?.toUpperCase() === 'NOT NULL' ? `, ALTER COLUMN ${col} SET NOT NULL` : ''}`)
    .replace(/\bADD UNIQUE KEY\s+([\w]+)\s*\(([^)]+)\)/gi, 'ADD CONSTRAINT $1 UNIQUE ($2)')
    .replace(/\bSHOW COLUMNS FROM\s+(\w+)/i, "SELECT column_name AS \"Field\" FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '$1'")
    .replace(/\bSHOW INDEX FROM\s+(\w+)/i, "SELECT indexname AS \"Key_name\" FROM pg_indexes WHERE schemaname = current_schema() AND tablename = '$1'")
    .replace(/\bALTER TABLE\s+(\w+)\s+DROP INDEX\s+(\w+)/i, 'ALTER TABLE $1 DROP CONSTRAINT IF EXISTS $2');
  text = text.replace(/ALTER TABLE\s+(\w+)\s+ADD INDEX\s+(\w+)\s*\(([^)]+)\)/i, 'CREATE INDEX IF NOT EXISTS $2 ON $1 ($3)');
  text = text.replace(/UPDATE\s+bookings\s+b\s+JOIN\s+slots\s+s\s+ON\s+s\.id\s*=\s*b\.slot_id\s+SET\s+b\.booking_price\s*=\s*s\.price,\s*b\.price_source\s*=\s*'legacy_estimate'\s+WHERE\s+b\.booking_price\s+IS\s+NULL/i,
    "UPDATE bookings AS b SET booking_price = s.price, price_source = 'legacy_estimate' FROM slots AS s WHERE s.id = b.slot_id AND b.booking_price IS NULL");
  return text;
}

function isRead(sql) { return /^\s*(SELECT|WITH|SHOW)\b/i.test(sql); }
function wrapConnection(client, poolClient = false) {
  const connection = {
    isPostgres: true,
    promise() { return connection; },
    connection: { query(sql, values) { return { stream: () => { throw new Error('PostgreSQL query streaming is not configured'); } }; } },
    async query(sql, values = [], callback) {
      if (typeof values === 'function') { callback = values; values = []; }
      try {
        const result = await run(client, sql, values);
        if (callback) return callback(null, result[0], result[1]);
        return result;
      } catch (error) {
        if (callback) return callback(error);
        throw error;
      }
    },
    async beginTransaction() { await client.query('BEGIN'); },
    async commit() { await client.query('COMMIT'); },
    async rollback() { await client.query('ROLLBACK'); },
    release() { if (poolClient) client.release(); }
  };
  return connection;
}
async function run(client, sql, values = []) {
  if (/^\s*ALTER TABLE notification_jobs DROP INDEX uq_notification_event, ADD UNIQUE KEY uq_notification_dispatch \(booking_id,event,version,dispatch_key\), ADD KEY ix_notification_source \(source_job_id,status\)\s*;?$/i.test(String(sql))
      || /^\s*ALTER TABLE notification_jobs DROP INDEX uq_notification_event, ADD UNIQUE KEY uq_notification_dispatch \(booking_id,event,version,dispatch_key\), ADD KEY ix_notification_source \(source_job_id,status\)\s*;?$/i.test(migrationSql(sql))) {
    await client.query('ALTER TABLE notification_jobs DROP CONSTRAINT IF EXISTS uq_notification_event');
    await client.query('ALTER TABLE notification_jobs ADD CONSTRAINT uq_notification_dispatch UNIQUE (booking_id,event,version,dispatch_key)');
    return [await client.query('CREATE INDEX IF NOT EXISTS ix_notification_source ON notification_jobs (source_job_id,status)'), []];
  }
  const sourceSql = String(sql);
  const table = /^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i.exec(sourceSql)?.[1];
  const indexes = table ? [...sourceSql.matchAll(/,\s*(?:KEY|INDEX)\s+(\w+)\s*\(([^)]+)\)/gi)] : [];
  const prepared = migrationSql(sourceSql);
  const transformed = translate(prepared, values);
  let text = transformed.text;
  const insert = /^\s*INSERT\s+INTO\s+(\w+)/i.exec(text);
  if (insert && ID_TABLES.has(insert[1].toLowerCase()) && !/\bRETURNING\b/i.test(text)) text = `${text.replace(/;\s*$/, '')} RETURNING id`;
  const result = await client.query(text, transformed.values);
  for (const [, name, columns] of indexes) await client.query(`CREATE INDEX IF NOT EXISTS ${name} ON ${table} (${columns})`);
  if (isRead(sql)) return [result.rows, result.fields];
  const insertedId = result.rows[0]?.id;
  return [{ insertId: insertedId, lastID: insertedId, affectedRows: result.rowCount, changes: result.rowCount, rowCount: result.rowCount }, result.fields];
}

function createPool(config) {
  const poolConfig = config.connectionString
    ? { connectionString: config.connectionString }
    : { host: config.host, port: config.port, user: config.user, password: config.password, database: config.database };
  const pool = new Pool({ ...poolConfig, max: config.max || 10, connectionTimeoutMillis: 10000, ssl: config.ssl ? { rejectUnauthorized: false } : undefined });
  return {
    promise() { return this; },
    getConnection(callback) {
      const promise = pool.connect().then(client => wrapConnection(client, true));
      if (callback) promise.then(connection => callback(null, connection), callback);
      return promise;
    },
    query(sql, values, callback) {
      if (typeof values === 'function') { callback = values; values = []; }
      const promise = run(pool, sql, values);
      if (callback) promise.then(([result]) => callback(null, result), callback);
      return { then: promise.then.bind(promise), catch: promise.catch.bind(promise), finally: promise.finally.bind(promise) };
    },
    async end() { await pool.end(); },
    _pool: pool
  };
}
module.exports = { createPool, wrapConnection, translate, migrationSql };

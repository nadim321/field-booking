const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');
const { Pool } = require('pg');
const config = require('../config/env');
const migrationRunner = require('../migrations/runner');

const TABLES = [
  'users', 'slots', 'app_settings', 'recurring_bookings', 'bookings', 'slot_holds', 'slot_blocks',
  'payment_transactions', 'booking_cancellations', 'refund_settlements', 'payment_attempt_keys',
  'venue_media', 'notification_jobs', 'notification_attempts', 'notification_resend_requests',
  'booking_collections', 'collection_requests'
];
const ORDER_COLUMNS = {
  users: ['id'], slots: ['id'], app_settings: ['setting_key'], recurring_bookings: ['id'],
  bookings: ['id'], slot_holds: ['id'], slot_blocks: ['id'], payment_transactions: ['id'],
  booking_cancellations: ['booking_id'], refund_settlements: ['id'],
  payment_attempt_keys: ['booking_id', 'request_key'], venue_media: ['id'], notification_jobs: ['id'],
  notification_attempts: ['id'], notification_resend_requests: ['request_key'],
  booking_collections: ['id'], collection_requests: ['request_key']
};
const SEQUENCE_TABLES = [
  'users', 'slots', 'recurring_bookings', 'bookings', 'slot_holds', 'slot_blocks', 'payment_transactions',
  'refund_settlements', 'notification_jobs', 'notification_attempts', 'booking_collections'
];
const PAGE_SIZE = 200;
const INSERT_BATCH_SIZE = 100;
const MEDIA_PATTERN = /^[a-f0-9-]{36}\.(png|webp)$/;

function parseMode(args) {
  const dryRun = args.includes('--dry-run');
  const apply = args.includes('--apply');
  if (dryRun === apply) throw new Error('Choose exactly one mode: --dry-run or --apply');
  if (apply && (!args.includes('--confirm-writes-paused') || !args.includes('--backup-verified'))) {
    throw new Error('--apply requires --confirm-writes-paused and --backup-verified');
  }
  return { apply };
}

function quoteMySqlIdentifier(identifier) {
  if (!/^[a-z_][a-z0-9_]*$/.test(identifier)) {
    throw new Error('Unexpected database identifier');
  }
  return `\`${identifier}\``;
}

function quotePgIdentifier(identifier) {
  if (!/^[a-z_][a-z0-9_]*$/.test(identifier)) {
    throw new Error('Unexpected database identifier');
  }
  return `"${identifier}"`;
}

function resultRows(result, dialect) {
  return dialect === 'mysql' ? result[0] : result.rows;
}

function insertSql(table, columns, rowOffset = 0) {
  const tableName = quotePgIdentifier(table);
  const names = columns.map(quotePgIdentifier).join(', ');
  const values = columns.map((_, index) => `$${rowOffset + index + 1}`).join(', ');
  const upsert = table === 'app_settings'
    ? ' ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value'
    : '';
  return `INSERT INTO public.${tableName} (${names}) VALUES (${values})${upsert}`;
}

async function tableNames(connection, dialect) {
  const sql = dialect === 'mysql'
    ? "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'"
    : "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'";
  const result = dialect === 'mysql' ? await connection.query(sql) : await connection.query(sql);
  return new Set(resultRows(result, dialect).map(row => row.table_name));
}

async function migrationNames(connection, dialect) {
  try {
    const result = await connection.query(dialect === 'mysql'
      ? 'SELECT name FROM schema_migrations'
      : 'SELECT name FROM public.schema_migrations');
    return new Set(resultRows(result, dialect).map(row => row.name));
  } catch {
    return new Set();
  }
}

function requireCurrentMigrations(names, dialect) {
  const missing = migrationRunner.migrations.filter(name => !names.has(name));
  if (missing.length) {
    throw new Error(`${dialect} schema is behind; missing migrations: ${missing.join(', ')}. Back up the source, run the app migrations, then retry.`);
  }
}

async function countRows(connection, dialect, table) {
  const name = dialect === 'mysql' ? quoteMySqlIdentifier(table) : `public.${quotePgIdentifier(table)}`;
  const result = await connection.query(`SELECT COUNT(*) AS total FROM ${name}`);
  return Number(resultRows(result, dialect)[0].total);
}

async function mediaRows(connection) {
  const result = await connection.query('SELECT filename FROM venue_media ORDER BY id');
  return resultRows(result, 'mysql').map(row => row.filename);
}

async function sha256(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of require('node:fs').createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function prepareMedia(files, sourceDir, targetDir) {
  if (!files.length) return { copied: [], createdDirectory: false };
  if (!sourceDir) throw new Error('Source venue media exists; set SOURCE_MEDIA_DIR to its persistent media directory before importing.');
  if (!targetDir || !path.isAbsolute(targetDir)) throw new Error('Set MEDIA_DIR to the absolute persistent media directory for the target service.');
  const checked = [];
  for (const filename of files) {
    if (!MEDIA_PATTERN.test(filename)) throw new Error('Source contains an invalid venue media filename.');
    const source = path.join(sourceDir, filename);
    const stat = await fs.lstat(source);
    if (!stat.isFile()) throw new Error(`Venue media is not a regular file: ${filename}`);
    checked.push({ filename, source, hash: await sha256(source) });
  }
  let createdDirectory = false;
  try { await fs.mkdir(targetDir, { recursive: true, mode: 0o750 }); }
  catch (error) { throw error; }
  const copied = [];
  try {
    for (const file of checked) {
      const target = path.join(targetDir, file.filename);
      try {
        await fs.copyFile(file.source, target, require('node:fs').constants.COPYFILE_EXCL);
        copied.push(target);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (await sha256(target) !== file.hash) throw new Error(`Target media file already exists with different content: ${file.filename}`);
      }
    }
  } catch (error) {
    await Promise.all(copied.map(file => fs.rm(file, { force: true })));
    if (createdDirectory) await fs.rmdir(targetDir).catch(() => {});
    throw error;
  }
  return { copied, createdDirectory };
}

async function copyTable(source, target, table, expectedCount) {
  const order = ORDER_COLUMNS[table].map(quoteMySqlIdentifier).join(', ');
  let offset = 0;
  let copied = 0;
  while (offset < expectedCount) {
    const [rows] = await source.query(`SELECT * FROM ${quoteMySqlIdentifier(table)} ORDER BY ${order} LIMIT ? OFFSET ?`, [PAGE_SIZE, offset]);
    if (!rows.length) break;
    for (let start = 0; start < rows.length; start += INSERT_BATCH_SIZE) {
      const batch = rows.slice(start, start + INSERT_BATCH_SIZE);
      const columns = Object.keys(batch[0]);
      const values = [];
      const valueGroups = batch.map(row => {
        const group = `(${columns.map((column, index) => {
          values.push(row[column]);
          return `$${values.length}`;
        }).join(', ')})`;
        return group;
      });
      const baseSql = insertSql(table, columns);
      const suffix = table === 'app_settings'
        ? ' ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value'
        : '';
      await target.query(`${baseSql.slice(0, baseSql.lastIndexOf(' VALUES '))} VALUES ${valueGroups.join(', ')}${suffix}`, values);
      copied += batch.length;
    }
    offset += rows.length;
  }
  if (copied !== expectedCount) throw new Error(`Source changed during copy of ${table}; expected ${expectedCount}, copied ${copied}.`);
  return copied;
}

async function setSequences(target) {
  for (const table of SEQUENCE_TABLES) {
    await target.query(`SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM public.${quotePgIdentifier(table)}`, [`public.${table}`]);
  }
}

async function inspect(source, target) {
  const [sourceTables, targetTables, sourceMigrations, targetMigrations] = await Promise.all([
    tableNames(source, 'mysql'), tableNames(target, 'postgres'), migrationNames(source, 'mysql'), migrationNames(target, 'postgres')
  ]);
  const missingSource = TABLES.filter(table => !sourceTables.has(table));
  const missingTarget = [...TABLES, 'schema_migrations'].filter(table => !targetTables.has(table));
  if (missingSource.length) throw new Error(`Source MySQL is missing tables: ${missingSource.join(', ')}`);
  if (missingTarget.length) throw new Error(`Target PostgreSQL is missing tables: ${missingTarget.join(', ')}. Deploy the PostgreSQL app/migrations first.`);
  requireCurrentMigrations(sourceMigrations, 'Source MySQL');
  requireCurrentMigrations(targetMigrations, 'Target PostgreSQL');

  const [sourceCounts, targetCounts] = await Promise.all([
    Promise.all(TABLES.map(async table => [table, await countRows(source, 'mysql', table)])),
    Promise.all(TABLES.map(async table => [table, await countRows(target, 'postgres', table)]))
  ]);
  const sourceMap = Object.fromEntries(sourceCounts);
  const targetMap = Object.fromEntries(targetCounts);
  const settings = await target.query("SELECT setting_key, setting_value FROM public.app_settings WHERE setting_key <> 'branding_lock'");
  const targetSettings = settings.rows;
  const targetDefault = await target.query("SELECT setting_key, setting_value FROM public.app_settings WHERE setting_key = 'branding_lock'");
  const allowedDefault = targetDefault.rows.length <= 1 && (!targetDefault.rows.length || targetDefault.rows[0].setting_value === '1');
  const sourceBrandingLock = await source.query("SELECT setting_key FROM app_settings WHERE setting_key = 'branding_lock'");
  const hasSourceBrandingLock = resultRows(sourceBrandingLock, 'mysql').length > 0;
  const occupied = TABLES.filter(table => table !== 'app_settings' && targetMap[table] > 0);
  if (targetSettings.length || !allowedDefault || occupied.length) {
    throw new Error(`Target PostgreSQL contains application data; refusing to merge. Non-empty tables: ${[...occupied, ...(targetSettings.length || !allowedDefault ? ['app_settings'] : [])].join(', ')}`);
  }
  return { source: sourceMap, target: targetMap, hasSourceBrandingLock };
}

async function transfer({ source, target, apply, sourceMediaDir, targetMediaDir }) {
  const counts = await inspect(source, target);
  const media = counts.source.venue_media ? await mediaRows(source) : [];
  if (!apply) return { counts, mediaFiles: media.length };

  await source.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
  let targetTransaction = false;
  let copiedMedia = { copied: [], createdDirectory: false };
  try {
    await target.query('BEGIN');
    targetTransaction = true;
    const fresh = await inspect(source, target);
    for (const table of TABLES) {
      await copyTable(source, target, table, fresh.source[table]);
    }
    await setSequences(target);
    for (const table of TABLES) {
      const actual = await countRows(target, 'postgres', table);
      const expected = fresh.source[table] + (table === 'app_settings' && !fresh.hasSourceBrandingLock ? 1 : 0);
      if (actual !== expected) throw new Error(`Post-copy verification failed for ${table}: source ${fresh.source[table]}, target ${actual}.`);
    }
    copiedMedia = await prepareMedia(media, sourceMediaDir, targetMediaDir);
    await target.query('COMMIT');
    targetTransaction = false;
    await source.query('COMMIT');
    return { counts: fresh, mediaFiles: media.length };
  } catch (error) {
    if (targetTransaction) await target.query('ROLLBACK').catch(() => {});
    await source.query('ROLLBACK').catch(() => {});
    await Promise.all(copiedMedia.copied.map(file => fs.rm(file, { force: true })));
    throw error;
  }
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

function printReport(report, apply) {
  console.log(`${apply ? 'Import completed' : 'Dry run completed'}; no row contents or credentials are logged.`);
  for (const table of TABLES) console.log(`${table}: ${report.counts.source[table]} source rows; ${report.counts.target[table]} target rows before import`);
  console.log(`venue media files: ${report.mediaFiles}`);
  if (!apply) console.log('To import: stop source writes, verify a source backup, then use --apply --confirm-writes-paused --backup-verified.');
}

async function main(args = process.argv.slice(2)) {
  const { apply } = parseMode(args);
  if (config.database.driver !== 'postgres') throw new Error('Set DB_DRIVER=postgres and DATABASE_URL to the Supabase target before importing.');
  const sourceConfig = {
    host: required('SOURCE_MYSQL_HOST'), port: Number(process.env.SOURCE_MYSQL_PORT || 3306),
    user: required('SOURCE_MYSQL_USER'), password: required('SOURCE_MYSQL_PASSWORD'),
    database: required('SOURCE_MYSQL_DATABASE'), timezone: 'Z', waitForConnections: true,
    connectionLimit: 2, connectTimeout: 10000
  };
  const source = await mysql.createConnection(sourceConfig);
  const targetPool = new Pool({ connectionString: config.database.connectionString || undefined,
    host: config.database.connectionString ? undefined : config.database.host,
    port: config.database.connectionString ? undefined : config.database.port,
    user: config.database.connectionString ? undefined : config.database.user,
    password: config.database.connectionString ? undefined : config.database.password,
    database: config.database.connectionString ? undefined : config.database.database,
    ssl: config.database.ssl ? { rejectUnauthorized: false } : undefined, connectionTimeoutMillis: 10000, max: 2 });
  const target = await targetPool.connect();
  try {
    const report = await transfer({ source, target, apply,
      sourceMediaDir: process.env.SOURCE_MEDIA_DIR,
      targetMediaDir: config.mediaDir });
    printReport(report, apply);
  } finally {
    target.release();
    await targetPool.end();
    await source.end();
  }
}

if (require.main === module) {
  main().catch(error => { console.error(`MySQL to PostgreSQL import failed: ${error.message}`); process.exitCode = 1; });
}

module.exports = { TABLES, ORDER_COLUMNS, SEQUENCE_TABLES, parseMode, insertSql, inspect, transfer };

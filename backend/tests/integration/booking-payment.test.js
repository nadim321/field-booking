const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');

test('MySQL migration, booking and payment integration', { skip: process.env.RUN_DB_TESTS !== '1' }, async t => {
  const config = require('../../config/env');
  const mysql = require('mysql2/promise');
  const { database: source } = config;
  const admin = await mysql.createConnection({ host: source.host, port: source.port, user: source.user, password: source.password });
  const name = `booking_${process.pid}_${randomBytes(5).toString('hex')}_test`;
  let created = false;
  let db;
  try {
    await admin.query(`CREATE DATABASE \`${name}\``);
    created = true;
    config.database.database = name;
    db = require('../../database');
    await db.initialize();
    const c = await db.promiseConnection();
    let slot;
    try {
      const [result] = await c.query("INSERT INTO slots (start_time, end_time, price) VALUES ('18:00', '19:00', 2000)");
      slot = result.insertId;
    } finally { c.release(); }
    const bookingService = require('../../services/bookings/booking.service');
    const cancellations = require('../../services/bookings/cancellation.service');
    const { VERSION } = require('../../services/bookings/cancellation-policy');
    const details = { slot_id: slot, booking_date: '2099-10-10', customer_name: 'Integration Test', customer_phone: '01700000000', policy_accepted: true, policy_version: VERSION };
    let bookingId;
    await t.test('migration restart preserves schema and data', async () => {
      await db.close();
      await db.initialize();
      const c = await db.promiseConnection();
      try { const [[row]] = await c.query('SELECT COUNT(*) AS n FROM schema_migrations'); assert.equal(row.n, require('../../migrations/runner').migrations.length); }
      finally { c.release(); }
    });
    await t.test('adopts the existing unversioned schema without losing bookings or slots', async () => {
      const c = await db.promiseConnection();
      try { await c.query('DROP TABLE schema_migrations'); } finally { c.release(); }
      await db.close();
      await db.initialize();
      const check = await db.promiseConnection();
      try { const [[row]] = await check.query('SELECT COUNT(*) AS n FROM slots'); assert.equal(row.n, 1); }
      finally { check.release(); }
    });
    await t.test('concurrent holds produce exactly one owner', async () => {
      const results = await Promise.allSettled([bookingService.hold(details), bookingService.hold(details)]);
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
      assert.equal(results.find(r => r.status === 'rejected').reason.status, 409);
      details.session_token = results.find(r => r.status === 'fulfilled').value.session_token;
    });
    await t.test('wrong hold token cannot book or destroy the valid hold', async () => {
      await assert.rejects(bookingService.confirm({ ...details, session_token: 'wrong' }), { status: 400 });
      const result = await bookingService.confirm(details);
      bookingId = result.booking_id;
      assert.ok(bookingId);
      await assert.rejects(bookingService.confirm(details), { status: 409 });
    });
    await t.test('duplicate payment callbacks credit exactly once under concurrency', async () => {
      const c = await db.promiseConnection();
      let transactionId;
      try { const [r] = await c.query("INSERT INTO payment_transactions (booking_id,tran_id,amount,currency,status) VALUES (?, 'integration-txn', 500, 'BDT', 'initiated')", [bookingId]); transactionId = r.insertId; }
      finally { c.release(); }
      const validation = { amount: 500, status: 'VALID', currency: 'BDT', tran_id: 'integration-txn', val_id: 'test-val' };
      await Promise.all([cancellations.creditValidatedPayment(transactionId, bookingId, validation, 500), cancellations.creditValidatedPayment(transactionId, bookingId, validation, 500)]);
      const check = await db.promiseConnection();
      try { const [[row]] = await check.query('SELECT amount_paid,status FROM bookings WHERE id = ?', [bookingId]); assert.equal(Number(row.amount_paid), 500); assert.equal(row.status, 'approved'); }
      finally { check.release(); }
    });
    await t.test('cancellation preserves audit, releases slot and allows rebooking', async () => {
      const result = await cancellations.cancel(bookingId, 'customer', 'Integration cancellation', 1);
      assert.equal(result.refund_amount, 500);
      const hold = await bookingService.hold(details);
      const replacement = await bookingService.confirm({ ...details, session_token: hold.session_token });
      assert.notEqual(replacement.booking_id, bookingId);
      const c = await db.promiseConnection();
      try { await assert.rejects(c.query('DELETE FROM bookings WHERE id = ?', [bookingId]), error => error.code === 'ER_ROW_IS_REFERENCED_2'); }
      finally { c.release(); }
    });
    await t.test('an expired hold cannot confirm a booking', async () => {
      const other = { ...details, booking_date: '2099-10-11' };
      const hold = await bookingService.hold(other);
      const c = await db.promiseConnection();
      try { await c.query('UPDATE slot_holds SET expires_at = DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 1 MINUTE) WHERE session_token = ?', [hold.session_token]); }
      finally { c.release(); }
      await assert.rejects(bookingService.confirm({ ...other, session_token: hold.session_token }), { status: 400 });
    });
    await t.test('backup restores into an empty database and refuses a second overwrite', { skip: process.env.RUN_BACKUP_TESTS !== '1' }, async () => {
      const fs = require('node:fs/promises');
      const os = require('node:os');
      const path = require('node:path');
      const { promisify } = require('node:util');
      const execFile = promisify(require('node:child_process').execFile);
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'booking-backup-test-'));
      const target = name + '_restore';
      await admin.query(`CREATE DATABASE \`${target}\``);
      try {
        const env = { ...process.env, DB_HOST: source.host, DB_PORT: String(source.port), DB_USER: source.user, DB_PASS: source.password, DB_NAME: name, BACKUP_DIR: dir };
        await execFile(process.execPath, [path.resolve(__dirname, '../../scripts/backup.js')], { env });
        const file = path.join(dir, (await fs.readdir(dir)).find(file => file.endsWith('.sql.gz')));
        const args = [path.resolve(__dirname, '../../scripts/restore.js'), file, target, `--confirm=${target}`];
        await execFile(process.execPath, args, { env });
        const [[original]] = await admin.query(`SELECT COUNT(*) AS n FROM \`${name}\`.bookings`);
        const [[restored]] = await admin.query(`SELECT COUNT(*) AS n FROM \`${target}\`.bookings`);
        assert.equal(restored.n, original.n);
        const [[refunds]] = await admin.query(`SELECT COUNT(*) AS n FROM \`${target}\`.booking_cancellations`);
        assert.equal(refunds.n, 1);
        await assert.rejects(execFile(process.execPath, args, { env }));
      } finally { await admin.query(`DROP DATABASE \`${target}\``); await fs.rm(dir, { recursive: true, force: true }); }
    });

  } finally {
    if (db) await db.close();
    if (created) await admin.query(`DROP DATABASE \`${name}\``);
    await admin.end();
  }
});

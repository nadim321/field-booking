const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');

test('payment attempts serialize requests and recover conservatively', { skip: process.env.RUN_DB_TESTS !== '1' }, async t => {
  const config = require('../../config/env');
  const mysql = require('mysql2/promise');
  const admin = await mysql.createConnection({ ...config.database, database: undefined });
  const name = `booking_${randomBytes(6).toString('hex')}_attempt_test`;
  await admin.query(`CREATE DATABASE \`${name}\``);
  config.database.database = name;
  const db = require('../../database');
  const provider = require('../../services/payments/sslcommerz.provider');
  let calls = 0, resolveGateway;
  provider.initiateSession = async () => { calls++; return new Promise(resolve => resolveGateway = resolve); };
  const attempts = require('../../services/payments/attempt.service');
  let connection;
  try {
    await db.initialize();
    connection = await db.promiseConnection();
    await connection.query("INSERT INTO slots (id,start_time,end_time,price) VALUES (1,'18:00','19:00',2000)");
    for (let id = 1; id <= 5; id++) await connection.query("INSERT INTO bookings (id,slot_id,booking_date,customer_name,customer_phone) VALUES (?,1,?,'Test','01700000000')", [id, `2099-10-${10 + id}`]);
    await t.test('different concurrent keys and legacy callers share a single gateway call', async () => {
      const first = attempts.initiate(1, 'first-request');
      while (!resolveGateway) await new Promise(resolve => setImmediate(resolve));
      const duplicate = await attempts.initiate(1, 'second-request');
      assert.equal(duplicate.state, 'initializing');
      assert.equal((await attempts.initiate(1)).state, 'initializing');
      assert.equal(calls, 1);
      resolveGateway({ status: 'SUCCESS', GatewayPageURL: 'https://sandbox.sslcommerz.com/test', sessionkey: 'session' });
      const ready = await first;
      assert.equal(ready.state, 'ready');
      assert.equal((await attempts.initiate(1, 'second-request')).tran_id, ready.tran_id);
      assert.equal(calls, 1);
    });
    await t.test('unverified callback cannot mark failure or unlock another payment', async () => {
      provider.queryTransaction = async () => ({ element: [] });
      const before = await attempts.initiate(1, 'first-request');
      await attempts.reconcile(before.tran_id);
      assert.equal((await attempts.initiate(1, 'third-request')).state, 'ready');
      assert.equal(calls, 1);
    });
    await t.test('confirmed terminal failure permits a new key but old key replays terminal attempt', async () => {
      const before = await attempts.initiate(1, 'first-request');
      provider.queryTransaction = async () => ({ element: [{ tran_id: before.tran_id, amount: before.amount, currency: 'BDT', status: 'FAILED' }] });
      await attempts.reconcile(before.tran_id);
      assert.equal((await attempts.initiate(1, 'first-request')).state, 'failed');
      provider.initiateSession = async () => { calls++; return { status: 'SUCCESS', GatewayPageURL: 'https://sandbox.sslcommerz.com/retry' }; };
      const retry = await attempts.initiate(1, 'new-request');
      assert.notEqual(retry.tran_id, before.tran_id);
      assert.equal(calls, 2);
    });
    await t.test('timeout persists unknown attempt; retries never call gateway again', async () => {
      provider.initiateSession = async () => { calls++; throw new Error('Simulated timeout'); };
      await assert.rejects(attempts.initiate(2, 'timeout-request'));
      const count = calls;
      assert.equal((await attempts.initiate(2, 'other-request')).state, 'verification_needed');
      assert.equal((await attempts.initiate(2, 'timeout-request')).state, 'verification_needed');
      assert.equal(calls, count);
    });
    await t.test('stale initialization survives process restart without another charge', async () => {
      await connection.query("INSERT INTO payment_transactions (booking_id,tran_id,amount,initialization_state,started_at) VALUES (3,'crashed',500,'starting',DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 MINUTE))");
      const count = calls;
      assert.equal((await attempts.initiate(3, 'restart-request')).state, 'verification_needed');
      assert.equal(calls, count);
    });
    await t.test('wrong-amount terminal result is ignored and valid status cannot regress', async () => {
      provider.queryTransaction = async () => ({ element: [{ tran_id: 'crashed', amount: 1, currency: 'BDT', status: 'FAILED' }] });
      await attempts.reconcile('crashed');
      assert.equal((await attempts.initiate(3, 'restart-request')).state, 'verification_needed');
      await connection.query("UPDATE payment_transactions SET status = 'valid' WHERE tran_id = 'crashed'");
      assert.equal((await attempts.reconcile('crashed')).status, 'valid');
    });
    await t.test('cancelled bookings and invalid keys are rejected', async () => {
      await connection.query("UPDATE bookings SET status = 'cancelled' WHERE id = 4");
      await assert.rejects(attempts.initiate(4, 'cancelled-request'), { status: 409 });
      await assert.rejects(attempts.initiate(5, '../invalid'), { status: 400 });
    });
  } finally {
    connection?.release();
    await db.close();
    await admin.query(`DROP DATABASE \`${name}\``);
    await admin.end();
  }
});

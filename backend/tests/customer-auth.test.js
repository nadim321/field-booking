const { test } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../database');
const { normalizePhone, phoneVariants, requestOtp, verifyOtp, OTP_TTL_MS } = require('../services/customers/customer-auth.service');

test('customer phone numbers are normalized to Bangladesh E.164', () => {
  assert.equal(normalizePhone('01712-345678'), '+8801712345678');
  assert.equal(normalizePhone('+880 1712 345678'), '+8801712345678');
  assert.equal(normalizePhone('8801712345678'), '+8801712345678');
  assert.throws(() => normalizePhone('01212345678'), { status: 400 });
});

test('legacy booking phone formats can be claimed after phone verification', () => {
  assert.deepEqual(phoneVariants('+8801712345678'), ['+8801712345678', '8801712345678', '01712345678', '881712345678']);
});

test('OTP is one-time, creates a customer session, and links matching legacy bookings', async () => {
  const oldConnection = db.promiseConnection;
  const oldEnabled = process.env.BOOKING_PHONE_OTP_REQUIRED;
  const oldDefaultEnabled = process.env.MY_BOOKINGS_DEMO_CODE_ENABLED;
  process.env.BOOKING_PHONE_OTP_REQUIRED = 'true';
  process.env.MY_BOOKINGS_DEMO_CODE_ENABLED = 'false';
  let challenge = null;
  let customer = null;
  let nextId = 1;
  const linked = [];
  db.promiseConnection = async () => ({
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async query(sql, args) {
      if (sql.startsWith('DELETE FROM customer_otp_challenges')) return [{ affectedRows: 0 }];
      if (sql.startsWith('SELECT COUNT(*) AS total')) return [[{ total: 0 }]];
      if (sql.startsWith('SELECT created_at FROM customer_otp_challenges')) return [[...(challenge ? [{ created_at: challenge.created_at }] : [])]];
      if (sql.startsWith('UPDATE customer_otp_challenges SET consumed_at = CURRENT_TIMESTAMP')) { if (challenge) challenge.consumed_at = new Date(); return [{ affectedRows: 1 }]; }
      if (sql.startsWith('INSERT INTO customer_otp_challenges')) {
        challenge = { id: nextId++, phone_e164: args[0], code_hash: args[1], ip_hash: args[2], expires_at: args[3], created_at: new Date(), attempts: 0, consumed_at: null };
        return [{ insertId: challenge.id }];
      }
      if (sql.startsWith('SELECT * FROM customer_otp_challenges')) return [[...(challenge && !challenge.consumed_at && challenge.expires_at > args[1] ? [{ ...challenge }] : [])]];
      if (sql.startsWith('UPDATE customer_otp_challenges SET attempts')) { challenge.attempts = args[0]; challenge.consumed_at = args[1]; return [{ affectedRows: 1 }]; }
      if (sql.startsWith('UPDATE customer_otp_challenges SET consumed_at = ?')) { challenge.consumed_at = args[0]; return [{ affectedRows: 1 }]; }
      if (sql.startsWith('INSERT IGNORE INTO customers')) { customer ||= { id: 9, phone_e164: args[0] }; return [{ insertId: customer.id }]; }
      if (sql.startsWith('SELECT id, phone_e164 FROM customers')) return [[customer]];
      if (sql.startsWith('UPDATE bookings') || sql.startsWith('UPDATE recurring_bookings')) { linked.push({ sql, args }); return [{ affectedRows: 1 }]; }
      throw new Error(`Unexpected OTP test query: ${sql}`);
    }
  });
  try {
    let sentCode;
    const sent = await requestOtp('01712345678', '127.0.0.1', { now: Date.now(), provider: { async send({ message }) { sentCode = /\d{6}/.exec(message)[0]; return { success: true }; } } });
    assert.equal(sent.expires_in, OTP_TTL_MS / 1000);
    const result = await verifyOtp('+8801712345678', sentCode);
    const jwt = require('jsonwebtoken');
    const decoded = jwt.decode(result.token);
    assert.equal(decoded.role, 'customer');
    assert.equal(result.customer.phone, '+8801712345678');
    assert.equal(linked.length, 2);
    await assert.rejects(verifyOtp('01712345678', sentCode), { status: 400 });

    const oldOtpLog = process.env.OTP_LOG_CODE;
    const oldNodeEnv = process.env.NODE_ENV;
    const oldDebug = process.env.OTP_DEBUG_CODE;
    const originalLog = console.log;
    try {
      // My Bookings must still use real OTP when booking verification is disabled.
      process.env.BOOKING_PHONE_OTP_REQUIRED = 'false';
      process.env.OTP_LOG_CODE = 'true';
      process.env.NODE_ENV = 'production';
      delete process.env.OTP_DEBUG_CODE;
      const now = Date.now() + 61_000;
      let logLine;
      console.log = line => { logLine = line; };
      const logged = await requestOtp('01712345678', '127.0.0.1', {
        now, provider: { async send() { return { success: false, error: 'SMS provider is not configured' }; } }
      });
      console.log = originalLog;
      assert.equal(logged.message, 'Verification code sent');
      assert.equal(Object.hasOwn(logged, 'debug_code'), false);
      const event = JSON.parse(logLine);
      assert.equal(event.event, 'customer_otp');
      assert.equal(event.phone_masked, '+880******5678');
      assert.match(event.code, /^\d{6}$/);
      assert.equal((await verifyOtp('01712345678', event.code, { now: now + 1000 })).message, 'Phone verified');

      process.env.OTP_LOG_CODE = 'false';
      let failedCode;
      await assert.rejects(requestOtp('01712345678', '127.0.0.1', {
        now: now + 61_000,
        provider: { async send({ message }) { failedCode = /\d{6}/.exec(message)[0]; return { success: false }; } }
      }), { status: 503 });
      await assert.rejects(verifyOtp('01712345678', failedCode, { now: now + 62_000 }), { status: 400 });
    } finally {
      console.log = originalLog;
      if (oldOtpLog === undefined) delete process.env.OTP_LOG_CODE; else process.env.OTP_LOG_CODE = oldOtpLog;
      if (oldNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldNodeEnv;
      if (oldDebug === undefined) delete process.env.OTP_DEBUG_CODE; else process.env.OTP_DEBUG_CODE = oldDebug;
    }
  } finally {
    db.promiseConnection = oldConnection;
    if (oldEnabled === undefined) delete process.env.BOOKING_PHONE_OTP_REQUIRED; else process.env.BOOKING_PHONE_OTP_REQUIRED = oldEnabled;
    if (oldDefaultEnabled === undefined) delete process.env.MY_BOOKINGS_DEMO_CODE_ENABLED; else process.env.MY_BOOKINGS_DEMO_CODE_ENABLED = oldDefaultEnabled;
  }
});

test('demo login toggle accepts only the default code and creates a customer session that claims legacy bookings', async () => {
  const oldConnection = db.promiseConnection;
  const oldEnabled = process.env.BOOKING_PHONE_OTP_REQUIRED;
  const oldDefaultEnabled = process.env.MY_BOOKINGS_DEMO_CODE_ENABLED;
  const linked = [];
  db.promiseConnection = async () => ({
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async query(sql, args) {
      if (sql.startsWith('INSERT IGNORE INTO customers')) return [{ insertId: 17 }];
      if (sql.startsWith('SELECT id, phone_e164 FROM customers')) return [[{ id: 17, phone_e164: args[0] }]];
      if (sql.startsWith('UPDATE bookings') || sql.startsWith('UPDATE recurring_bookings')) { linked.push(sql); return [{ affectedRows: 1 }]; }
      throw new Error(`Unexpected default OTP test query: ${sql}`);
    }
  });
  try {
    process.env.BOOKING_PHONE_OTP_REQUIRED = 'false';
    process.env.MY_BOOKINGS_DEMO_CODE_ENABLED = 'true';
    await assert.rejects(requestOtp('01712345678', '127.0.0.1'), { status: 409 });
    await assert.rejects(verifyOtp('01712345678', '000000'), { status: 401 });
    const result = await verifyOtp('01712345678', '123456');
    assert.equal(require('jsonwebtoken').decode(result.token).role, 'customer');
    assert.equal(result.customer.phone, '+8801712345678');
    assert.equal(linked.length, 2);
  } finally {
    db.promiseConnection = oldConnection;
    if (oldEnabled === undefined) delete process.env.BOOKING_PHONE_OTP_REQUIRED; else process.env.BOOKING_PHONE_OTP_REQUIRED = oldEnabled;
    if (oldDefaultEnabled === undefined) delete process.env.MY_BOOKINGS_DEMO_CODE_ENABLED; else process.env.MY_BOOKINGS_DEMO_CODE_ENABLED = oldDefaultEnabled;
  }
});

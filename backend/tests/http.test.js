const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { createApp } = require('../app');
const { jwtSecret } = require('../config/env');
const { VERSION } = require('../services/bookings/cancellation-policy');

test('HTTP routing, authentication, errors and health without a database', async t => {
  const frontendUrl = 'https://field-booking-front.onrender.com';
  const server = createApp({ frontendUrl }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await t.test('policy is public and exposes the current version', async () => {
      const res = await fetch(base + '/api/booking-policy');
      assert.equal(res.status, 200);
      assert.ok(res.headers.get('x-request-id'));
      assert.equal((await res.json()).version, VERSION);
    });
    await t.test('backend root identifies the API service', async () => {
      const res = await fetch(base + '/');
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { service: 'booking-api', status: 'ok' });
    });
    await t.test('season booking redirects the browser to the public frontend', async () => {
      const page = await fetch(base + '/season-booking', { redirect: 'manual' });
      assert.equal(page.status, 302);
      assert.equal(page.headers.get('location'), `${frontendUrl}/season-booking`);
    });
    await t.test('admin routes reject missing and non-admin credentials', async () => {
      for (const headers of [{}, { Authorization: `Bearer ${jwt.sign({ id: 1, role: 'customer' }, jwtSecret)}` }]) {
        const res = await fetch(base + '/api/admin/bookings', { headers });
        assert.ok([401, 403].includes(res.status));
      }
    });
    await t.test('customer bookings and booking confirmation require phone verification', async () => {
      assert.equal((await fetch(base + '/api/customer/bookings')).status, 401);
      const oldEnabled = process.env.BOOKING_PHONE_OTP_REQUIRED;
      try {
        process.env.BOOKING_PHONE_OTP_REQUIRED = 'true';
        const res = await fetch(base + '/api/slots/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        assert.equal(res.status, 401);
        process.env.BOOKING_PHONE_OTP_REQUIRED = 'false';
        const guestBooking = await fetch(base + '/api/slots/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        assert.equal(guestBooking.status, 400);
        assert.equal((await guestBooking.json()).message, 'Enter a valid Bangladesh mobile number');
      } finally {
        if (oldEnabled === undefined) delete process.env.BOOKING_PHONE_OTP_REQUIRED; else process.env.BOOKING_PHONE_OTP_REQUIRED = oldEnabled;
      }
    });
    await t.test('unknown API is JSON 404, not Angular index', async () => {
      const res = await fetch(base + '/api/does-not-exist');
      assert.equal(res.status, 404);
      assert.match(res.headers.get('content-type'), /json/);
    });
    await t.test('runtime config stays available on the backend', async () => {
      const res = await fetch(base + '/runtime-config.js');
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type'), /javascript/);
    });
    await t.test('invalid JSON is handled centrally', async () => {
      const res = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
      assert.equal(res.status, 400);
    });
    await t.test('live is healthy but ready fails before initialization', async () => {
      assert.equal((await fetch(base + '/health/live')).status, 200);
      assert.equal((await fetch(base + '/health/ready')).status, 503);
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

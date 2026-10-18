const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const express = require('express');
const { createApp } = require('../app');
const { jwtSecret } = require('../config/env');
const { VERSION } = require('../services/bookings/cancellation-policy');

test('HTTP routing, authentication, errors and health without a database', async t => {
  const frontendApp = express();
  let frontendHits = 0;
  frontendApp.use((req, res) => {
    frontendHits++;
    if (req.path === '/') return res.type('html').send('<html><body>frontend fixture</body></html>');
    if (req.path === '/assets/main.js') return res.type('text/plain').send(req.originalUrl);
    return res.status(404).send('frontend 404');
  });
  const frontendServer = frontendApp.listen(0, '127.0.0.1');
  await new Promise(resolve => frontendServer.once('listening', resolve));
  const frontendUrl = `http://127.0.0.1:${frontendServer.address().port}`;
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
    await t.test('backend root proxies the frontend UI', async () => {
      const res = await fetch(base + '/');
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type'), /text\/html/);
      assert.match(await res.text(), /frontend fixture/);
    });
    await t.test('frontend routes and assets proxy with their query strings', async () => {
      const page = await fetch(base + '/season-booking');
      assert.equal(page.status, 200);
      assert.match(await page.text(), /frontend fixture/);
      const asset = await fetch(base + '/assets/main.js?v=2');
      assert.equal(asset.status, 200);
      assert.equal(await asset.text(), '/assets/main.js?v=2');
    });
    await t.test('admin routes reject missing and non-admin credentials', async () => {
      for (const headers of [{}, { Authorization: `Bearer ${jwt.sign({ id: 1, role: 'customer' }, jwtSecret)}` }]) {
        const res = await fetch(base + '/api/admin/bookings', { headers });
        assert.ok([401, 403].includes(res.status));
      }
    });
    await t.test('unknown API is JSON 404, not Angular index', async () => {
      const hitsBefore = frontendHits;
      const res = await fetch(base + '/api/does-not-exist');
      assert.equal(res.status, 404);
      assert.match(res.headers.get('content-type'), /json/);
      assert.equal(frontendHits, hitsBefore);
    });
    await t.test('runtime config stays on the backend and bypasses the frontend proxy', async () => {
      const hitsBefore = frontendHits;
      const res = await fetch(base + '/runtime-config.js');
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type'), /javascript/);
      assert.equal(frontendHits, hitsBefore);
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
    await Promise.all([server, frontendServer].map(current => new Promise(resolve => current.close(resolve))));
  }
});

test('frontend proxy reports unavailable upstream as 502', async () => {
  const server = createApp({ frontendUrl: 'http://127.0.0.1:1' }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/`);
    assert.equal(res.status, 502);
    assert.match((await res.json()).message, /could not be completed/);
    assert.ok(res.headers.get('x-request-id'));
  } finally { await new Promise(resolve => server.close(resolve)); }
});

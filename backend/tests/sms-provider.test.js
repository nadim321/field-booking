const test = require('node:test');
const assert = require('node:assert/strict');
const { JsonSmsProvider } = require('../services/notifications/providers/sms.provider');

test('JSON SMS relay requires configuration and never silently simulates a real send', async () => {
  const provider = new JsonSmsProvider({ apiUrl: '', apiKey: '' });
  assert.deepEqual(await provider.send({ to: '+8801712345678', message: 'test', idempotencyKey: 'key' }), { success: false, error: 'Booking SMS relay is not configured' });
});

test('JSON SMS relay uses HTTPS, bearer auth, sender ID and idempotency key', async t => {
  const originalFetch = global.fetch;
  let request;
  global.fetch = async (url, options) => { request = { url: String(url), options }; return { ok: true }; };
  t.after(() => { global.fetch = originalFetch; });
  const provider = new JsonSmsProvider({ apiUrl: 'https://relay.example.test/send', apiKey: 'test-key', senderId: 'TURF' });
  const result = await provider.send({ to: '+8801712345678', message: 'code', idempotencyKey: 'job-8' });
  assert.equal(result.success, true);
  assert.equal(request.url, 'https://relay.example.test/send');
  assert.equal(request.options.headers.Authorization, 'Bearer test-key');
  assert.equal(request.options.headers['Idempotency-Key'], 'job-8');
  assert.deepEqual(JSON.parse(request.options.body), { to: '+8801712345678', message: 'code', sender_id: 'TURF', idempotency_key: 'job-8' });
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { redactEvent, isEnabled } = require('../observability/sentry');
const { serializeRuntimeConfig } = require('../config/runtime-config');

test('Sentry remains disabled without a DSN', () => {
  assert.equal(isEnabled(), false);
});

test('Sentry event scrubber removes sensitive request data and query strings', () => {
  const event = redactEvent({ request: {
    url: 'https://booking.example/api/payments/ipn?token=private',
    data: { secret: 'private' }, cookies: { session: 'private' },
    headers: { Authorization: 'Bearer private', Cookie: 'session=private', 'X-Request-ID': 'safe' }
  } });
  assert.equal(event.request, undefined);
  assert.doesNotMatch(JSON.stringify(event), /private/);
});

test('original error stack is reported once with request ID through a fake transport', async () => {
  const sentry = require('../observability/sentry');
  const events = [];
  sentry.initialize({ SENTRY_DSN: 'https://public@example.invalid/1', NODE_ENV: 'test' }, {
    transport: () => ({ send: async envelope => { events.push(envelope); return { statusCode: 200 }; }, flush: async () => true })
  });
  const { reportError } = require('../middleware/observability');
  const req = { requestId: 'request-test', method: 'POST', route: { path: '/api/test' } };
  const original = new Error('SQL password=secret customer=private');
  reportError(original, req);
  reportError(original, req);
  await sentry.flush();
  const payloads = events.flatMap(envelope => envelope[1].filter(item => item[0].type === 'event').map(item => item[1]));
  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].tags.request_id, 'request-test');
  assert.ok(payloads[0].exception.values[0].stacktrace.frames.some(frame => frame.filename.includes('observability.test.js')));
  assert.doesNotMatch(JSON.stringify(payloads), /secret|private/);
  await require('@sentry/node').close(2000);
});

test('runtime config exposes only the public browser configuration safely', () => {
  const script = serializeRuntimeConfig({ sentryDsn: 'https://public@example/1', release: '<release>' });
  assert.match(script, /sentryDsn/);
  assert.match(script, /\\u003crelease\\u003e/);
  assert.doesNotMatch(script, /SENTRY_AUTH_TOKEN|DB_PASS|JWT_SECRET/);
});

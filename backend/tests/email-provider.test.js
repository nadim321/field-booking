const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTransportOptions } = require('../services/notifications/providers/email.provider');

const auth = { user: 'a@x.com', pass: 'secret' };
test('defaults to the gmail service when nothing else is set', () => {
  assert.deepEqual(buildTransportOptions({ EMAIL_USER: 'a@x.com', EMAIL_PASS: 'secret' }), { service: 'gmail', auth });
});
test('EMAIL_SERVICE selects another well-known service, case-insensitively', () => {
  assert.equal(buildTransportOptions({ EMAIL_SERVICE: ' Outlook ', ...{ EMAIL_USER: 'a@x.com', EMAIL_PASS: 'secret' } }).service, 'outlook');
});
test('EMAIL_HOST uses a custom SMTP server instead of the service (cPanel)', () => {
  const o = buildTransportOptions({ EMAIL_SERVICE: 'gmail', EMAIL_HOST: 'mail.example.com', EMAIL_USER: 'a@x.com', EMAIL_PASS: 'secret' });
  assert.deepEqual(o, { host: 'mail.example.com', port: 465, secure: true, auth });
  assert.equal(o.service, undefined);
});
test('port 587 uses STARTTLS unless EMAIL_SECURE says otherwise', () => {
  const base = { EMAIL_HOST: 'mail.example.com', EMAIL_PORT: '587', EMAIL_USER: 'a@x.com', EMAIL_PASS: 'secret' };
  assert.equal(buildTransportOptions(base).secure, false);
  assert.equal(buildTransportOptions({ ...base, EMAIL_SECURE: 'true' }).secure, true);
  assert.equal(buildTransportOptions({ ...base, EMAIL_PORT: '465', EMAIL_SECURE: 'false' }).secure, false);
});

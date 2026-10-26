const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../database');
const usage = require('../services/notifications/sms-usage.service');

test('SMS parts: plain text is 160/153 and Bangla text is 70/67 characters per part', () => {
  assert.equal(usage.segments('a'.repeat(160)).units, 1);
  assert.equal(usage.segments('a'.repeat(161)).units, 2);
  assert.equal(usage.segments('a'.repeat(306)).units, 2);
  assert.equal(usage.segments('a'.repeat(307)).units, 3);
  assert.equal(usage.segments('বুকিং নিশ্চিত').encoding, 'ucs2');
  assert.equal(usage.segments('ক'.repeat(70)).units, 1);
  assert.equal(usage.segments('ক'.repeat(71)).units, 2);
  assert.equal(usage.segments('').units, 1);
});

test('unit cost comes only from a valid non-negative SMS_UNIT_COST_BDT', () => {
  assert.equal(usage.unitCost({}), null);
  assert.equal(usage.unitCost({ SMS_UNIT_COST_BDT: '' }), null);
  assert.equal(usage.unitCost({ SMS_UNIT_COST_BDT: 'abc' }), null);
  assert.equal(usage.unitCost({ SMS_UNIT_COST_BDT: '-1' }), null);
  assert.equal(usage.unitCost({ SMS_UNIT_COST_BDT: '0.35' }), 0.35);
});

test('provider results map to simulated, accepted or failed and never to delivered', () => {
  assert.equal(usage.statusFor({ success: true, providerResponse: { mock: true } }), 'simulated');
  assert.equal(usage.statusFor({ success: true }), 'accepted');
  assert.equal(usage.statusFor({ success: false }), 'failed');
  assert.equal(usage.statusFor(undefined), 'failed');
});

test('webhook secret comparison is exact and rejects missing values', () => {
  assert.equal(usage.secretMatches('s3cret-value-123456', 's3cret-value-123456'), true);
  assert.equal(usage.secretMatches('s3cret-value-123457', 's3cret-value-123456'), false);
  assert.equal(usage.secretMatches('', 's3cret-value-123456'), false);
  assert.equal(usage.secretMatches(undefined, 's3cret-value-123456'), false);
  assert.equal(usage.secretMatches('anything', ''), false);
});

test('usage logging stores neither phone numbers nor message text and never throws', async () => {
  const original = db.promiseConnection;
  let saved;
  db.promiseConnection = async () => ({ async query(sql, args) { saved = { sql, args }; return [{}]; }, release() {} });
  process.env.SMS_UNIT_COST_BDT = '0.4';
  try {
    await usage.record({ purpose: 'otp', provider: 'json', result: { success: true, providerMessageId: 'abc-1' }, message: 'Your code is 123456', now: 5 });
    assert.match(saved.sql, /INSERT INTO sms_usage_log/);
    assert.deepEqual(saved.args, ['otp', 'json', 'accepted', 1, 0.4, 'abc-1', null, 5]);
    assert.ok(!saved.args.includes('Your code is 123456'));
    db.promiseConnection = async () => { throw new Error('db down'); };
    await usage.record({ purpose: 'booking', provider: 'mock', result: { success: true }, message: 'x' });
  } finally { delete process.env.SMS_UNIT_COST_BDT; db.promiseConnection = original; }
});

test('simulated and failed sends carry no estimated cost', async () => {
  const original = db.promiseConnection;
  const rows = [];
  db.promiseConnection = async () => ({ async query(sql, args) { rows.push(args); return [{}]; }, release() {} });
  process.env.SMS_UNIT_COST_BDT = '0.4';
  try {
    await usage.record({ purpose: 'booking', provider: 'mock', result: { success: true, providerResponse: { mock: true } }, message: 'x' });
    await usage.record({ purpose: 'booking', provider: 'json', result: { success: false }, message: 'x' });
    assert.equal(rows[0][4], null);
    assert.equal(rows[1][4], null);
  } finally { delete process.env.SMS_UNIT_COST_BDT; db.promiseConnection = original; }
});

test('delivery receipts reject unknown statuses, bad ids and oversized batches', async () => {
  await assert.rejects(usage.applyReceipts([{ message_id: 'a b', status: 'delivered' }]), { status: 400 });
  await assert.rejects(usage.applyReceipts([{ message_id: 'ok-1', status: 'maybe' }]), { status: 400 });
  await assert.rejects(usage.applyReceipts([]), { status: 400 });
  await assert.rejects(usage.applyReceipts(Array.from({ length: 101 }, () => ({ message_id: 'ok-1', status: 'delivered' }))), { status: 400 });
});

test('provider status words normalise to delivered or failed without downgrading delivered', async () => {
  const original = db.promiseConnection;
  const updates = [];
  db.promiseConnection = async () => ({ async query(sql, args) { updates.push({ sql, args }); return [{ affectedRows: 1 }]; }, release() {} });
  try {
    const result = await usage.applyReceipts([{ message_id: 'm1', status: 'DELIVRD' }, { message_id: 'm2', status: 'Expired' }], 9);
    assert.deepEqual(result, { received: 2, matched: 2, unmatched: 0 });
    assert.deepEqual(updates[0].args, ['delivered', 9, 'm1']);
    assert.deepEqual(updates.find(u => u.args[2] === 'm2').args, ['failed', 9, 'm2']);
    assert.ok(updates.every(u => !/UPDATE/.test(u.sql) || /delivery_status<>'delivered'/.test(u.sql)));
  } finally { db.promiseConnection = original; }
});

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../database');
const closing = require('../services/operations/daily-closing.service');
const { dateOnly } = require('../utils/dates');

const staff = { id: 3, username: 'manager' };

function fakeDb(handlers) {
  const original = db.promiseConnection;
  const log = [];
  db.promiseConnection = async () => ({
    async query(sql, args = []) {
      log.push({ sql, args });
      for (const [pattern, result] of handlers) if (pattern.test(sql)) return typeof result === 'function' ? result(sql, args) : result;
      return [[]];
    },
    async beginTransaction() { log.push({ sql: 'BEGIN' }); },
    async commit() { log.push({ sql: 'COMMIT' }); },
    async rollback() { log.push({ sql: 'ROLLBACK' }); },
    release() {}
  });
  return { log, restore() { db.promiseConnection = original; } };
}

test('dateOnly reads local calendar fields from driver Date objects', () => {
  assert.equal(dateOnly(new Date(2026, 9, 25)), '2026-10-25');
  assert.equal(dateOnly('2026-10-25T00:00:00.000Z'), '2026-10-25');
  assert.equal(dateOnly(null), '');
});

test('money parsing uses exact paisa and rejects bad input', () => {
  assert.equal(closing.paisa('10.05'), 1005);
  assert.equal(closing.paisa('0.1'), 10);
  assert.throws(() => closing.paisa('10.999'), { status: 400 });
  assert.throws(() => closing.paisa('abc'), { status: 400 });
  assert.throws(() => closing.paisa(''), { status: 400 });
});

test('closing rejects invalid dates and negative amounts before touching the database', async () => {
  await assert.rejects(closing.close('2026-02-30', { counted_cash: '1' }, staff), { status: 400 });
  await assert.rejects(closing.close('2999-01-01', { counted_cash: '1' }, staff), /future/);
  await assert.rejects(closing.close('2026-10-25', { counted_cash: '-5' }, staff), { status: 400 });
  await assert.rejects(closing.close('2026-10-25', { counted_cash: '5', cash_refunds_paid: '-1' }, staff), { status: 400 });
  await assert.rejects(closing.close('2026-10-25', { counted_cash: '5', note: 'x'.repeat(501) }, staff), { status: 400 });
});

const summaryHandlers = (cash = '500', mismatches = []) => [
  [/FROM booking_collections\s+WHERE created_at>=\? AND created_at<\? AND kind IN/, [[{ kind: 'collection', method: 'cash', amount: cash }, { kind: 'collection', method: 'bkash', amount: '200' }, { kind: 'reversal', method: 'cash', amount: '50' }]]],
  [/FROM venue_expenses/, [[{ method: 'cash', amount: '100.50' }, { method: 'nagad', amount: '40' }]]],
  [/FROM refund_settlements/, [[{ amount: '75', count: 1 }]]],
  [/FROM daily_closings WHERE close_date=\? AND status/, [[]]],
  [/COUNT\(\*\) AS total FROM daily_closings/, [[{ total: 0 }]]],
  [/GROUP BY b\.id/, [mismatches]],
  [/COUNT\(DISTINCT booking_id\)/, [[{ total: 2 }]]]
];

test('summary separates cash from online money and subtracts only cash expenses', async () => {
  const fake = fakeDb(summaryHandlers());
  try {
    const s = await closing.summary('2026-10-25');
    assert.equal(s.collections.cash_net, 450);
    assert.equal(s.collections.online_net, 200);
    assert.equal(s.collections.total_net, 650);
    assert.equal(s.expenses.cash, 100.5);
    assert.equal(s.expenses.total, 140.5);
    assert.equal(s.expected_cash_before_refunds, 349.5);
    assert.deepEqual(s.completed_refunds, { amount: 75, count: 1 });
    assert.equal(s.ledger_check.ok, true);
    assert.equal(s.ledger_check.bookings_checked, 2);
  } finally { fake.restore(); }
});

test('a day with a ledger mismatch cannot be closed', async () => {
  const fake = fakeDb(summaryHandlers('500', [{ booking_id: 9, amount_paid: '100', ledger_total: '90' }]));
  try {
    await assert.rejects(closing.close('2026-10-25', { counted_cash: '349.50' }, staff), { status: 409 });
    assert.ok(!fake.log.some(entry => /INSERT INTO daily_closings/.test(entry.sql)));
  } finally { fake.restore(); }
});

test('a cash difference needs an explanation and the variance is counted minus expected', async () => {
  const fake = fakeDb([[/FOR UPDATE/, [[]]], ...summaryHandlers(), [/INSERT INTO daily_closings/, [{ insertId: 11 }]]]);
  try {
    await assert.rejects(closing.close('2026-10-25', { counted_cash: '340' }, staff), /Explain the cash difference/);
    const saved = await closing.close('2026-10-25', { counted_cash: '340', note: 'Short by cash tip' }, staff);
    assert.equal(saved.expected_cash, 349.5);
    assert.equal(saved.variance, -9.5);
    const insert = fake.log.find(entry => /INSERT INTO daily_closings/.test(entry.sql));
    assert.equal(insert.args[1], '349.50');
    assert.equal(insert.args[4], '-9.50');
    assert.equal(insert.args[6], '2026-10-25');
    assert.ok(fake.log.some(entry => entry.sql === 'COMMIT'));
  } finally { fake.restore(); }
});

test('cash refunds paid from the drawer reduce expected cash', async () => {
  const fake = fakeDb([[/FOR UPDATE/, [[]]], ...summaryHandlers(), [/INSERT INTO daily_closings/, [{ insertId: 12 }]]]);
  try {
    const saved = await closing.close('2026-10-25', { counted_cash: '299.50', cash_refunds_paid: '50' }, staff);
    assert.equal(saved.expected_cash, 299.5);
    assert.equal(saved.variance, 0);
  } finally { fake.restore(); }
});

test('correcting a closed day requires a reason and supersedes, never overwrites, the old row', async () => {
  const fake = fakeDb([[/FOR UPDATE/, [[{ id: 5 }]]], ...summaryHandlers(), [/INSERT INTO daily_closings/, [{ insertId: 6 }]]]);
  try {
    await assert.rejects(closing.close('2026-10-25', { counted_cash: '349.50' }, staff), /reason for correcting/);
    assert.ok(fake.log.some(entry => entry.sql === 'ROLLBACK'));
    const saved = await closing.close('2026-10-25', { counted_cash: '349.50', note: 'Recounted' }, staff);
    assert.equal(saved.supersedes, 5);
    assert.ok(fake.log.some(entry => /SET status='superseded',active_key=NULL/.test(entry.sql)));
    assert.ok(!fake.log.some(entry => /DELETE FROM daily_closings/.test(entry.sql)));
  } finally { fake.restore(); }
});

test('a concurrent duplicate close is reported as a conflict', async () => {
  const fake = fakeDb([[/FOR UPDATE/, [[]]], ...summaryHandlers(), [/INSERT INTO daily_closings/, () => { throw Object.assign(new Error('dup'), { code: '23505' }); }]]);
  try {
    await assert.rejects(closing.close('2026-10-25', { counted_cash: '349.50' }, staff), { status: 409 });
  } finally { fake.restore(); }
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const policy = require('../services/bookings/cancellation-policy');

// In-memory transactional adapter: exercises service behavior without connecting
// to a developer's/live database. Real MySQL DDL still needs a staging smoke test.
function fixture() {
  let state = {
    booking: { id: 1, slot_id: 1, booking_date: '2099-10-10', start_time: '18:00', price: 2000, amount_paid: 500, status: 'approved', payment_status: 'partially_paid', cancellation_policy_version: policy.VERSION },
    plan: { status: 'active' },
    cancellation: null,
    payment: { id: 1, booking_id: 1, amount: 250, currency: 'BDT', status: 'initiated' },
    settlements: []
  };
  let snapshot;
  let failUpdate = false;
  const connection = {
    async beginTransaction() { snapshot = structuredClone(state); },
    async commit() {},
    async rollback() { state = snapshot; },
    async query(sql, args) {
      if (sql.startsWith('SELECT status FROM recurring_bookings')) return [[{ ...state.plan }]];
      if (sql.startsWith('SELECT b.*')) return [[{ ...state.booking }]];
      if (sql.startsWith('SELECT * FROM booking_cancellations')) return [[...(state.cancellation ? [{ ...state.cancellation }] : [])]];
      if (sql.startsWith('SELECT * FROM payment_transactions')) return [[{ ...state.payment }]];
      if (sql.startsWith('SELECT id FROM refund_settlements')) return [[...state.settlements.filter(s => s.reference === args[0])]];
      if (sql.startsWith('SELECT id FROM refund_payouts')) return [[]];
      if (sql.startsWith('INSERT INTO booking_cancellations')) {
        if (sql.includes('ON DUPLICATE KEY')) {
          state.cancellation.refund_amount += args[1];
        } else {
          state.cancellation = { booking_id: args[0], policy_version: args[1], source: args[2], reason: args[3], refund_percent: args[4], amount_paid_at_cancellation: args[5], refund_amount: args[6], refunded_amount: 0 };
        }
      } else if (sql.startsWith("UPDATE bookings SET status = 'cancelled'")) {
        if (failUpdate) throw new Error('Simulated database failure');
        state.booking.status = 'cancelled';
      } else if (sql.startsWith('INSERT INTO refund_settlements')) {
        state.settlements.push({ booking_id: args[0], amount: args[1], reference: args[2] });
      } else if (sql.startsWith('UPDATE booking_cancellations')) {
        state.cancellation.refunded_amount += args[0];
      } else if (sql.startsWith('UPDATE refund_payouts')) {
        return [{ affectedRows: 1 }];
      } else if (sql.startsWith('UPDATE payment_transactions')) {
        state.payment.status = 'valid';
      } else if (sql.startsWith('UPDATE bookings SET amount_paid')) {
        state.booking.amount_paid = args[0]; state.booking.payment_status = args[1]; state.booking.status = args[3];
      } else throw new Error(`Unhandled test query: ${sql}`);
      return [{ affectedRows: 1 }];
    }
  };
  const db = { cancellationReady: true, getConnection(cb) { cb(null, { promise: () => connection, release() {} }); } };
  const dependencies = {
    '../payments/refund-payout.service': { queueForCancellation: async () => ({ queued_amount: 0, manual_amount: 500 }) },
    '../notifications/outbox.service': { transition: async () => {}, gateway: async () => {} },
    '../collections/collection.service': { gateway: async () => {} }
  };
  const sandbox = { module: { exports: {} }, require: name => name === '../../database' ? db : dependencies[name] || policy, console };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../services/bookings/cancellation.service.js'), 'utf8'), sandbox);
  return { service: sandbox.module.exports, state: () => state, failUpdate: () => failUpdate = true };
}
const validation = { status: 'VALID', amount: 250, currency: 'BDT', val_id: 'verified', tran_id: 'txn' };

test('cancellation releases booking, records liability and leaves unsupported refund methods for manual settlement', async () => {
  const f = fixture();
  await f.service.cancel(1, 'customer', 'Customer cannot attend', 2);
  assert.equal(f.state().booking.status, 'cancelled');
  assert.equal(f.state().cancellation.refund_amount, 500);
  assert.equal(f.state().cancellation.refunded_amount, 0);
  assert.equal((await f.service.cancel(1, 'customer', 'Retry', 2)).already_cancelled, true);
  assert.equal(f.state().cancellation.refund_amount, 500);
});
test('preview has no mutation', async () => {
  const f = fixture();
  assert.equal((await f.service.cancel(1, 'venue', '', 2, true)).refund_amount, 500);
  assert.equal(f.state().cancellation, null);
  assert.equal(f.state().booking.status, 'approved');
});
test('failed cancellation rolls back liability as well as booking status', async () => {
  const f = fixture(); f.failUpdate();
  await assert.rejects(f.service.cancel(1, 'customer', 'Reason', 2));
  assert.equal(f.state().cancellation, null);
  assert.equal(f.state().booking.status, 'approved');
});
test('refund completion requires reference and the amount actually returned', async () => {
  const f = fixture(); await f.service.cancel(1, 'venue', 'Closed', 2);
  await assert.rejects(f.service.recordRefund(1, '', 500, 2));
  await assert.rejects(f.service.recordRefund(1, 'bank-ref', 250, 2));
  assert.equal(f.state().cancellation.refunded_amount, 0);
  await f.service.recordRefund(1, 'bank-ref', 500, 2);
  await f.service.recordRefund(1, 'bank-ref', 500, 2);
  assert.equal(f.state().settlements.length, 1);
  assert.equal(f.state().cancellation.refunded_amount, 500);
});
test('late payment cannot reopen a cancelled booking and creates an additional full refund only once', async () => {
  const f = fixture(); await f.service.cancel(1, 'venue', 'Closed', 2);
  await f.service.recordRefund(1, 'first-refund', 500, 2);
  await f.service.creditValidatedPayment(1, 1, validation, 500);
  await f.service.creditValidatedPayment(1, 1, validation, 500);
  assert.equal(f.state().booking.status, 'cancelled');
  assert.equal(f.state().booking.amount_paid, 750);
  assert.equal(f.state().cancellation.refund_amount, 750);
  assert.equal(f.state().cancellation.refunded_amount, 500);
});
test('duplicate valid callback credits an active booking once', async () => {
  const f = fixture();
  await f.service.creditValidatedPayment(1, 1, validation, 500);
  await f.service.creditValidatedPayment(1, 1, validation, 500);
  assert.equal(f.state().booking.amount_paid, 750);
  assert.equal(f.state().booking.status, 'approved');
});
test('invalid payment currency does not mutate the booking', async () => {
  const f = fixture();
  await assert.rejects(f.service.creditValidatedPayment(1, 1, { ...validation, currency: 'USD' }, 500));
  assert.equal(f.state().booking.amount_paid, 500);
  assert.equal(f.state().payment.status, 'initiated');
});
test('season plans and inconsistent paid records require manual review', async () => {
  const f = fixture(); f.state().booking.recurring_booking_id = 4;
  await assert.rejects(f.service.cancel(1, 'customer', 'Reason', 2));
  f.state().booking.recurring_booking_id = null;
  f.state().booking.payment_status = 'paid'; f.state().booking.amount_paid = 0;
  await assert.rejects(f.service.cancel(1, 'customer', 'Reason', 2));
});

for (const status of ['paused', 'cancelled', 'expired']) {
  test(`individual season occurrence can be cancelled after plan is ${status}`, async () => {
    const f = fixture();
    f.state().booking.recurring_booking_id = 4;
    f.state().plan.status = status;
    const preview = await f.service.cancel(1, 'customer', '', 2, true);
    assert.equal(preview.refund_amount, 500);
    await f.service.cancel(1, 'customer', 'Cancel individual occurrence', 2);
    assert.equal(f.state().booking.status, 'cancelled');
    assert.equal(f.state().plan.status, status);
    assert.equal(f.state().cancellation.refund_amount, 500);
  });
}

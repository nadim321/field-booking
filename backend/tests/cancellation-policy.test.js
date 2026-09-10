const { test } = require('node:test');
const assert = require('node:assert/strict');
const { VERSION, quoteCancellation } = require('../services/bookings/cancellation-policy');
const booking = { booking_date: '2026-10-10', start_time: '18:00', amount_paid: '500.00', cancellation_policy_version: VERSION };
const kickoff = Date.parse('2026-10-10T12:00:00Z');
for (const [hours, percent, refund] of [[72, 100, 500], [48, 100, 500], [47.999, 50, 250], [24, 50, 250], [23.999, 25, 125], [1, 25, 125], [0.001, 25, 125], [0, 0, 0], [-1, 0, 0]]) {
  test(`customer cancellation ${hours} hours before kickoff refunds ${percent}%`, () => {
    const result = quoteCancellation(booking, 'customer', new Date(kickoff - hours * 3600000));
    assert.equal(result.refund_percent, percent);
    assert.equal(result.refund_amount, refund);
  });
}
test('venue cancellation returns all money received even after kickoff', () => {
  assert.equal(quoteCancellation(booking, 'venue', new Date(kickoff + 1)).refund_amount, 500);
});
test('unpaid booking never creates a refund liability', () => {
  assert.equal(quoteCancellation({ ...booking, amount_paid: 0 }, 'venue').refund_amount, 0);
});
test('refund uses the paid advance, not the total slot price, and rounds to paisa', () => {
  assert.equal(quoteCancellation({ ...booking, amount_paid: '125.55', price: 5000 }, 'customer', new Date(kickoff - 24 * 3600000)).refund_amount, 62.78);
});
test('legacy bookings do not receive retroactive penalties', () => {
  assert.equal(quoteCancellation({ ...booking, cancellation_policy_version: null }, 'customer', new Date(kickoff)).refund_amount, 500);
});
test('midnight kickoff is interpreted in Bangladesh time', () => {
  const result = quoteCancellation({ ...booking, start_time: '00:00' }, 'customer', new Date('2026-10-07T18:00:00Z'));
  assert.equal(result.kickoff, '2026-10-09T18:00:00.000Z');
  assert.equal(result.refund_percent, 100);
});
test('invalid data or unknown policy never silently applies a refund', () => {
  assert.throws(() => quoteCancellation({ ...booking, amount_paid: 'bad' }));
  assert.throws(() => quoteCancellation({ ...booking, booking_date: 'bad' }));
  assert.throws(() => quoteCancellation({ ...booking, cancellation_policy_version: 'future' }));
  assert.throws(() => quoteCancellation(booking, 'invalid'));
});

test('existing v1 bookings receive the improved short-notice refund', () => {
  const result = quoteCancellation({ ...booking, cancellation_policy_version: '2026-09-10-v1' }, 'customer', new Date(kickoff - 3600000));
  assert.equal(result.refund_percent, 25);
  assert.equal(result.refund_amount, 125);
  assert.equal(result.policy_version, VERSION);
});
test('25 percent short-notice refund rounds to paisa', () => {
  assert.equal(quoteCancellation({ ...booking, amount_paid: '125.55' }, 'customer', new Date(kickoff - 3600000)).refund_amount, 31.39);
});

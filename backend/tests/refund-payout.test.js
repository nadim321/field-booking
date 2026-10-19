const { test } = require('node:test');
const assert = require('node:assert/strict');
const { queueForCancellation } = require('../services/payments/refund-payout.service');

test('automatic refund liability is split across captured SSLCOMMERZ transactions', async () => {
  const inserted = [];
  const connection = { async query(sql, args) {
    if (sql.startsWith('SELECT id, amount, bank_tran_id')) return [[
      { id: 11, amount: '100.00', bank_tran_id: 'bank-a' },
      { id: 12, amount: '75.00', bank_tran_id: 'bank-b' }
    ]];
    if (sql.startsWith('INSERT IGNORE INTO refund_payouts')) { inserted.push(args); return [{ insertId: inserted.length }]; }
    throw new Error(`Unexpected payout query: ${sql}`);
  } };
  const result = await queueForCancellation(connection, 4, 125, 'Closed');
  assert.deepEqual(result, { queued_amount: 125, manual_amount: 0, reason: 'Closed' });
  assert.deepEqual(inserted.map(row => [row[1], row[2]]), [[11, 100], [12, 25]]);
  assert.ok(inserted.every(row => /^RF4_[a-f0-9]{16}$/.test(row[3])));
});

test('refund amount beyond captured gateway payments stays on the manual path', async () => {
  const connection = { async query(sql) {
    if (sql.startsWith('SELECT id, amount, bank_tran_id')) return [[{ id: 11, amount: '20.00', bank_tran_id: 'bank-a' }]];
    return [{ insertId: 1 }];
  } };
  const result = await queueForCancellation(connection, 4, 50, 'Venue closure');
  assert.equal(result.queued_amount, 20);
  assert.equal(result.manual_amount, 30);
});

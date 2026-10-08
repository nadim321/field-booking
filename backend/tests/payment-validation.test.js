const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function fixture(validation) {
  let credits = 0;
  const sandbox = { module: { exports: {} }, require(name) {
    if (name.endsWith('settings.service')) return { getAdvancePaymentPercentage: async () => 25 };
    if (name.endsWith('sslcommerz.provider')) return { validateTransaction: async () => validation };
    if (name.endsWith('cancellation.service')) return { creditValidatedPayment: async () => { credits++; return { ok: true, bookingId: 1 }; } };
    if (name.endsWith('notification.service')) return { notifyAdvancePaymentConfirmed() {} };
    if (name.endsWith('db-async')) return { dbGetAsync: async sql => sql.includes('payment_transactions') ? { id: 1, booking_id: 1, amount: '500', currency: 'BDT' } : { id: 1, price: 2000 } };
    throw new Error('Unexpected dependency');
  } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../services/payments/payment.service.js'), 'utf8'), sandbox);
  return { service: sandbox.module.exports, credits: () => credits };
}
for (const validation of [null, { tran_id: 't', status: 'FAILED', amount: 500, currency: 'BDT' }, { tran_id: 't', status: 'VALID', amount: 1, currency: 'BDT' }, { tran_id: 't', status: 'VALID', amount: 500, currency: 'USD' }, { tran_id: 't', status: 'VALID', amount: 'bad', currency: 'BDT' }]) {
  test(`reject invalid gateway validation: ${JSON.stringify(validation)}`, async () => {
    const f = fixture(validation);
    assert.equal((await f.service.confirmPaymentByValId('v')).ok, false);
    assert.equal(f.credits(), 0);
  });
}
test('validated amount and currency reach the transactional payment service', async () => {
  const f = fixture({ tran_id: 't', status: 'VALID', amount: 500, currency: 'BDT' });
  assert.equal((await f.service.confirmPaymentByValId('v')).ok, true);
  assert.equal(f.credits(), 1);
});

const db = require('../database');
const { reconcile, response } = require('../services/payments/attempt.service');

async function main() {
  const [flag, tranId, extra] = process.argv.slice(2);
  if (flag !== '--transaction' || !/^[A-Za-z0-9_-]{1,100}$/.test(tranId || '') || extra) {
    throw new Error('Usage: npm run payment:reconcile -- --transaction TRANSACTION_ID');
  }
  try {
    // Operator tool never applies migrations implicitly or creates a payment session.
    await db.initialize({ migrate: false });
    const attempt = await reconcile(tranId);
    if (!attempt) throw new Error('Transaction not found');
    const result = response(attempt);
    console.log(JSON.stringify({ transaction: tranId, booking_id: attempt.booking_id, state: result.state, retryable: result.retryable || false }));
    if (!['paid', 'failed', 'cancelled', 'expired'].includes(result.state)) {
      console.log('Not resolved. Check the provider merchant dashboard; do not initiate another charge or manually clear the lock.');
      process.exitCode = 2;
    }
  } finally { await db.close(); }
}
if (require.main === module) main().catch(error => {
  console.error('Payment reconciliation failed:', error.code || 'CHECK_CONFIGURATION_OR_PROVIDER');
  process.exitCode = 1;
});
module.exports = { main };

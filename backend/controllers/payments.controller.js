const provider = require('../services/payments/sslcommerz.provider');
const attempts = require('../services/payments/attempt.service');
const { confirmPaymentByValId } = require('../services/payments/payment.service');
const { dbRunAsync } = require('../utils/db-async');
const { reportError } = require('../middleware/observability');

exports.initiate = async (req, res) => {
  const result = await attempts.initiate(req.body.booking_id, req.get('Idempotency-Key'));
  if (result.state === 'initializing') res.set('Retry-After', '3');
  res.status(result.state === 'initializing' ? 202 : 200).json(result);
};

exports.ipn = async (req, res, next) => {
  if (!provider.verifyIpnSignature(req.body)) return res.status(400).send('Invalid notification');
  try {
    if (req.body.val_id) {
      const result = await confirmPaymentByValId(req.body.val_id, 'ipn');
      if (!result.ok) return res.status(400).send('Validation failed');
    } else {
      await attempts.reconcile(req.body.tran_id);
    }
    if (req.body.tran_id) await dbRunAsync('UPDATE payment_transactions SET raw_ipn_payload = ? WHERE tran_id = ?', [JSON.stringify(req.body), req.body.tran_id]);
    res.status(200).send('OK');
  } catch (error) { next(error); }
};

function redirect(res, bookingId, outcome) {
  const url = new URL(process.env.FRONTEND_URL || 'http://localhost:4200');
  url.searchParams.set('payment', outcome);
  if (bookingId) url.searchParams.set('booking_id', String(bookingId));
  return res.redirect(url.toString());
}

exports.success = async (req, res) => {
  try {
    const valId = req.body.val_id || req.query.val_id;
    if (!valId) return redirect(res, null, 'error');
    const result = await confirmPaymentByValId(valId, 'success_redirect');
    return redirect(res, result.bookingId, result.ok ? 'success' : 'error');
  } catch (error) {
    reportError(error, req);
    return redirect(res, null, 'error');
  }
};

async function terminalRedirect(req, res) {
  try {
    // Callback claims alone never change payment state or trigger failure notifications.
    const verified = await attempts.reconcile(req.body.tran_id || req.query.tran_id);
    return redirect(res, verified?.booking_id, 'check');
  } catch (error) {
    reportError(error, req);
    return redirect(res, null, 'error');
  }
}
exports.fail = terminalRedirect;
exports.cancel = terminalRedirect;

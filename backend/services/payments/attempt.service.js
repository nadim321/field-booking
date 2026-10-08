const { transaction, getBooking } = require('../bookings/cancellation.service');
const { dbGetAsync, dbRunAsync } = require('../../utils/db-async');
const { computeRequiredAdvance, confirmPaymentByValId } = require('./payment.service');
const provider = require('./sslcommerz.provider');
const { paymentPublicBaseUrl } = require('../../config/env');

const failure = (message, status = 409) => Object.assign(new Error(message), { status });
const TERMINAL = ['failed', 'cancelled', 'expired'];
function response(attempt) {
  const base = { tran_id: attempt.tran_id, amount: Number(attempt.amount) };
  if (attempt.status === 'valid') return { ...base, state: 'paid' };
  if (attempt.terminal_verified && TERMINAL.includes(attempt.status)) return { ...base, state: attempt.status, retryable: true };
  if (attempt.initialization_state === 'ready' && attempt.gateway_url) return { ...base, state: 'ready', gateway_page_url: attempt.gateway_url };
  if (attempt.initialization_state === 'starting' && Number(attempt.age_seconds) < 30) return { ...base, state: 'initializing', retry_after: 3 };
  return { ...base, state: 'verification_needed', retryable: false };
}
async function readAttempt(id) {
  return dbGetAsync('SELECT *, TIMESTAMPDIFF(SECOND, started_at, UTC_TIMESTAMP()) AS age_seconds FROM payment_transactions WHERE id = ?', [id]);
}

async function initiate(bookingId, key) {
  if (!Number.isSafeInteger(Number(bookingId)) || Number(bookingId) <= 0) throw failure('A valid booking ID is required', 400);
  if (key !== undefined && (typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(key))) throw failure('Invalid Idempotency-Key', 400);
  const reserved = await transaction(async connection => {
    const booking = await getBooking(connection, Number(bookingId));
    if (booking.status === 'cancelled') throw failure('This booking has been cancelled');
    if (key) {
      const [[existing]] = await connection.query('SELECT payment_id FROM payment_attempt_keys WHERE booking_id = ? AND request_key = ?', [booking.id, key]);
      if (existing) return { id: existing.payment_id };
    }
    const requiredAdvance = await computeRequiredAdvance(booking.price);
    const amount = Math.round(Math.max(requiredAdvance - Number(booking.amount_paid || 0), 0) * 100) / 100;
    if (amount === 0 || booking.payment_status === 'paid') return { paid: true };
    if (amount < 10) throw failure('Remaining payable amount is below the gateway minimum', 400);
    const [[active]] = await connection.query("SELECT id FROM payment_transactions WHERE booking_id = ? AND status <> 'valid' AND terminal_verified = FALSE ORDER BY id DESC LIMIT 1 FOR UPDATE", [booking.id]);
    let id = active?.id;
    let tranId;
    if (!id) {
      tranId = provider.generateTranId(booking.id);
      const [inserted] = await connection.query("INSERT INTO payment_transactions (booking_id, tran_id, amount, currency, status, initialization_state, started_at) VALUES (?, ?, ?, 'BDT', 'initiated', 'starting', UTC_TIMESTAMP())", [booking.id, tranId, amount]);
      id = inserted.insertId;
    }
    if (key) await connection.query('INSERT INTO payment_attempt_keys (booking_id, request_key, payment_id) VALUES (?, ?, ?)', [booking.id, key, id]);
    return { id, create: !active, booking, amount, requiredAdvance, tranId };
  });
  if (reserved.paid) return { state: 'paid' };
  if (!reserved.create) return response(await readAttempt(reserved.id));
  const { booking, amount, tranId } = reserved;
  // Persist the reservation before contacting the gateway; never hold DB locks across network I/O.
  try {
    const gateway = await provider.initiateSession({
      tran_id: tranId, amount, booking_id: booking.id,
      customer_name: booking.customer_name, customer_phone: booking.customer_phone, customer_email: booking.customer_email,
      product_name: `Turf booking ${booking.id}`,
      ...Object.fromEntries(['success', 'fail', 'cancel', 'ipn'].map(name => [`${name}_url`, `${paymentPublicBaseUrl}/api/payments/${name}`]))
    });
    if (gateway?.status === 'FAILED') {
      await dbRunAsync("UPDATE payment_transactions SET status = 'failed', terminal_verified = TRUE, initialization_state = 'terminal' WHERE id = ? AND status <> 'valid'", [reserved.id]);
    } else if (gateway?.status === 'SUCCESS' && provider.isGatewayUrl(gateway.GatewayPageURL)) {
      await dbRunAsync("UPDATE payment_transactions SET initialization_state = 'ready', gateway_url = ?, gateway_session = ? WHERE id = ? AND status <> 'valid' AND terminal_verified = FALSE", [gateway.GatewayPageURL, gateway.sessionkey || null, reserved.id]);
    } else {
      throw new Error('Ambiguous payment initialization response');
    }
  } catch (error) {
    await dbRunAsync("UPDATE payment_transactions SET initialization_state = 'unknown' WHERE id = ? AND initialization_state = 'starting'", [reserved.id]);
    throw error; // central reporting retains original stack; retry reuses the persisted attempt
  }
  return { ...response(await readAttempt(reserved.id)), required_advance: reserved.requiredAdvance };
}

async function reconcile(tranId) {
  if (typeof tranId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(tranId)) return null;
  const local = await dbGetAsync('SELECT * FROM payment_transactions WHERE tran_id = ?', [tranId]);
  if (!local || local.status === 'valid') return local;
  const result = await provider.queryTransaction(tranId);
  const matches = Array.isArray(result?.element) ? result.element.filter(row => row.tran_id === tranId) : [];
  // Ambiguous/multiple results are retained for staff reconciliation, never turned into a new charge.
  if (matches.length !== 1) return local;
  const verified = matches[0];
  if (Math.abs(Number(verified.amount) - Number(local.amount)) > 0.01 || !Number.isFinite(Number(verified.amount)) || verified.currency !== local.currency) return local;
  if (['VALID', 'VALIDATED'].includes(verified.status) && verified.val_id) {
    await confirmPaymentByValId(verified.val_id, 'reconciliation');
  } else if (['FAILED', 'CANCELLED', 'EXPIRED'].includes(verified.status)) {
    await transaction(async connection => {
      await getBooking(connection, local.booking_id);
      await connection.query("UPDATE payment_transactions SET status = ?, terminal_verified = TRUE, initialization_state = 'terminal' WHERE id = ? AND status <> 'valid'", [verified.status.toLowerCase(), local.id]);
    });
  }
  return readAttempt(local.id);
}
module.exports = { initiate, reconcile, response };

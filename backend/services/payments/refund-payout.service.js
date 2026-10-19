const crypto = require('node:crypto');
const db = require('../../database');
const sslcommerz = require('./sslcommerz.provider');

const RETRY_MS = [60_000, 300_000, 900_000, 3_600_000];
const POLL_MS = 5 * 60_000;
const LEASE_MS = 60_000;
function fail(message, status = 409) { return Object.assign(new Error(message), { status }); }

async function queueForCancellation(connection, bookingId, refundAmount, reason) {
  let remaining = Math.round(Number(refundAmount) * 100);
  if (remaining <= 0) return { queued_amount: 0, manual_amount: 0 };
  const [payments] = await connection.query(`SELECT id, amount, bank_tran_id FROM payment_transactions
    WHERE booking_id=? AND status='valid' AND bank_tran_id IS NOT NULL ORDER BY id`, [bookingId]);
  let queued = 0;
  for (const payment of payments) {
    const cents = Math.min(remaining, Math.round(Number(payment.amount) * 100));
    if (cents <= 0) continue;
    const refundTransId = `RF${bookingId}_${crypto.randomBytes(8).toString('hex')}`;
    await connection.query(`INSERT IGNORE INTO refund_payouts
      (booking_id,payment_transaction_id,amount,refund_trans_id,status,next_attempt_at)
      VALUES (?,?,?,?, 'pending', CURRENT_TIMESTAMP)`, [bookingId, payment.id, cents / 100, refundTransId]);
    queued += cents;
    remaining -= cents;
    if (remaining <= 0) break;
  }
  return { queued_amount: queued / 100, manual_amount: remaining / 100, reason: reason || null };
}

async function transaction(work) {
  const connection = await db.promiseConnection();
  try { await connection.beginTransaction(); const result = await work(connection); await connection.commit(); return result; }
  catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

async function claimDue(now = Date.now()) {
  return transaction(async connection => {
    const [rows] = await connection.query(`SELECT * FROM refund_payouts
      WHERE status IN ('pending','retrying','initiating','submitted')
        AND next_attempt_at<=CURRENT_TIMESTAMP AND (lease_until IS NULL OR lease_until<=CURRENT_TIMESTAMP)
      ORDER BY id LIMIT 20 FOR UPDATE SKIP LOCKED`);
    const claimed = [];
    for (const row of rows) {
      const token = crypto.randomUUID();
      await connection.query('UPDATE refund_payouts SET lease_token=?,lease_until=?,attempts=attempts+1,updated_at=? WHERE id=?',
        [token, new Date(now + LEASE_MS), new Date(now), row.id]);
      claimed.push({ ...row, lease_token: token });
    }
    return claimed;
  });
}

async function setState(job, values, now = Date.now()) {
  await transaction(async connection => {
    await connection.query(`UPDATE refund_payouts SET status=?,provider_ref=COALESCE(?,provider_ref),
      next_attempt_at=?,last_error=?,lease_token=NULL,lease_until=NULL,updated_at=?
      WHERE id=? AND lease_token=?`, [values.status, values.provider_ref || null, new Date(now + (values.delay || 0)),
      values.error || null, new Date(now), job.id, job.lease_token]);
  });
}

async function settle(job, providerResult, now = Date.now()) {
  await transaction(async connection => {
    await connection.query('SELECT id FROM bookings WHERE id=? FOR UPDATE', [job.booking_id]);
    const [[current]] = await connection.query('SELECT * FROM refund_payouts WHERE id=? FOR UPDATE', [job.id]);
    if (!current || current.status === 'refunded' || current.lease_token !== job.lease_token) return;
    const [[cancellation]] = await connection.query('SELECT * FROM booking_cancellations WHERE booking_id=? FOR UPDATE', [current.booking_id]);
    if (!cancellation) throw fail('Cancellation record missing for refund payout');
    const reference = `SSLCOMMERZ-${providerResult.refund_ref_id || current.provider_ref}`;
    const [[existing]] = await connection.query('SELECT id FROM refund_settlements WHERE reference=?', [reference]);
    if (!existing) {
      await connection.query('INSERT INTO refund_settlements (booking_id,amount,reference,recorded_by) VALUES (?,?,?,0)', [current.booking_id, current.amount, reference]);
      await connection.query(`UPDATE booking_cancellations SET refunded_amount=LEAST(refund_amount,refunded_amount+?) WHERE booking_id=?`, [current.amount, current.booking_id]);
    }
    await connection.query(`UPDATE refund_payouts SET status='refunded',provider_ref=COALESCE(?,provider_ref),
      last_error=NULL,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?`, [providerResult.refund_ref_id || null, new Date(now), current.id]);
  });
}

async function processJob(job, { provider = sslcommerz, now = Date.now() } = {}) {
  try {
    if (job.status === 'submitted' && job.provider_ref) {
      const result = await provider.queryRefund(job.provider_ref);
      if (['refunded', 'cancelled'].includes(result.status)) return settle(job, result, now);
      if (result.status === 'processing') return setState(job, { status: 'submitted', provider_ref: job.provider_ref, delay: POLL_MS }, now);
      return setState(job, { status: 'manual_required', provider_ref: job.provider_ref, error: `GATEWAY_${String(result.status || 'UNKNOWN').toUpperCase()}` }, now);
    }

    const connection = await db.promiseConnection();
    let payment, cancellation;
    try {
      [[payment]] = await connection.query('SELECT p.bank_tran_id,c.reason FROM payment_transactions p JOIN booking_cancellations c ON c.booking_id=p.booking_id WHERE p.id=?', [job.payment_transaction_id]);
    } finally { connection.release(); }
    if (!payment?.bank_tran_id) return setState(job, { status: 'manual_required', error: 'BANK_REFERENCE_MISSING' }, now);
    cancellation = payment.reason;
    const result = await provider.initiateRefund({ bankTranId: payment.bank_tran_id, refundTransId: job.refund_trans_id,
      amount: job.amount, remarks: cancellation || 'Booking cancellation refund', reference: `booking-${job.booking_id}` });
    if (['success', 'processing'].includes(result.status) && result.refund_ref_id) {
      return setState(job, { status: 'submitted', provider_ref: result.refund_ref_id, delay: POLL_MS }, now);
    }
    if (result.status === 'refunded') return settle(job, result, now);
    if (result.status === 'failed') return setState(job, { status: 'manual_required', error: 'GATEWAY_REJECTED' }, now);
    throw new Error('Unexpected gateway refund status');
  } catch {
    const nextAttempt = Number(job.attempts || 0);
    if (job.status === 'submitted') return setState(job, { status: 'submitted', provider_ref: job.provider_ref, delay: POLL_MS, error: 'PROVIDER_UNAVAILABLE' }, now);
    const status = nextAttempt >= RETRY_MS.length ? 'manual_required' : 'retrying';
    return setState(job, { status, delay: RETRY_MS[Math.min(nextAttempt, RETRY_MS.length - 1)], error: 'PROVIDER_UNAVAILABLE' }, now);
  }
}

async function runOnce({ now = Date.now(), provider = sslcommerz } = {}) {
  const jobs = await claimDue(now);
  for (const job of jobs) await processJob(job, { now, provider });
}

let interval;
let running;
async function stop() { clearInterval(interval); interval = null; if (running) await running; }
function start() {
  if (interval) return;
  const tick = () => {
    if (running) return;
    running = runOnce().catch(() => {}).finally(() => { running = null; });
  };
  tick(); interval = setInterval(tick, 30_000);
}

module.exports = { queueForCancellation, claimDue, processJob, runOnce, start, stop, RETRY_MS, POLL_MS };

const { createHash, timingSafeEqual } = require('node:crypto');
const db = require('../../database');
const logger = require('../../utils/logger');

const DAY_MS = 86400000;
// Provider vocabularies differ, so receipts are normalised to two outcomes.
const DELIVERED = new Set(['delivered', 'delivrd', 'success']);
const NOT_DELIVERED = new Set(['failed', 'undelivered', 'undeliv', 'rejected', 'expired']);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

/** GSM-7 style messages fit 160 chars (153 when split); anything else, e.g. Bangla, is UCS-2: 70 (67). */
function segments(message) {
  const text = String(message ?? '');
  const length = [...text].length;
  const unicode = /[^\x20-\x7E\n\r]/.test(text);
  const [single, multi] = unicode ? [70, 67] : [160, 153];
  const units = length === 0 ? 1 : length <= single ? 1 : Math.ceil(length / multi);
  return { units, encoding: unicode ? 'ucs2' : 'gsm7', length };
}

/** Estimated per-SMS price in BDT from SMS_UNIT_COST_BDT; null when not configured. */
function unitCost(env = process.env) {
  const raw = env.SMS_UNIT_COST_BDT;
  if (raw === undefined || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value < 1000 ? value : null;
}

function statusFor(result) {
  if (result?.success === true && result?.providerResponse?.mock === true) return 'simulated';
  return result?.success === true ? 'accepted' : 'failed';
}

function safeMessageId(value) {
  const text = value === undefined || value === null ? '' : String(value);
  return /^[\w.:-]{1,190}$/.test(text) ? text : null;
}

/**
 * Logs one provider call. Never throws: a logging problem must not block an OTP or booking SMS.
 * The recipient and message text are deliberately not stored.
 */
async function record({ purpose, provider, result, message, jobId = null, now = Date.now() }) {
  try {
    const status = statusFor(result);
    const { units } = segments(message);
    const price = status === 'accepted' ? unitCost() : null;
    const connection = await db.promiseConnection();
    try {
      await connection.query(`INSERT INTO sms_usage_log
        (purpose,provider,status,units,unit_cost,provider_message_id,job_id,created_at) VALUES (?,?,?,?,?,?,?,?)`,
      [purpose, provider, status, units, price, safeMessageId(result?.providerMessageId), jobId, now]);
    } finally { connection.release(); }
  } catch { logger.error('sms_usage_record_failed', { code: 'SMS_USAGE_LOG' }); }
}

function secretMatches(supplied, expected) {
  if (!expected || typeof supplied !== 'string') return false;
  const a = createHash('sha256').update(supplied).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

function normalizeReceipt(receipt) {
  const id = safeMessageId(receipt?.message_id);
  const raw = String(receipt?.status || '').trim().toLowerCase();
  if (!id) throw fail('Each receipt needs a valid message_id');
  if (!DELIVERED.has(raw) && !NOT_DELIVERED.has(raw)) throw fail('Unsupported delivery status');
  return { id, status: DELIVERED.has(raw) ? 'delivered' : 'failed' };
}

/** Applies provider delivery receipts. Repeats are harmless; a delivered receipt is never downgraded. */
async function applyReceipts(receipts, now = Date.now()) {
  if (!Array.isArray(receipts) || receipts.length < 1 || receipts.length > 100) throw fail('Send between 1 and 100 receipts');
  const parsed = receipts.map(normalizeReceipt);
  const connection = await db.promiseConnection();
  let matched = 0;
  try {
    for (const { id, status } of parsed) {
      const guard = "AND (delivery_status IS NULL OR delivery_status<>'delivered')";
      const [jobs] = await connection.query(`UPDATE notification_jobs SET delivery_status=?,delivery_updated_at=? WHERE provider_message_id=? ${guard}`, [status, now, id]);
      const [usage] = await connection.query(`UPDATE sms_usage_log SET delivery_status=?,delivery_updated_at=? WHERE provider_message_id=? ${guard}`, [status, now, id]);
      if (jobs.affectedRows > 0 || usage.affectedRows > 0) matched += 1;
      else {
        // Distinguish "already delivered" and "unknown id" so providers can be told apart in logs.
        const [[known]] = await connection.query('SELECT COUNT(*) AS total FROM sms_usage_log WHERE provider_message_id=?', [id]);
        if (Number(known.total) > 0) matched += 1;
      }
    }
  } finally { connection.release(); }
  return { received: parsed.length, matched, unmatched: parsed.length - matched };
}

function dateValue(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw fail('Invalid date');
  return value;
}

/** Usage and estimated cost for an Asia/Dhaka date range (inclusive). */
async function report(startInput, endInput) {
  const start = dateValue(startInput);
  const end = dateValue(endInput);
  if (start > end) throw fail('Start date must be on or before end date');
  const from = Date.parse(`${start}T00:00:00+06:00`);
  const to = Date.parse(`${end}T00:00:00+06:00`) + DAY_MS;
  if (to - from > 366 * DAY_MS) throw fail('Date range cannot exceed one year');
  const connection = await db.promiseConnection();
  try {
    const [rows] = await connection.query(`SELECT purpose,provider,status,delivery_status,COUNT(*) AS messages,
        COALESCE(SUM(units),0) AS units,COALESCE(SUM(units*unit_cost),0) AS estimated_cost
      FROM sms_usage_log WHERE created_at>=? AND created_at<? GROUP BY purpose,provider,status,delivery_status
      ORDER BY purpose,provider,status,delivery_status`, [from, to]);
    const totals = { messages: 0, units: 0, billable_units: 0, estimated_cost: 0, delivered: 0, delivery_failed: 0 };
    for (const row of rows) {
      totals.messages += Number(row.messages);
      totals.units += Number(row.units);
      if (row.status === 'accepted') {
        totals.billable_units += Number(row.units);
        totals.estimated_cost += Number(row.estimated_cost);
        if (row.delivery_status === 'delivered') totals.delivered += Number(row.messages);
        if (row.delivery_status === 'failed') totals.delivery_failed += Number(row.messages);
      }
    }
    totals.estimated_cost = Number(totals.estimated_cost.toFixed(4));
    return {
      start, end,
      unit_cost_configured: unitCost() !== null,
      note: 'Cost is an estimate: SMS_UNIT_COST_BDT × message parts for requests the provider accepted. Compare with the provider invoice. Simulated and failed sends are not counted as billable.',
      totals,
      rows: rows.map(row => ({ purpose: row.purpose, provider: row.provider, status: row.status, delivery_status: row.delivery_status,
        messages: Number(row.messages), units: Number(row.units), estimated_cost: Number(Number(row.estimated_cost).toFixed(4)) }))
    };
  } finally { connection.release(); }
}

module.exports = { segments, unitCost, statusFor, record, secretMatches, applyReceipts, report, safeMessageId, DELIVERED, NOT_DELIVERED };

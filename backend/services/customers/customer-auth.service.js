const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const db = require('../../database');
const { jwtSecret } = require('../../config/env');
const { otpProvider } = require('../notifications/providers/sms.provider');

const OTP_TTL_MS = 5 * 60 * 1000;
const PHONE_WINDOW_MS = 15 * 60 * 1000;
const IP_WINDOW_MS = 60 * 60 * 1000;
const RESEND_WAIT_MS = 60 * 1000;
const MAX_PHONE_SENDS = 3;
const MAX_IP_SENDS = 10;
const MAX_VERIFY_ATTEMPTS = 5;

function failure(message, status = 400) { return Object.assign(new Error(message), { status }); }
function normalizePhone(input) {
  const digits = String(input || '').replace(/[^\d]/g, '');
  let normalized;
  if (/^01[3-9]\d{8}$/.test(digits)) normalized = `+88${digits}`;
  else if (/^8801[3-9]\d{8}$/.test(digits)) normalized = `+${digits}`;
  else if (/^\+8801[3-9]\d{8}$/.test(String(input || '').replace(/[\s()-]/g, ''))) normalized = `+${digits}`;
  else throw failure('Enter a valid Bangladesh mobile number', 400);
  return normalized;
}
function phoneVariants(phone) {
  const local = phone.slice(3);
  return [...new Set([phone, phone.slice(1), local, `88${local.slice(1)}`])];
}
function codeHash(phone, code) { return crypto.createHmac('sha256', jwtSecret).update(`${phone}:${code}`).digest('hex'); }
function ipHash(ip) { return crypto.createHmac('sha256', jwtSecret).update(`otp-ip:${ip || 'unknown'}`).digest('hex'); }
function maskPhone(phone) { return `${phone.slice(0, 4)}${'*'.repeat(Math.max(0, phone.length - 8))}${phone.slice(-4)}`; }

async function requestOtp(inputPhone, ip, { provider = otpProvider, now = Date.now() } = {}) {
  const phone = normalizePhone(inputPhone);
  const hashedIp = ipHash(ip);
  const connection = await db.promiseConnection();
  let challengeId;
  try {
    await connection.query('DELETE FROM customer_otp_challenges WHERE created_at < ?', [new Date(now - 30 * 24 * 60 * 60 * 1000)]);
    const [phoneRecent] = await connection.query('SELECT COUNT(*) AS total FROM customer_otp_challenges WHERE phone_e164 = ? AND created_at >= ?', [phone, new Date(now - PHONE_WINDOW_MS)]);
    const [ipRecent] = await connection.query('SELECT COUNT(*) AS total FROM customer_otp_challenges WHERE ip_hash = ? AND created_at >= ?', [hashedIp, new Date(now - IP_WINDOW_MS)]);
    const [[latest]] = await connection.query('SELECT created_at FROM customer_otp_challenges WHERE phone_e164 = ? ORDER BY id DESC LIMIT 1', [phone]);
    if (Number(phoneRecent[0]?.total || 0) >= MAX_PHONE_SENDS || Number(ipRecent[0]?.total || 0) >= MAX_IP_SENDS) throw failure('Too many OTP requests. Try again later.', 429);
    if (latest && now - new Date(latest.created_at).getTime() < RESEND_WAIT_MS) throw failure('Wait before requesting another code.', 429);

    const code = String(crypto.randomInt(100000, 1000000));
    await connection.query('UPDATE customer_otp_challenges SET consumed_at = CURRENT_TIMESTAMP WHERE phone_e164 = ? AND consumed_at IS NULL', [phone]);
    const [insert] = await connection.query('INSERT INTO customer_otp_challenges (phone_e164, code_hash, ip_hash, expires_at) VALUES (?, ?, ?, ?)', [phone, codeHash(phone, code), hashedIp, new Date(now + OTP_TTL_MS)]);
    challengeId = insert.insertId;
    const logOtp = process.env.OTP_LOG_CODE === 'true';
    if (logOtp) {
      console.log(JSON.stringify({
        event: 'customer_otp',
        phone_masked: maskPhone(phone),
        code,
        expires_at: new Date(now + OTP_TTL_MS).toISOString()
      }));
    }
    let result;
    try {
      result = await provider.send({ to: phone, message: `Your Kickoff Arena verification code is ${code}. It expires in 5 minutes.`, idempotencyKey: `otp-${challengeId}` });
    } catch (error) {
      if (!logOtp) throw error;
      result = { success: false };
    }
    if (!result?.success && !logOtp) {
      await connection.query('UPDATE customer_otp_challenges SET consumed_at = CURRENT_TIMESTAMP WHERE id = ?', [challengeId]);
      throw failure('Could not send the verification code. Try again later.', 503);
    }
    return { message: 'Verification code sent', expires_in: Math.floor(OTP_TTL_MS / 1000),
      ...(process.env.NODE_ENV !== 'production' && process.env.OTP_DEBUG_CODE === 'true' ? { debug_code: code } : {}) };
  } finally { connection.release(); }
}

async function verifyOtp(inputPhone, inputCode, { now = Date.now() } = {}) {
  const phone = normalizePhone(inputPhone);
  const code = String(inputCode || '').trim();
  if (!/^\d{6}$/.test(code)) throw failure('Enter the 6-digit verification code', 400);
  const connection = await db.promiseConnection();
  try {
    await connection.beginTransaction();
    const [[challenge]] = await connection.query(`SELECT * FROM customer_otp_challenges
      WHERE phone_e164 = ? AND consumed_at IS NULL AND expires_at > ? ORDER BY id DESC LIMIT 1 FOR UPDATE`, [phone, new Date(now)]);
    if (!challenge) throw failure('Code expired or not found. Request a new code.', 400);
    if (Number(challenge.attempts) >= MAX_VERIFY_ATTEMPTS) throw failure('Too many incorrect codes. Request a new code.', 429);
    const supplied = Buffer.from(codeHash(phone, code), 'hex');
    const expected = Buffer.from(challenge.code_hash, 'hex');
    const matches = supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
    if (!matches) {
      const attempts = Number(challenge.attempts) + 1;
      await connection.query('UPDATE customer_otp_challenges SET attempts = ?, consumed_at = ? WHERE id = ?', [attempts, attempts >= MAX_VERIFY_ATTEMPTS ? new Date(now) : null, challenge.id]);
      await connection.commit();
      throw failure('Invalid verification code', 401);
    }

    await connection.query('UPDATE customer_otp_challenges SET consumed_at = ? WHERE id = ?', [new Date(now), challenge.id]);
    await connection.query('INSERT IGNORE INTO customers (phone_e164) VALUES (?)', [phone]);
    const [[customer]] = await connection.query('SELECT id, phone_e164 FROM customers WHERE phone_e164 = ?', [phone]);
    const variants = phoneVariants(phone);
    const marks = variants.map(() => '?').join(',');
    await connection.query(`UPDATE bookings SET customer_id = ? WHERE customer_id IS NULL AND customer_phone IN (${marks})`, [customer.id, ...variants]);
    await connection.query(`UPDATE recurring_bookings SET customer_id = ? WHERE customer_id IS NULL AND customer_phone IN (${marks})`, [customer.id, ...variants]);
    await connection.commit();
    const token = jwt.sign({ id: customer.id, role: 'customer', phone_e164: phone }, jwtSecret, { expiresIn: '30d' });
    return { message: 'Phone verified', token, customer: { id: Number(customer.id), phone: phone } };
  } catch (error) {
    try { await connection.rollback(); } catch { /* Transaction may already be committed. */ }
    throw error;
  } finally { connection.release(); }
}

module.exports = { requestOtp, verifyOtp, normalizePhone, phoneVariants, OTP_TTL_MS, MAX_VERIFY_ATTEMPTS };

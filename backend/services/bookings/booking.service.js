const { generateToken } = require('../../utils/token');
const { transaction } = require('./cancellation.service');
const { VERSION } = require('./cancellation-policy');
function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function validateSlotDate(data) {
  if (!Number.isInteger(Number(data.slot_id)) || Number(data.slot_id) <= 0) fail('A valid slot is required');
  if (typeof data.booking_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.booking_date)) fail('Date must be YYYY-MM-DD');
  const date = new Date(`${data.booking_date}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== data.booking_date) fail('Invalid booking date');
}
async function lockAvailableSlot(connection, data) {
  const [[slot]] = await connection.query('SELECT * FROM slots WHERE id = ? FOR UPDATE', [data.slot_id]);
  if (!slot || !slot.is_active) fail('Invalid or inactive slot');
  // Locking the slot serializes hold/confirm writers across server processes.
  const [[booking]] = await connection.query("SELECT id FROM bookings WHERE slot_id = ? AND booking_date = ? AND status IN ('pending', 'approved') FOR UPDATE", [data.slot_id, data.booking_date]);
  if (booking) fail('This slot is already booked', 409);
  const [[block]] = await connection.query('SELECT id FROM slot_blocks WHERE slot_id = ? AND block_date = ?', [data.slot_id, data.booking_date]);
  if (block) fail('This slot is blocked', 409);
  const weekday = new Date(`${data.booking_date}T00:00:00Z`).getUTCDay();
  const [[recurring]] = await connection.query("SELECT id FROM recurring_bookings WHERE slot_id = ? AND day_of_week = ? AND status = 'active' AND start_date <= ? AND end_date >= ?", [data.slot_id, weekday, data.booking_date, data.booking_date]);
  if (recurring) fail('This slot is reserved for a season booking', 409);
  return slot;
}
async function hold(data) {
  validateSlotDate(data);
  const minutes = Number(process.env.HOLD_EXPIRY_MINUTES || 7);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) fail('Invalid hold configuration', 503);
  return transaction(async connection => {
    await lockAvailableSlot(connection, data);
    const [[live]] = await connection.query('SELECT id FROM slot_holds WHERE slot_id = ? AND booking_date = ? AND expires_at > CURRENT_TIMESTAMP FOR UPDATE', [data.slot_id, data.booking_date]);
    if (live) fail('Slot already held', 409);
    await connection.query('DELETE FROM slot_holds WHERE slot_id = ? AND booking_date = ? AND expires_at <= CURRENT_TIMESTAMP', [data.slot_id, data.booking_date]);
    const session_token = generateToken();
    await connection.query('INSERT INTO slot_holds (slot_id, booking_date, session_token, expires_at) VALUES (?, ?, ?, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? MINUTE))', [data.slot_id, data.booking_date, session_token, minutes]);
    const [[expiry]] = await connection.query('SELECT UNIX_TIMESTAMP(expires_at) AS seconds FROM slot_holds WHERE session_token = ?', [session_token]);
    return { session_token, expires_at: new Date(Number(expiry.seconds) * 1000).toISOString() };
  });
}
async function confirm(data, { requireHold = true } = {}) {
  validateSlotDate(data);
  if (typeof data.customer_name !== 'string' || !data.customer_name.trim() || typeof data.customer_phone !== 'string' || !data.customer_phone.trim()) fail('Name and phone are required');
  if (data.policy_accepted !== true || data.policy_version !== VERSION) fail('Accept the current cancellation policy');
  if (requireHold && (typeof data.session_token !== 'string' || !data.session_token)) fail('Hold token is required');
  return transaction(async connection => {
    await lockAvailableSlot(connection, data);
    const [holds] = await connection.query('SELECT id, session_token FROM slot_holds WHERE slot_id = ? AND booking_date = ? AND expires_at > CURRENT_TIMESTAMP FOR UPDATE', [data.slot_id, data.booking_date]);
    const own = holds.find(row => row.session_token === data.session_token);
    if (requireHold && !own) fail('Invalid or expired hold token');
    if (holds.some(row => row !== own)) fail('Slot already held', 409);
    const [result] = await connection.query(`INSERT INTO bookings
      (slot_id, booking_date, customer_name, customer_phone, customer_email, team_name, status, payment_status, cancellation_policy_version, policy_accepted_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', 'unpaid', ?, UTC_TIMESTAMP())`,
    [data.slot_id, data.booking_date, data.customer_name.trim(), data.customer_phone.trim(), data.customer_email || null, data.team_name || null, VERSION]);
    if (own) await connection.query('DELETE FROM slot_holds WHERE id = ?', [own.id]);
    return { message: 'Booking confirmed', booking_id: result.insertId, details: { slot_id: data.slot_id, booking_date: data.booking_date, customer_name: data.customer_name.trim(), customer_phone: data.customer_phone.trim(), team_name: data.team_name || null } };
  });
}
module.exports = { hold, confirm, validateSlotDate };

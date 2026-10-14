const db = require('../../database');

const DAY = 86400000;
const STATUSES = ['available', 'booked', 'pending', 'held', 'season_reserved', 'blocked', 'inactive', 'past'];

function dateValue(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value ? ms : NaN;
}

function rangeDates(start, end) {
  const from = dateValue(start), to = dateValue(end);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from || to - from > 6 * DAY) {
    throw Object.assign(new Error('Provide valid start_date and end_date spanning 1 to 7 days'), { status: 400 });
  }
  return Array.from({ length: (to - from) / DAY + 1 }, (_, i) => new Date(from + i * DAY).toISOString().slice(0, 10));
}

function ended(date, slot, now) {
  const time = value => value.length === 5 ? `${value}:00` : value;
  const start = Date.parse(`${date}T${time(slot.start_time)}+06:00`);
  let end = Date.parse(`${date}T${time(slot.end_time)}+06:00`);
  if (end <= start) end += DAY;
  return end <= now.getTime();
}

// Pure projection: never changes bookings, holds, or season reservations.
function project({ slots, bookings, holds, blocks, seasons }, dates, now = new Date()) {
  const key = (slotId, date) => `${slotId}:${date}`;
  const bookingMap = new Map(bookings.filter(b => ['pending', 'approved'].includes(b.status)).map(b => [key(b.slot_id, b.booking_date), b]));
  const blockMap = new Map(blocks.map(b => [key(b.slot_id, b.block_date), b]));
  const holdMap = new Map(holds.filter(h => Number(h.seconds_remaining) > 0).map(h => [key(h.slot_id, h.booking_date), h]));
  const seasonMap = new Map();
  for (const season of seasons) {
    if (season.status !== 'active') continue;
    for (const date of dates) {
      if (date >= season.start_date && date <= season.end_date && new Date(`${date}T00:00:00Z`).getUTCDay() === season.day_of_week) {
        const id = key(season.slot_id, date);
        if (!seasonMap.has(id)) seasonMap.set(id, []);
        seasonMap.get(id).push(season);
      }
    }
  }
  const counts = Object.fromEntries(STATUSES.map(status => [status, 0]));
  const cleanSlots = slots.map(s => ({ id: s.id, start_time: s.start_time, end_time: s.end_time, price: Number(s.price), is_active: !!s.is_active }));
  const cells = [];
  for (const date of dates) {
    for (const slot of cleanSlots) {
      const id = key(slot.id, date);
      const booking = bookingMap.get(id), block = blockMap.get(id), hold = holdMap.get(id);
      const reservations = seasonMap.get(id) || [];
      const isPast = ended(date, slot, now);
      const status = block ? 'blocked' : booking ? (booking.status === 'approved' ? 'booked' : 'pending')
        : reservations.length ? 'season_reserved' : hold ? 'held' : !slot.is_active ? 'inactive' : isPast ? 'past' : 'available';
      counts[status]++;
      cells.push({
        slot_id: slot.id, date, status, is_past: isPast, conflict: !!(block && booking),
        booking: booking ? {
          id: booking.id, customer_name: booking.customer_name, customer_phone: booking.customer_phone,
          team_name: booking.team_name || null, status: booking.status, payment_status: booking.payment_status,
          amount_paid: Number(booking.amount_paid || 0),
          balance_due: Math.max(0, Math.round((slot.price - Number(booking.amount_paid || 0)) * 100) / 100)
        } : null,
        block_reason: block ? block.reason || 'Blocked by staff' : null,
        hold_expires_at: hold ? new Date(now.getTime() + Number(hold.seconds_remaining) * 1000).toISOString() : null,
        seasons: reservations.map(s => ({ id: s.id, customer_name: s.customer_name, customer_phone: s.customer_phone,
          team_name: s.team_name || null, start_date: s.start_date, end_date: s.end_date }))
      });
    }
  }
  return { start_date: dates[0], end_date: dates[dates.length - 1], timezone: 'Asia/Dhaka', server_time: now.toISOString(), dates, slots: cleanSlots, cells, counts };
}

async function read(start, end) {
  const dates = rangeDates(start, end);
  const connection = await db.promiseConnection();
  try {
    await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await connection.beginTransaction();
    const [slots] = await connection.query('SELECT id, start_time, end_time, price, is_active FROM slots ORDER BY TIME(start_time), id');
    const [bookings] = await connection.query(`SELECT id, slot_id, booking_date, customer_name, customer_phone, team_name, status, payment_status, amount_paid
      FROM bookings WHERE booking_date BETWEEN ? AND ? AND status IN ('pending','approved')`, [start, end]);
    const [holds] = await connection.query(`SELECT slot_id, booking_date, TIMESTAMPDIFF(MICROSECOND, CURRENT_TIMESTAMP(6), expires_at) / 1000000 AS seconds_remaining
      FROM slot_holds WHERE booking_date BETWEEN ? AND ? AND expires_at > CURRENT_TIMESTAMP`, [start, end]);
    const now = new Date();
    const [blocks] = await connection.query('SELECT slot_id, block_date, reason FROM slot_blocks WHERE block_date BETWEEN ? AND ?', [start, end]);
    const [seasons] = await connection.query(`SELECT id, slot_id, day_of_week, status, customer_name, customer_phone, team_name,
      DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date, DATE_FORMAT(end_date, '%Y-%m-%d') AS end_date
      FROM recurring_bookings WHERE status = 'active' AND start_date <= ? AND end_date >= ? ORDER BY id`, [end, start]);
    await connection.commit();
    return project({ slots, bookings, holds, blocks, seasons }, dates, now);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}

module.exports = { read, project, rangeDates };

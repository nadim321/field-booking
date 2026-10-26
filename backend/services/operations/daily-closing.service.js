const db = require('../../database');
const { dateOnly } = require('../../utils/dates');

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const DAY_MS = 86400000;
const CASH = 'cash';

async function withConnection(work) {
  const connection = await db.promiseConnection();
  try { return await work(connection); }
  finally { connection.release(); }
}
function dateValue(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw fail('Invalid date');
  return value;
}
// Money is handled in integer paisa so sums never drift by a fraction of a taka.
function paisa(value, label = 'amount') {
  const text = String(value ?? '');
  if (!/^-?\d{1,9}(\.\d{1,2})?$/.test(text)) throw fail(`Enter a valid ${label} with at most two decimal places`);
  const negative = text.startsWith('-');
  const [whole, fraction = ''] = text.replace('-', '').split('.');
  return (negative ? -1 : 1) * (Number(whole) * 100 + Number(fraction.padEnd(2, '0')));
}
const taka = value => Number((value / 100).toFixed(2));
const toPaisa = value => Math.round(Number(value || 0) * 100);
function dayRange(date) {
  const from = Date.parse(`${date}T00:00:00+06:00`);
  return { from, to: from + DAY_MS };
}

/**
 * Everything the closing screen needs for one Asia/Dhaka day:
 * cash vs online split of recorded collections, expenses by method, expected
 * cash in the drawer, the active closing (if any) and a check that each booking
 * touched that day still has ledger entries equal to bookings.amount_paid.
 */
async function summary(dateInput) {
  const date = dateValue(dateInput);
  const { from, to } = dayRange(date);
  return withConnection(async c => {
    const [entries] = await c.query(`SELECT kind,method,amount FROM booking_collections
      WHERE created_at>=? AND created_at<? AND kind IN ('collection','reversal')`, [from, to]);
    const byMethod = new Map();
    for (const entry of entries) {
      const row = byMethod.get(entry.method) || { method: entry.method, gross: 0, corrections: 0, net: 0 };
      const amount = toPaisa(entry.amount);
      if (entry.kind === 'reversal') row.corrections += amount; else row.gross += amount;
      row.net = row.gross - row.corrections;
      byMethod.set(entry.method, row);
    }
    const methods = [...byMethod.values()].sort((a, b) => a.method.localeCompare(b.method));
    const cashNet = byMethod.get(CASH)?.net || 0;
    const totalNet = methods.reduce((sum, row) => sum + row.net, 0);

    const [expenses] = await c.query(`SELECT method,amount FROM venue_expenses WHERE expense_date=? AND status='active'`, [date]);
    const expenseByMethod = new Map();
    for (const expense of expenses) expenseByMethod.set(expense.method, (expenseByMethod.get(expense.method) || 0) + toPaisa(expense.amount));
    const cashExpenses = expenseByMethod.get(CASH) || 0;
    const totalExpenses = [...expenseByMethod.values()].reduce((sum, value) => sum + value, 0);

    // Refund channels were never recorded, so refunds are shown for staff to judge, never auto-subtracted.
    const [[refunds]] = await c.query(`SELECT COALESCE(SUM(amount),0) AS amount, COUNT(*) AS count FROM refund_settlements
      WHERE UNIX_TIMESTAMP(created_at)*1000>=? AND UNIX_TIMESTAMP(created_at)*1000<?`, [from, to]);

    const [[closing]] = await c.query(`SELECT id,close_date,expected_cash,counted_cash,cash_refunds_paid,variance,note,actor_name,created_at
      FROM daily_closings WHERE close_date=? AND status='active' ORDER BY id DESC LIMIT 1`, [date]);
    const [[history]] = await c.query('SELECT COUNT(*) AS total FROM daily_closings WHERE close_date=?', [date]);

    const [mismatches] = await c.query(`SELECT b.id AS booking_id,b.amount_paid,
        SUM(CASE WHEN l.kind='reversal' THEN -l.amount ELSE l.amount END) AS ledger_total
      FROM bookings b JOIN booking_collections l ON l.booking_id=b.id
      WHERE b.id IN (SELECT booking_id FROM booking_collections WHERE created_at>=? AND created_at<? AND kind<>'opening')
      GROUP BY b.id,b.amount_paid
      HAVING ABS(SUM(CASE WHEN l.kind='reversal' THEN -l.amount ELSE l.amount END)-b.amount_paid)>0.004
      ORDER BY b.id LIMIT 50`, [from, to]);
    const [[touched]] = await c.query(`SELECT COUNT(DISTINCT booking_id) AS total FROM booking_collections
      WHERE created_at>=? AND created_at<? AND kind<>'opening'`, [from, to]);

    return {
      date,
      note: 'Cash and online figures come from the booking collection ledger. Refund payouts are not auto-subtracted because their payment method was not recorded.',
      collections: {
        by_method: methods.map(row => ({ method: row.method, gross: taka(row.gross), corrections: taka(row.corrections), net: taka(row.net) })),
        cash_net: taka(cashNet),
        online_net: taka(totalNet - cashNet),
        total_net: taka(totalNet)
      },
      expenses: {
        by_method: [...expenseByMethod.entries()].map(([method, value]) => ({ method, amount: taka(value) })).sort((a, b) => a.method.localeCompare(b.method)),
        cash: taka(cashExpenses),
        total: taka(totalExpenses)
      },
      expected_cash_before_refunds: taka(cashNet - cashExpenses),
      completed_refunds: { amount: Number(refunds.amount), count: Number(refunds.count) },
      closing: closing ? present(closing) : null,
      closing_revisions: Number(history.total),
      ledger_check: {
        bookings_checked: Number(touched.total),
        mismatches: mismatches.map(row => ({ booking_id: Number(row.booking_id), amount_paid: Number(row.amount_paid), ledger_total: Number(row.ledger_total) })),
        ok: mismatches.length === 0
      }
    };
  });
}

function present(row) {
  return {
    id: Number(row.id), close_date: dateOnly(row.close_date),
    expected_cash: Number(row.expected_cash), counted_cash: Number(row.counted_cash),
    cash_refunds_paid: Number(row.cash_refunds_paid), variance: Number(row.variance),
    note: row.note, actor_name: row.actor_name, created_at: new Date(row.created_at).toISOString()
  };
}

/**
 * Records the cash counted at close. expected = cash collected − cash expenses − cash refunds
 * the staff member says were paid out; variance = counted − expected. A second submission for
 * the same date supersedes the first and requires a reason, so history is never lost.
 */
async function close(dateInput, body, actor) {
  const date = dateValue(dateInput);
  const counted = paisa(body?.counted_cash, 'counted cash');
  const refundsPaid = paisa(body?.cash_refunds_paid ?? '0', 'cash refunds paid');
  const note = String(body?.note || '').trim();
  if (counted < 0 || refundsPaid < 0) throw fail('Counted cash and cash refunds cannot be negative');
  if (note.length > 500) throw fail('Note must be at most 500 characters');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());
  if (date > today) throw fail('A future day cannot be closed');

  const snapshot = await summary(date);
  if (!snapshot.ledger_check.ok) throw fail('Resolve the booking ledger mismatches listed for this day before closing it', 409);
  const expected = toPaisa(snapshot.expected_cash_before_refunds) - refundsPaid;
  const variance = counted - expected;
  if (variance !== 0 && !note) throw fail('Explain the cash difference in the note before closing the day');

  return withConnection(async c => {
    await c.beginTransaction();
    try {
      const [[previous]] = await c.query(`SELECT id FROM daily_closings WHERE close_date=? AND status='active' FOR UPDATE`, [date]);
      if (previous && !note) throw fail('Give a reason for correcting an already closed day');
      if (previous) await c.query(`UPDATE daily_closings SET status='superseded',active_key=NULL WHERE id=?`, [previous.id]);
      const [result] = await c.query(`INSERT INTO daily_closings
        (close_date,expected_cash,counted_cash,cash_refunds_paid,variance,note,active_key,actor_id,actor_name)
        VALUES (?,?,?,?,?,?,?,?,?)`,
        [date, taka(expected).toFixed(2), taka(counted).toFixed(2), taka(refundsPaid).toFixed(2), taka(variance).toFixed(2), note, date, Number(actor.id) || null, String(actor.username || `Admin #${actor.id}`).slice(0, 255)]);
      await c.commit();
      return { id: Number(result.insertId), close_date: date, expected_cash: taka(expected), counted_cash: taka(counted), variance: taka(variance), supersedes: previous ? Number(previous.id) : null };
    } catch (error) {
      await c.rollback();
      if (error.code === 'ER_DUP_ENTRY' || error.code === '23505') throw fail('This day was just closed by someone else. Reload and review it first.', 409);
      throw error;
    }
  });
}

async function history(startInput, endInput) {
  const start = dateValue(startInput);
  const end = dateValue(endInput);
  if (start > end) throw fail('Start date must be on or before end date');
  if (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`) > 366 * DAY_MS) throw fail('Date range cannot exceed one year');
  return withConnection(async c => {
    const [rows] = await c.query(`SELECT id,close_date,expected_cash,counted_cash,cash_refunds_paid,variance,note,status,actor_name,created_at
      FROM daily_closings WHERE close_date BETWEEN ? AND ? ORDER BY close_date DESC,id DESC`, [start, end]);
    return rows.map(row => ({ ...present(row), status: row.status }));
  });
}

module.exports = { summary, close, history, paisa, dateValue };

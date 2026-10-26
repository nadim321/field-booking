const db = require('../database');
const moneyText = value => typeof value === 'number' ? value.toFixed(2) : String(value ?? '');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
async function query(sql, params = []) {
  const connection = await db.promiseConnection();
  try { return await connection.query(sql, params); }
  finally { connection.release(); }
}
function dateValue(value, name) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw fail(`Invalid ${name}`);
  return value;
}
function dayInDhaka(value) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Number(value))); }

exports.audit = async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
  const [rows] = await query('SELECT id,actor_name,action,resource,resource_id,http_method,response_status,created_at FROM admin_audit_log ORDER BY id DESC LIMIT ?', [limit]);
  res.set('Cache-Control', 'no-store').json(rows.map(row => ({ ...row, created_at: new Date(row.created_at).toISOString() })));
};

exports.expenses = async (req, res) => {
  const start = dateValue(req.query.start, 'start date');
  const end = dateValue(req.query.end, 'end date');
  if (start > end) throw fail('Start date must be on or before end date');
  if (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`) > 365 * 86400000) throw fail('Date range cannot exceed one year');
  const [expenses] = await query(`SELECT id,expense_date,category,amount,method,reference,note,actor_name,status,void_reason,created_at
    FROM venue_expenses WHERE expense_date BETWEEN ? AND ? ORDER BY expense_date DESC,id DESC`, [start, end]);
  const fromEpoch = Date.parse(`${start}T00:00:00+06:00`);
  const toEpoch = Date.parse(`${end}T23:59:59.999+06:00`);
  const [entries] = await query(`SELECT created_at,kind,amount,method FROM booking_collections
    WHERE created_at BETWEEN ? AND ? AND kind IN ('collection','reversal') ORDER BY created_at,id`, [fromEpoch, toEpoch]);
  const days = new Map();
  const rowFor = date => {
    if (!days.has(date)) days.set(date, { date, collected: 0, expenses: 0, net_after_expenses: 0 });
    return days.get(date);
  };
  for (let date = start; date <= end; ) {
    rowFor(date);
    const next = new Date(`${date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    date = next.toISOString().slice(0, 10);
  }
  for (const entry of entries) {
    const day = rowFor(dayInDhaka(entry.created_at));
    day.collected += (entry.kind === 'reversal' ? -1 : 1) * Number(entry.amount);
  }
  for (const expense of expenses) if (expense.status === 'active') rowFor(String(expense.expense_date).slice(0, 10)).expenses += Number(expense.amount);
  for (const day of days.values()) {
    day.collected = Number(day.collected.toFixed(2));
    day.expenses = Number(day.expenses.toFixed(2));
    day.net_after_expenses = Number((day.collected - day.expenses).toFixed(2));
  }
  res.set('Cache-Control', 'no-store').json({ start, end, note: 'Net is recorded collections minus active recorded expenses; it is not profit and excludes refunds.', days: [...days.values()].sort((a, b) => b.date.localeCompare(a.date)), expenses: expenses.map(row => ({ ...row, expense_date: String(row.expense_date).slice(0, 10) })) });
};

exports.addExpense = async (req, res) => {
  const expenseDate = dateValue(req.body?.expense_date, 'expense date');
  const category = String(req.body?.category || '').trim();
  const method = req.body?.method;
  const amount = String(req.body?.amount ?? '');
  const reference = String(req.body?.reference || '').trim();
  const note = String(req.body?.note || '').trim();
  if (!category || category.length > 80) throw fail('Category is required and must be at most 80 characters');
  if (!/^(0|[1-9]\d{0,7})(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) throw fail('Enter an amount greater than zero with at most two decimal places');
  if (!['cash', 'bkash', 'nagad', 'bank_transfer'].includes(method)) throw fail('Select a supported payment method');
  if (reference.length > 150 || note.length > 500) throw fail('Reference must be at most 150 characters and note at most 500');
  const [result] = await query(`INSERT INTO venue_expenses
    (expense_date,category,amount,method,reference,note,actor_id,actor_name)
    VALUES (?,?,?,?,?,?,?,?)`, [expenseDate, category, moneyText(Number(amount)), method, reference || null, note, req.user.id, req.user.username || `Admin #${req.user.id}`]);
  res.locals.auditResourceId = result.insertId;
  res.status(201).json({ id: result.insertId });
};

exports.voidExpense = async (req, res) => {
  const id = Number(req.params.id);
  const reason = String(req.body?.reason || '').trim();
  if (!Number.isSafeInteger(id) || id < 1) throw fail('Invalid expense ID');
  if (!reason || reason.length > 500) throw fail('Provide a reason of at most 500 characters');
  const [result] = await query(`UPDATE venue_expenses SET status='voided',void_reason=?,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND status='active'`, [reason, id]);
  if (!result.affectedRows) throw fail('Expense not found or already voided', 404);
  res.json({ id, status: 'voided' });
};

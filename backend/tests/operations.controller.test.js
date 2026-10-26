const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../database');
const controller = require('../controllers/operations.controller');

function response() { return { statusCode: 200, status(code) { this.statusCode = code; return this; }, set() { return this; }, json(value) { this.value = value; return this; } }; }

test('expense creation validates input and stores actor attribution', async () => {
  const original = db.promiseConnection;
  let saved;
  db.promiseConnection = async () => ({ async query(sql, args) { saved = { sql, args }; return [{ insertId: 17 }]; }, release() {} });
  try {
    const res = response();
    await controller.addExpense({ body: { expense_date: '2026-10-25', category: 'Lights', amount: '150.50', method: 'cash', note: 'Replacement bulb' }, user: { id: 4, username: 'manager' } }, res);
    assert.equal(res.statusCode, 201);
    assert.deepEqual(res.value, { id: 17 });
    assert.match(saved.sql, /INSERT INTO venue_expenses/);
    assert.equal(saved.args[2], '150.50');
    assert.equal(saved.args[6], 4);
    await assert.rejects(controller.addExpense({ body: { expense_date: '2026-10-25', category: 'x', amount: '10.999', method: 'cash' }, user: { id: 4 } }, response()), { status: 400 });
  } finally { db.promiseConnection = original; }
});

test('operations report excludes opening balances and reports daily net after expenses', async () => {
  const original = db.promiseConnection;
  const statements = [];
  db.promiseConnection = async () => ({ async query(sql) {
    statements.push(sql);
    if (sql.includes('FROM venue_expenses')) return [[{ id: 1, expense_date: '2026-10-25', amount: '30.00', status: 'active' }]];
    return [[{ created_at: Date.parse('2026-10-25T08:00:00+06:00'), kind: 'collection', amount: '100.00', method: 'cash' }, { created_at: Date.parse('2026-10-25T09:00:00+06:00'), kind: 'reversal', amount: '10.00', method: 'cash' }]];
  }, release() {} });
  try {
    const res = response();
    await controller.expenses({ query: { start: '2026-10-25', end: '2026-10-25' } }, res);
    assert.equal(res.value.days[0].collected, 90);
    assert.equal(res.value.days[0].expenses, 30);
    assert.equal(res.value.days[0].net_after_expenses, 60);
    assert.match(statements[1], /kind IN \('collection','reversal'\)/);
  } finally { db.promiseConnection = original; }
});

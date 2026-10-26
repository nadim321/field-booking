const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../database');
const controller = require('../controllers/customer-bookings.controller');

function futureDate() { const date = new Date(Date.now() + 48 * 60 * 60 * 1000); return date.toISOString().slice(0, 10); }
function response() { return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.value = value; return this; } }; }

test('customer can request cancellation only for their own future booking', async () => {
  const original = db.promiseConnection;
  let inserted;
  db.promiseConnection = async () => ({
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async query(sql, args) {
      if (sql.includes('SELECT b.id,b.status')) return [[{ id: 22, status: 'approved', booking_date: futureDate(), start_time: '18:00' }]];
      if (sql.includes('SELECT id,status FROM customer_cancellation_requests')) return [[]];
      if (sql.includes('INSERT INTO customer_cancellation_requests')) { inserted = args; return [{ insertId: 3 }]; }
      throw new Error(`Unexpected query: ${sql}`);
    }
  });
  try {
    const res = response();
    await controller.requestCancellation({ params: { id: '22' }, body: { reason: 'Cannot attend' }, customer: { id: 9 } }, res);
    assert.equal(res.statusCode, 201);
    assert.deepEqual(res.value, { id: 3, status: 'pending' });
    assert.deepEqual(inserted, [22, 9, 'Cannot attend']);
  } finally { db.promiseConnection = original; }
});

test('customer cannot submit cancellation for a booking they do not own', async () => {
  const original = db.promiseConnection;
  let released = false;
  db.promiseConnection = async () => ({ async beginTransaction() {}, async rollback() {}, release() { released = true; }, async query(sql) { if (sql.includes('SELECT b.id,b.status')) return [[]]; throw new Error(`Unexpected query: ${sql}`); } });
  try {
    await assert.rejects(controller.requestCancellation({ params: { id: '22' }, body: { reason: 'Please cancel' }, customer: { id: 8 } }, response()), { status: 404 });
    assert.equal(released, true);
  } finally { db.promiseConnection = original; }
});

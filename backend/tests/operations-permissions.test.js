const test = require('node:test');
const assert = require('node:assert/strict');
const { staffCanWrite } = require('../middleware/auth');

test('staff can read admin pages and change booking status without changing payments', () => {
  assert.equal(staffCanWrite({ method: 'GET', path: '/api/admin/bookings', body: {} }), true);
  assert.equal(staffCanWrite({ method: 'PUT', path: '/api/admin/bookings/12', body: { status: 'approved' } }), true);
  assert.equal(staffCanWrite({ method: 'PUT', path: '/api/admin/bookings/12', body: { status: 'approved', payment_status: 'paid' } }), false);
  assert.equal(staffCanWrite({ method: 'POST', path: '/api/admin/bookings/12/collections', body: { amount: 100 } }), true);
});

test('staff cannot change venue settings, manage accounts, cancel bookings, or review requests', () => {
  assert.equal(staffCanWrite({ method: 'PUT', path: '/api/admin/settings', body: {} }), false);
  assert.equal(staffCanWrite({ method: 'POST', path: '/api/admin/admins', body: {} }), false);
  assert.equal(staffCanWrite({ method: 'POST', path: '/api/admin/bookings/12/cancel', body: {} }), false);
  assert.equal(staffCanWrite({ method: 'POST', path: '/api/admin/cancellation-requests/2/review', body: {} }), false);
  assert.equal(staffCanWrite({ method: 'POST', path: '/api/auth/change-password', body: {} }), true);
});

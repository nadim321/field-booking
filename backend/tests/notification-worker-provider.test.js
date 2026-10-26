const test = require('node:test');
const assert = require('node:assert/strict');
const outbox = require('../services/notifications/outbox.service');
const { processClaim } = require('../services/notifications/notification.worker');

async function process(provider) {
  const original = outbox.transaction;
  const job = { id: 9, status: 'processing', lease_token: 'lease', cycle_attempts: 1 };
  const writes = [];
  outbox.transaction = async fn => fn({ query: async (sql, args) => {
    if (sql.startsWith('SELECT * FROM notification_jobs')) return [[job]];
    if (sql.startsWith('UPDATE notification_jobs')) writes.push(['job', args]);
    if (sql.startsWith('UPDATE notification_attempts')) writes.push(['attempt', sql]);
    return [{ affectedRows: 1 }];
  } });
  try { await processClaim(job, provider, () => 1000); }
  finally { outbox.transaction = original; }
  return writes;
}

test('notification worker marks mock acceptance simulated and real relay acceptance sent', async () => {
  const simulated = await process({ async send() { return { success: true, providerResponse: { mock: true } }; } });
  assert.equal(simulated[0][1][0], 'simulated');
  const sent = await process({ async send() { return { success: true }; } });
  assert.equal(sent[0][1][0], 'sent');
});

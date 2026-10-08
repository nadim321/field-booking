// This executable is excluded from releases. No test adapter is selectable by production env.
if (process.env.NODE_ENV !== 'test') throw new Error('Browser fixture requires NODE_ENV=test');
process.env.SENTRY_DSN = '';
process.env.SENTRY_FRONTEND_DSN = '';
const { randomBytes } = require('node:crypto');
const path = require('node:path');
const config = require('../config/env');
const mysql = require('mysql2/promise');
const name = `booking_${randomBytes(6).toString('hex')}_browser_test`;
const origin = 'http://127.0.0.1:5055';
process.env.FRONTEND_URL = origin;
const provider = require('../services/payments/sslcommerz.provider');
const notifications = require('../services/notifications/notification.service');
for (const key of Object.keys(notifications)) if (typeof notifications[key] === 'function') notifications[key] = async () => {};
const sessions = new Map();
provider.initiateSession = async data => {
  sessions.set(data.tran_id, { tran_id: data.tran_id, amount: data.amount, currency: 'BDT', status: 'PENDING', val_id: data.tran_id });
  return { status: 'SUCCESS', sessionkey: data.tran_id, GatewayPageURL: `${origin}/__test/pay/${data.tran_id}` };
};
provider.isGatewayUrl = url => url.startsWith(`${origin}/__test/pay/`);
provider.validateTransaction = async id => sessions.get(id);
provider.queryTransaction = async id => ({ element: sessions.has(id) ? [sessions.get(id)] : [] });
let admin, db, server;
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  try {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    if (db) await db.close();
    if (admin) { await admin.query(`DROP DATABASE IF EXISTS \`${name}\``); await admin.end(); }
  } finally { process.exit(); }
}
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
(async () => {
  admin = await mysql.createConnection({ ...config.database, database: undefined });
  await admin.query(`CREATE DATABASE \`${name}\``);
  config.database.database = name;
  db = require('../database');
  await db.initialize();
  const { createApp } = require('../app');
  const app = createApp({
    publicPath: path.resolve(__dirname, '../../frontend/dist/frontend/browser'),
    configure(app) {
      app.post('/__test/reset', async (req, res, next) => {
        let connection;
        try {
          connection = await db.promiseConnection();
          for (const table of ['payment_attempt_keys', 'refund_settlements', 'booking_cancellations', 'payment_transactions', 'bookings', 'slot_holds', 'slot_blocks', 'recurring_bookings', 'slots', 'app_settings']) await connection.query(`DELETE FROM ${table}`);
          await connection.query("INSERT INTO slots (id,start_time,end_time,price,is_active,category) VALUES (1,'18:00','19:00',2000,1,3),(2,'19:00','20:00',2000,1,3)");
          await connection.query("INSERT INTO app_settings (setting_key,setting_value) VALUES ('advance_payment_percentage','25'),('turf_name','Test Turf'),('turf_phone','01700000000')");
          sessions.clear();
          res.json({ ok: true });
        } catch (error) { next(error); } finally { connection?.release(); }
      });
      app.get('/__test/pay/:id', (req, res) => {
        if (!sessions.has(req.params.id)) return res.sendStatus(404);
        res.type('html').send(`<form method="post" action="/__test/settle/${encodeURIComponent(req.params.id)}"><button name="outcome" value="VALID">Pay successfully</button><button name="outcome" value="FAILED">Fail payment</button></form>`);
      });
      app.post('/__test/settle/:id', require('express').urlencoded({ extended: false }), async (req, res, next) => {
        try {
          const session = sessions.get(req.params.id);
          if (!session) return res.sendStatus(404);
          session.status = req.body.outcome === 'VALID' ? 'VALID' : 'FAILED';
          const result = await require('../services/payments/attempt.service').reconcile(req.params.id);
          res.redirect(`/?payment=check&booking_id=${result.booking_id}`);
        } catch (error) { next(error); }
      });
    }
  });
  server = app.listen(5055, '127.0.0.1', () => console.log('Browser fixture ready'));
  server.on('error', error => { console.error(error.code); stop(); });
})().catch(async error => { console.error(error.code || error.message); await stop(); });

const config = require('./config/env');
const sentry = require('./observability/sentry');
sentry.initialize();
const db = require('./database');
const { createApp } = require('./app');
const scheduler = require('./services/recurring/recurring-booking.scheduler');
const logger = require('./utils/logger');
const notificationWorker = require('./services/notifications/notification.worker');
const refundWorker = require('./services/payments/refund-payout.service');

async function start() {
  sentry.initialize();
  config.validate();
  await db.initialize({ migrate: process.env.RUN_MIGRATIONS !== 'false' });
  const server = createApp().listen(config.port, () => {
    logger.info('server_started', { port: config.port });
    if (process.env.SCHEDULER_ENABLED !== 'false') scheduler.start();
    if (process.env.NOTIFICATION_WORKER_ENABLED !== 'false') notificationWorker.start();
    if (process.env.REFUND_WORKER_ENABLED !== 'false') refundWorker.start();
  });
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    scheduler.stop();
    const notificationStop = notificationWorker.stop();
    const refundStop = refundWorker.stop();
    const timeout = setTimeout(() => process.exit(1), 10000);
    timeout.unref();
    server.close(async () => {
      try { await notificationStop; await refundStop; await db.close(); await sentry.flush(); clearTimeout(timeout); }
      catch { process.exitCode = 1; }
    });
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  server.on('error', error => {
    logger.error('server_error', { code: error.code || 'UNKNOWN' });
    sentry.captureException(error, { stage: 'http_server' });
    shutdown();
    process.exitCode = 1;
  });
  return server;
}
if (require.main === module) start().catch(async error => {
  logger.error('startup_failed', { error_type: error.name, code: error.code || 'CONFIG_OR_MIGRATION' });
  sentry.captureException(error, { stage: 'startup' });
  await db.close();
  await sentry.flush();
  process.exitCode = 1;
});
module.exports = { start };

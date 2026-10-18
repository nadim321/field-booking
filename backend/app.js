require('./config/env');
const express = require('express');
const cors = require('cors');
const path = require('node:path');
const fs = require('node:fs');
const db = require('./database');
const { requestLog, errorHandler } = require('./middleware/observability');
const config = require('./config/env');
const sentry = require('./observability/sentry');
const { serializeRuntimeConfig } = require('./config/runtime-config');
const shareMetadata = require('./services/share-metadata');

function createApp({ publicPath = path.join(__dirname, 'public'), configure = () => {} } = {}) {
  sentry.initialize();
  const app = express();
  app.disable('x-powered-by');
  app.use(requestLog);
  app.use(cors());
  app.use(express.json({ limit: '100kb' }));
  app.get('/runtime-config.js', (req, res) => {
    res.set({ 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    res.send(serializeRuntimeConfig({ sentryDsn: config.sentryFrontendDsn, release: config.release, environment: config.sentryEnvironment }));
  });
  app.get('/health/live', (req, res) => res.json({ status: 'ok' }));
  app.get('/health/ready', async (req, res, next) => {
    try {
      if (!db.cancellationReady) return res.status(503).json({ status: 'not_ready' });
      await db.ping();
      res.json({ status: 'ready' });
    } catch (error) { next(error); }
  });
  configure(app);
  require('./routes')(app);
  app.use('/api', (req, res) => res.status(404).json({ message: 'API route not found' }));
  const hasBundledFrontend = fs.existsSync(path.join(publicPath, 'index.html'));
  if (hasBundledFrontend) {
    app.get(['/', '/season-booking'], async (req, res, next) => {
      try {
        const [html, settings] = await Promise.all([
          fs.promises.readFile(path.join(publicPath, 'index.html'), 'utf8'),
          db.cancellationReady ? require('./services/venue.service').read().catch(() => ({})) : Promise.resolve({})
        ]);
        const baseUrl = config.publicSiteUrl || `${req.protocol}://${req.get('host')}`;
        const metadata = shareMetadata.pageMetadata(req.path, settings, baseUrl);
        const response = shareMetadata.renderMetadata(html, metadata);
        res.set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }).send(response);
      } catch (error) { next(error); }
    });
    app.use(express.static(publicPath));
    app.get('*', (req, res) => res.sendFile(path.join(publicPath, 'index.html')));
  } else {
    app.get('/', (req, res) => res.json({ service: 'booking-api', status: 'ok' }));
    app.get('/season-booking', (req, res) => {
      const frontendUrl = process.env.FRONTEND_URL;
      if (!frontendUrl) return res.status(503).json({ message: 'Frontend URL is not configured' });
      try { return res.redirect(302, new URL('/season-booking', frontendUrl).toString()); }
      catch { return res.status(503).json({ message: 'Frontend URL is invalid' }); }
    });
  }
  app.use(errorHandler);
  return app;
}
module.exports = { createApp };

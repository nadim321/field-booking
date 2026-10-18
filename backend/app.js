require('./config/env');
const express = require('express');
const cors = require('cors');
const path = require('node:path');
const fs = require('node:fs');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const db = require('./database');
const { requestLog, errorHandler } = require('./middleware/observability');
const config = require('./config/env');
const sentry = require('./observability/sentry');
const { serializeRuntimeConfig } = require('./config/runtime-config');
const shareMetadata = require('./services/share-metadata');

function createApp({ publicPath = path.join(__dirname, 'public'), frontendUrl = process.env.FRONTEND_URL, configure = () => {} } = {}) {
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
    app.use(async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return res.status(404).json({ message: 'Route not found' });
      }
      if (!frontendUrl) return res.status(502).json({ message: 'Frontend service is not configured' });
      let upstreamBase;
      let upstreamUrl;
      try {
        upstreamBase = new URL(frontendUrl);
        if (!['http:', 'https:'].includes(upstreamBase.protocol) || upstreamBase.username || upstreamBase.password || upstreamBase.pathname !== '/' || upstreamBase.search || upstreamBase.hash) {
          throw new Error('Invalid frontend URL');
        }
        const requestUrl = new URL(req.originalUrl, 'http://backend.invalid');
        upstreamUrl = new URL(upstreamBase.origin);
        upstreamUrl.pathname = requestUrl.pathname;
        upstreamUrl.search = requestUrl.search;
      } catch {
        return res.status(502).json({ message: 'Frontend service URL is invalid' });
      }

      const headers = {};
      for (const name of ['accept', 'accept-language', 'if-none-match', 'if-modified-since', 'range']) {
        if (req.headers[name]) headers[name] = req.headers[name];
      }
      try {
        const requestOptions = {
          method: req.method,
          headers,
          redirect: 'manual',
          signal: AbortSignal.timeout(15000)
        };
        let upstream = await fetch(upstreamUrl, requestOptions);
        // Static hosts may not have an SPA rewrite configured. Let Angular
        // handle extensionless client routes when the upstream returns 404.
        if (upstream.status === 404 && req.method === 'GET' && !path.extname(upstreamUrl.pathname)) {
          await upstream.body?.cancel();
          upstream = await fetch(new URL('/', upstreamBase), requestOptions);
        }
        res.status(upstream.status);
        upstream.headers.forEach((value, name) => {
          if (!['connection', 'content-encoding', 'content-length', 'keep-alive', 'transfer-encoding', 'upgrade'].includes(name.toLowerCase())) {
            res.setHeader(name, value);
          }
        });
        if (upstream.body && req.method !== 'HEAD') {
          await pipeline(Readable.fromWeb(upstream.body), res);
        } else {
          res.end();
        }
      } catch {
        if (res.headersSent) return res.destroy();
        return res.status(502).json({ message: 'Frontend service is unavailable' });
      }
    });
  }
  app.use(errorHandler);
  return app;
}
module.exports = { createApp };

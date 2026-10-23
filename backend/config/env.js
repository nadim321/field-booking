const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const rawPort = process.env.PORT || 5000;
const port = /^\d+$/.test(String(rawPort)) ? Number(rawPort) : rawPort;const { release } = require('./release');
const requestedDriver = (process.env.DB_DRIVER || 'mysql').toLowerCase();
const databaseDriver = ({ pg: 'postgres', pgsql: 'postgres', postgresql: 'postgres' })[requestedDriver] || requestedDriver;
module.exports = {
  port,
  mediaDir: path.resolve(process.env.MEDIA_DIR || path.join(__dirname, '..', '..', 'media')),
  release,
  sentryFrontendDsn: process.env.SENTRY_FRONTEND_DSN || '',
  sentryEnvironment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET || 'turf_booking_super_secret_key_123!@#',
  paymentPublicBaseUrl: process.env.PAYMENT_PUBLIC_BASE_URL || `http://localhost:${port}`,
  publicSiteUrl: (process.env.PUBLIC_SITE_URL || '').trim().replace(/\/$/, ''),
  database: {
    driver: databaseDriver,
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || (databaseDriver === 'postgres' ? 5432 : 3306)),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'turf_booking',
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DB_SSL === 'true' || (databaseDriver === 'postgres' && /[?&]sslmode=require\b/i.test(process.env.DATABASE_URL || ''))
  },
  validate() {
    if (process.env.NODE_ENV === 'production' && !process.env.MEDIA_DIR) throw new Error('Production MEDIA_DIR must point to persistent storage outside the release directory');
    if (process.env.NODE_ENV === 'production') {
      const relative = path.relative(path.resolve(__dirname, '..'), this.mediaDir);
      if (!path.isAbsolute(process.env.MEDIA_DIR) || (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))) throw new Error('Production MEDIA_DIR must be an absolute path outside the backend release directory');
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port');
    if (!['mysql', 'postgres'].includes(this.database.driver)) throw new Error('DB_DRIVER must be mysql or postgres');
    if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) throw new Error('Production JWT_SECRET must contain at least 32 characters');
    if (process.env.NODE_ENV === 'production') {
      let site;
      try { site = new URL(this.publicSiteUrl); } catch { throw new Error('Production PUBLIC_SITE_URL must be an absolute HTTPS URL'); }
      if (site.protocol !== 'https:' || site.username || site.password || site.search || site.hash || site.pathname !== '/') throw new Error('Production PUBLIC_SITE_URL must be an HTTPS origin without credentials, path, query or fragment');
    }
  }
};

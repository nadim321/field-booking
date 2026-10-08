const fs = require('node:fs');
const path = require('node:path');

function release() {
  if (process.env.SENTRY_RELEASE) return process.env.SENTRY_RELEASE;
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'release.json'), 'utf8')).release;
  } catch {
    return process.env.NODE_ENV === 'production' ? 'unknown-production-release' : 'development';
  }
}

module.exports = { release: release() };

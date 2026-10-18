const fs = require('node:fs');
const path = require('node:path');

const configuredUrl = (process.env.API_BASE_URL || '').trim().replace(/\/+$/, '');
if (configuredUrl) {
  const parsed = new URL(configuredUrl);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('API_BASE_URL must be an absolute HTTP(S) URL without credentials, query, or hash.');
  }
}

const outputCandidates = [
  path.resolve(__dirname, '../dist/frontend/browser/runtime-config.js'),
  path.resolve(__dirname, '../dist/runtime-config.js')
];
const output = outputCandidates.find(candidate => fs.existsSync(path.dirname(candidate)));
if (!output) throw new Error('Angular build output directory was not found.');

const runtimeConfig = { apiBaseUrl: configuredUrl };
fs.writeFileSync(output, `window.__BOOKING_RUNTIME_CONFIG__ = Object.freeze(${JSON.stringify(runtimeConfig)});\n`);
console.log(`Wrote runtime config to ${path.relative(process.cwd(), output)}.`);

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
const { randomBytes } = require('node:crypto');
const mysql = require('mysql2/promise');
const { database } = require('../config/env');

async function verifyArchive(archive) {
  const { stdout } = await execFile('unzip', ['-Z1', archive]);
  const entries = stdout.trim().split('\n');
  assert.ok(entries.includes('backend/observability/sentry.js'), 'Missing observability runtime');
  assert.ok(entries.includes('backend/release.json'), 'Missing release metadata');
  for (const entry of entries) {
    assert.ok(entry.startsWith('backend/') && !entry.split('/').includes('..') && !entry.includes('\\'), 'Unsafe ZIP path');
    assert.ok(!/(^|\/)(node_modules|tests|backups|\.git)(\/|$)/.test(entry), 'Private/development folder in ZIP');
    assert.ok(!entry.endsWith('.map') && !/(^|\/)\.env(?!\.example$)/.test(entry), 'Private file in ZIP');
  }
}

async function smoke(archive) {
  await verifyArchive(archive);
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'booking-release-smoke-'));
  const name = `booking_${randomBytes(6).toString('hex')}_release_test`;
  let admin, server, created = false;
  let exited, serverError;
  try {
    await execFile('unzip', ['-q', archive, '-d', temp]);
    const target = path.join(temp, 'backend');
    const release = JSON.parse(await fs.readFile(path.join(target, 'release.json'), 'utf8')).release;
    await execFile('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], {
      cwd: target, timeout: 180000, maxBuffer: 1024 * 1024,
      env: { PATH: process.env.PATH, HOME: process.env.HOME }
    });
    const port = await new Promise((resolve, reject) => {
      const probe = net.createServer();
      probe.once('error', reject);
      probe.listen(0, '127.0.0.1', () => { const port = probe.address().port; probe.close(() => resolve(port)); });
    });
    admin = await mysql.createConnection({ ...database, database: undefined });
    await admin.query(`CREATE DATABASE \`${name}\``);
    created = true;
    server = spawn(process.execPath, ['server.js'], {
      cwd: target, stdio: ['ignore', 'ignore', 'ignore'],
      env: {
        PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'production',
        PORT: String(port), DB_HOST: database.host, DB_PORT: String(database.port),
        DB_USER: database.user, DB_PASS: database.password, DB_NAME: name,
        JWT_SECRET: randomBytes(32).toString('hex'), SCHEDULER_ENABLED: 'false', RUN_MIGRATIONS: 'true',
        SENTRY_DSN: '', SENTRY_FRONTEND_DSN: ''
      }
    });
    exited = new Promise(resolve => server.once('exit', resolve));
    server.once('error', error => { serverError = error; });
    const base = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let tries = 0; tries < 100; tries++) {
      if (serverError || server.exitCode !== null) throw new Error('Packaged server failed to start');
      try {
        const response = await fetch(`${base}/health/ready`, { signal: AbortSignal.timeout(500) });
        ready = response.ok && (await response.json()).status === 'ready';
      } catch { /* Allow startup/migrations to finish. */ }
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(ready, 'Packaged server readiness timed out');
    const runtime = await fetch(`${base}/runtime-config.js`);
    assert.equal(runtime.headers.get('cache-control'), 'no-store');
    assert.ok((await runtime.text()).includes(release), 'Runtime release ID mismatch');
    const page = await fetch(base);
    assert.ok(page.ok);
    const html = await page.text();
    const scripts = [...html.matchAll(/(?:src|href)="([^"#]+\.(?:js|css))"/g)].map(match => match[1]);
    assert.ok(scripts.some(src => src.includes('main-')), 'Fresh frontend entry missing');
    for (const asset of scripts) {
      const response = await fetch(new URL(asset, base));
      assert.equal(response.status, 200, `Missing asset ${asset}`);
      assert.ok(!response.headers.get('content-type')?.includes('text/html'), `SPA fallback returned for ${asset}`);
      await response.arrayBuffer();
    }
    assert.equal((await fetch(`${base}/api/admin/bookings`)).status, 401);
    console.log(`Release smoke passed: ${path.basename(archive)} (production install, startup, migrations, assets, runtime config, admin auth)`);
  } finally {
    if (server && server.exitCode === null) {
      server.kill('SIGTERM');
      const kill = setTimeout(() => server.kill('SIGKILL'), 12000);
      await exited;
      clearTimeout(kill);
    }
    if (admin) {
      if (created) await admin.query(`DROP DATABASE \`${name}\``);
      await admin.end();
    }
    await fs.rm(temp, { recursive: true, force: true });
  }
}

if (require.main === module) {
  const archive = process.argv[2];
  (archive ? smoke(path.resolve(archive)) : Promise.reject(new Error('Pass the release ZIP path')))
    .catch(error => { console.error(error.code || error.message); process.exitCode = 1; });
}
module.exports = { smoke, verifyArchive };

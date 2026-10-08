const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { constants } = require('node:fs');

function run(command, args, options) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) throw new Error(`${command} ${args[0]} failed`);
}

function removeSourceMaps(dir) {
  return fs.readdir(dir, { withFileTypes: true }).then(entries => Promise.all(entries.map(async entry => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return removeSourceMaps(file);
    if (entry.name.endsWith('.map')) return fs.rm(file);
  })));
}

(async () => {
  const root = path.resolve(__dirname, '../..');
  const release = process.env.SENTRY_RELEASE || `booking-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(release)) throw new Error('Invalid release identifier');
  const frontend = path.join(root, 'frontend');
  const frontendOutput = path.join(frontend, 'dist', 'frontend', 'browser');
  run('npm', ['run', 'build', '--prefix', frontend], { env: { ...process.env, SENTRY_RELEASE: release } });
  const hasSentryCredentials = ['SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT'].every(key => process.env[key]);
  if (hasSentryCredentials) {
    run('npx', ['--no-install', 'sentry-cli', 'sourcemaps', 'inject', frontendOutput], { cwd: frontend });
    run('npx', ['--no-install', 'sentry-cli', 'sourcemaps', 'upload', '--release', release, '--org', process.env.SENTRY_ORG, '--project', process.env.SENTRY_PROJECT, frontendOutput], { cwd: frontend });
  } else {
    console.warn('Sentry source-map upload skipped: set SENTRY_AUTH_TOKEN, SENTRY_ORG, and SENTRY_PROJECT for a production release.');
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'booking-release-'));
  const target = path.join(dir, 'backend');
  await fs.mkdir(target);
  try {
    const include = ['server.js','app.js','database.js','config','controllers','routes','middleware','observability','services','constants','utils','migrations','scripts','package.json','package-lock.json','.env.example'];
    for (const item of include) await fs.cp(path.join(root, 'backend', item), path.join(target, item), { recursive: true });
    await fs.writeFile(path.join(target, 'release.json'), JSON.stringify({ release }, null, 2) + '\n', { mode: 0o644 });
    await fs.cp(frontendOutput, path.join(target, 'public'), { recursive: true });
    await removeSourceMaps(path.join(target, 'public'));
    const artifacts = path.join(root, 'artifacts');
    await fs.mkdir(artifacts, { recursive: true });
    const archive = path.join(artifacts, `${release}.zip`);
    const stagedArchive = path.join(dir, 'release.zip');
    run('zip', ['-qr', stagedArchive, 'backend'], { cwd: dir });
    await fs.copyFile(stagedArchive, archive, constants.COPYFILE_EXCL);
    console.log(`Release ready: ${archive}`);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { database } = require('../config/env');
async function credentials() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'booking-db-'));
  const file = path.join(dir, 'client.cnf');
  const quote = value => '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r') + '"';
  await fs.writeFile(file, '[client]\nprotocol=TCP\n' + ['host', 'port', 'user', 'password'].map(key => `${key}=${quote(database[key])}`).join('\n') + '\n', { mode: 0o600 });
  return { file, cleanup: () => fs.rm(dir, { recursive: true, force: true }) };
}
function child(command, args) {
  const process = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  // Do not echo vendor stderr, which may include private host/user/query details.
  process.stderr.resume();
  const done = new Promise((resolve, reject) => {
    process.once('error', () => reject(new Error(`${command} could not start`)));
    process.once('close', code => code === 0 ? resolve() : reject(new Error(`${command} failed with exit code ${code}`)));
  });
  return { process, done };
}
function databaseName(name) {
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error('Database name may contain only letters, digits and underscores');
  return name;
}
module.exports = { credentials, child, databaseName };

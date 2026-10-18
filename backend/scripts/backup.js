const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createGzip } = require('node:zlib');
const { pipeline } = require('node:stream/promises');
const { createHash } = require('node:crypto');
const { database, mediaDir } = require('../config/env');
const mysql = require('mysql2/promise');
const { backupMedia } = require('./media-backup');
const { credentials, child, databaseName } = require('./mysql-tools');
(async () => {
  const name = databaseName(database.database);
  const dir = path.resolve(process.env.BACKUP_DIR || path.join(__dirname, '..', '..', 'backups'));
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${name}-${new Date().toISOString().replace(/[:.]/g, '-')}.sql.gz`);
  const auth = await credentials();
  let dump;
  try {
    dump = child(process.env.MYSQLDUMP_BIN || 'mysqldump', [`--defaults-extra-file=${auth.file}`, '--single-transaction', '--quick', '--no-tablespaces', '--set-gtid-purged=OFF', '--hex-blob', '--skip-lock-tables', name]);
    dump.process.stdin.end();
    await Promise.all([dump.done, pipeline(dump.process.stdout, createGzip(), fs.createWriteStream(file, { flags: 'wx', mode: 0o600 }))]);
    const connection = await mysql.createConnection(database);
    let media;
    try { media = await backupMedia(connection, mediaDir, file + '.media'); } finally { await connection.end(); }
    const hash = createHash('sha256');
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    await fsp.writeFile(file + '.json', JSON.stringify({ database: name, created_at: new Date().toISOString(), sha256: hash.digest('hex'), media }, null, 2), { mode: 0o600, flag: 'wx' });
    console.log(`Backup completed: ${file}`);
  } catch (error) {
    dump?.process.kill();
    await fsp.rm(file, { force: true });
    await fsp.rm(file + '.media', { recursive: true, force: true });
    throw error;
  } finally { await auth.cleanup(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });

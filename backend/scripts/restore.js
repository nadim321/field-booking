const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { createGunzip } = require('node:zlib');
const { pipeline } = require('node:stream/promises');
const { createHash } = require('node:crypto');
const mysql = require('mysql2/promise');
const { database, mediaDir } = require('../config/env');
const { verifyMedia, restoreMedia } = require('./media-backup');
const { credentials, child, databaseName } = require('./mysql-tools');
(async () => {
  const [file, target, confirmation] = process.argv.slice(2);
  if (!file || !target || confirmation !== `--confirm=${target}`) throw new Error('Usage: npm run restore -- backup.sql.gz empty_target_database --confirm=empty_target_database');
  databaseName(target);
  const manifest = JSON.parse(await fsp.readFile(file + '.json', 'utf8'));
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  if (hash.digest('hex') !== manifest.sha256) throw new Error('Backup checksum mismatch');
  const connection = await mysql.createConnection({ ...database, database: target });
  try {
    const [tables] = await connection.query('SHOW FULL TABLES');
    if (tables.length) throw new Error('Restore target must be empty. Existing databases are never overwritten.');
  } finally { await connection.end(); }
  await verifyMedia(manifest.media, file + '.media', mediaDir);
  const auth = await credentials();
  let restore;
  try {
    restore = child(process.env.MYSQL_BIN || 'mysql', [`--defaults-extra-file=${auth.file}`, '--binary-mode', target]);
    restore.process.stdout.resume();
    await Promise.all([restore.done, pipeline(fs.createReadStream(file), createGunzip(), restore.process.stdin)]);
    await restoreMedia(manifest.media, file + '.media', mediaDir);
    console.log(`Restore completed into ${target}. Verify migrations and application checks before switching traffic.`);
  } catch (error) { restore?.process.kill(); throw error; }
  finally { await auth.cleanup(); }
})().catch(error => { console.error('Restore failed:', error.code || error.message); process.exitCode = 1; });

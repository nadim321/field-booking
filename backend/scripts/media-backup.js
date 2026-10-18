const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const validName = name => /^[a-f0-9-]{36}\.(png|webp)$/.test(name);
const hash = data => createHash('sha256').update(data).digest('hex');

// Call while application writers, uploads and cleanup jobs are stopped.
async function backupMedia(connection, source, target) {
  const [tables] = await connection.query("SHOW TABLES LIKE 'venue_media'");
  if (!tables.length) return null; // Back up databases predating migration 005 too.
  const [rows] = await connection.query('SELECT filename FROM venue_media ORDER BY filename');
  await fs.mkdir(target, { mode: 0o700 });
  const files = [];
  for (const { filename } of rows) {
    if (!validName(filename)) throw Error('Invalid media filename in database');
    const data = await fs.readFile(path.join(source, filename));
    await fs.writeFile(path.join(target, filename), data, { flag: 'wx', mode: 0o600 });
    files.push({ filename, sha256: hash(data), size: data.length });
  }
  return { version: 1, files };
}
async function verifyMedia(manifest, source, target) {
  if (!manifest) return;
  if (manifest.version !== 1 || !Array.isArray(manifest.files)) throw Error('Invalid media manifest');
  if (path.resolve(source) === path.resolve(target)) throw Error('Media restore source and destination must differ');
  const existing = await fs.readdir(target).catch(e => { if (e.code === 'ENOENT') return []; throw e; });
  if (existing.length) throw Error('Media restore target must be empty');
  const seen = new Set();
  for (const file of manifest.files) {
    if (!validName(file.filename) || seen.has(file.filename)) throw Error('Invalid media backup filename');
    seen.add(file.filename);
    const data = await fs.readFile(path.join(source, file.filename));
    if (data.length !== file.size || hash(data) !== file.sha256) throw Error('Media backup checksum mismatch');
  }
}
async function restoreMedia(manifest, source, target) {
  if (!manifest) return;
  await verifyMedia(manifest, source, target);
  await fs.mkdir(target, { recursive: true });
  for (const file of manifest.files) await fs.copyFile(path.join(source,file.filename), path.join(target,file.filename), require('node:fs').constants.COPYFILE_EXCL);
}
module.exports = { backupMedia, verifyMedia, restoreMedia };

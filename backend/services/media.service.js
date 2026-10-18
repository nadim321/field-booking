const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const sharp = require('sharp');
const config = require('../config/env');
const venue = require('./venue.service');
function filePath(filename) {
  if (!/^[a-f0-9-]{36}\.(png|webp)$/.test(filename)) throw venue.failure('Invalid media filename');
  return path.join(config.mediaDir, filename);
}
async function upload(buffer, kind) {
  if (!['logo','photo','share'].includes(kind)) throw venue.failure('Choose logo, field photo or social share image');
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > 5 * 1024 * 1024) throw venue.failure('Upload an image up to 5 MB');
  let output, info;
  try {
    const image = sharp(buffer, { limitInputPixels: 25000000, failOn: 'warning' });
    const m = await image.metadata();
    if (!['jpeg','png','webp'].includes(m.format) || (m.pages || 1) > 1 || !m.width || !m.height || m.width > 10000 || m.height > 10000) throw Error('Unsupported image');
    const pipeline = image.rotate().resize({ width: kind === 'logo' ? 512 : 1920, height: kind === 'logo' ? 512 : 1920, fit: 'inside', withoutEnlargement: true });
    ({ data: output, info } = await (kind === 'logo' ? pipeline.png() : pipeline.webp({ quality: 82 })).toBuffer({ resolveWithObject: true }));
  } catch { throw venue.failure('Invalid image. Use a non-animated JPEG, PNG or WebP up to 25 megapixels'); }
  const id = randomUUID(), filename = `${id}.${kind === 'logo' ? 'png' : 'webp'}`;
  await fs.mkdir(config.mediaDir, { recursive: true });
  await fs.writeFile(filePath(filename), output, { flag: 'wx', mode: 0o640 });
  try {
    await venue.transaction(c => c.query('INSERT INTO venue_media (id,kind,filename,width,height) VALUES (?,?,?,?,?)', [id,kind,filename,info.width,info.height]));
  } catch (e) { await fs.rm(filePath(filename), { force: true }); throw e; }
  return venue.mediaView({ id,kind,width: info.width,height: info.height });
}
async function remove(id, onlyExpired = false) {
  const filename = await venue.transaction(async c => {
    await venue.lock(c);
    if (venue.references(await venue.raw(c)).includes(id)) {
      if (onlyExpired) return false;
      throw venue.failure('Media is in use. Remove it from settings and save first', 409);
    }
    const [[row]] = await c.query(`SELECT * FROM venue_media WHERE id=? ${onlyExpired ? 'AND created_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 24 HOUR)' : ''}`, [id]);
    if (!row) return false;
    await c.query('DELETE FROM venue_media WHERE id=?', [id]);
    return row.filename;
  });
  // Commit first: a DB rollback must never resurrect a row whose file is gone.
  // If unlink fails, the unreferenced file is recovered by the cleanup pass.
  if (filename) await fs.rm(filePath(filename), { force: true });
  return !!filename;
}
async function cleanup() {
  const rows = await venue.transaction(async c => (await c.query('SELECT id FROM venue_media WHERE created_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 24 HOUR)'))[0]);
  let removed = 0;
  for (const row of rows) if (await remove(row.id, true)) removed++;
  // Recover files left by a crash between writing the image and inserting its row.
  for (const filename of await fs.readdir(config.mediaDir).catch(e => { if (e.code === 'ENOENT') return []; throw e; })) {
    if (!/^[a-f0-9-]{36}\.(png|webp)$/.test(filename)) continue;
    const stat = await fs.lstat(filePath(filename));
    if (!stat.isFile() || stat.mtimeMs > Date.now() - 86400000) continue;
    await venue.transaction(async c => {
      await venue.lock(c);
      const [[row]] = await c.query('SELECT id FROM venue_media WHERE filename=?', [filename]);
      if (!row) { await fs.rm(filePath(filename), { force: true }); removed++; }
    });
  }
  return removed;
}
module.exports = { upload, remove, cleanup, filePath };

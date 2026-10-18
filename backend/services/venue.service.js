const db = require('../database');
const limits = { turf_name: 120, turf_address: 500, turf_phone: 25, turf_email: 254, turf_whatsapp: 25, turf_maps_url: 1000, turf_description: 1500 };
const failure = (message, status = 400) => Object.assign(new Error(message), { status });
const phone = value => /^(?:\+?88)?01[3-9]\d{8}$/.test(value) ? '+880' + value.slice(-10) : /^\+[1-9]\d{7,14}$/.test(value) ? value : null;
function mapsUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && (
      (['google.com', 'www.google.com'].includes(u.hostname) && /^\/maps(?:\/|$)/.test(u.pathname)) ||
      u.hostname === 'maps.google.com' || u.hostname === 'maps.app.goo.gl' || (u.hostname === 'goo.gl' && u.pathname.startsWith('/maps/')));
  } catch { return false; }
}
function validate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw failure('Settings must be an object');
  const result = {};
  for (const [key, max] of Object.entries(limits)) if (input[key] !== undefined) {
    if (typeof input[key] !== 'string' || input[key].trim().length > max) throw failure(`${key} must be text up to ${max} characters`);
    result[key] = input[key].trim();
  }
  for (const key of ['turf_phone', 'turf_whatsapp']) if (result[key]) {
    const normalized = phone(result[key].replace(/[\s()-]/g, ''));
    if (!normalized) throw failure(`Enter a valid ${key} with country code or Bangladesh mobile number`);
    result[key] = normalized;
  }
  if (result.turf_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.turf_email)) throw failure('Enter a valid email');
  if (result.turf_maps_url && !mapsUrl(result.turf_maps_url)) throw failure('Use an HTTPS Google Maps location link');
  if (input.advance_payment_percentage !== undefined) {
    const n = input.advance_payment_percentage;
    if (!['string','number'].includes(typeof n) || !Number.isFinite(Number(n)) || Number(n) <= 0 || Number(n) > 100) throw failure('advance_payment_percentage must be between 0 and 100');
    result.advance_payment_percentage = String(Number(n));
  }
  if (input.turf_facilities !== undefined) {
    if (!Array.isArray(input.turf_facilities) || input.turf_facilities.length > 20 || input.turf_facilities.some(x => typeof x !== 'string' || !x.trim() || x.trim().length > 80)) throw failure('Use up to 20 facilities, each 1–80 characters');
    result.turf_facilities = JSON.stringify([...new Set(input.turf_facilities.map(x => x.trim()))]);
  }
  if (input.turf_logo_id !== undefined) {
    if (input.turf_logo_id !== null && (typeof input.turf_logo_id !== 'string' || !/^[a-f0-9-]{36}$/.test(input.turf_logo_id))) throw failure('Invalid logo ID');
    result.turf_logo_id = input.turf_logo_id || '';
  }
  if (input.turf_share_image_id !== undefined) {
    if (input.turf_share_image_id !== null && (typeof input.turf_share_image_id !== 'string' || !/^[a-f0-9-]{36}$/.test(input.turf_share_image_id))) throw failure('Invalid social share image ID');
    result.turf_share_image_id = input.turf_share_image_id || '';
  }
  if (input.turf_photos !== undefined) {
    if (!Array.isArray(input.turf_photos) || input.turf_photos.length > 8 || input.turf_photos.some(x => !x || typeof x.id !== 'string' || !/^[a-f0-9-]{36}$/.test(x.id) || typeof x.caption !== 'string' || x.caption.trim().length > 160) || new Set(input.turf_photos.map(x => x.id)).size !== input.turf_photos.length) throw failure('Use up to 8 unique photos with captions up to 160 characters');
    result.turf_photos = JSON.stringify(input.turf_photos.map(x => ({ id: x.id, caption: x.caption.trim() })));
  }
  return result;
}
const parse = (value, fallback) => { try { return JSON.parse(value) ?? fallback; } catch { return fallback; } };
async function transaction(work) {
  const c = await db.promiseConnection();
  try { await c.beginTransaction(); const value = await work(c); await c.commit(); return value; }
  catch (e) { await c.rollback(); throw e; } finally { c.release(); }
}
async function lock(c) { await c.query("SELECT setting_value FROM app_settings WHERE setting_key='branding_lock' FOR UPDATE"); }
async function raw(c) { const [rows] = await c.query('SELECT setting_key,setting_value FROM app_settings'); return Object.fromEntries(rows.map(r => [r.setting_key,r.setting_value])); }
function references(s) { return [s.turf_logo_id, s.turf_share_image_id, ...parse(s.turf_photos, []).map(x => x.id)].filter(Boolean); }
function mediaView(row) { return { id: row.id, kind: row.kind, url: `/api/media/${row.id}`, width: row.width, height: row.height }; }
async function read() {
  return transaction(async c => {
    const s = await raw(c);
    const ids = references(s);
    const [media] = ids.length ? await c.query('SELECT * FROM venue_media WHERE id IN (?)', [ids]) : [[]];
    const byId = Object.fromEntries(media.map(m => [m.id, mediaView(m)]));
    const result = Object.fromEntries(Object.keys(limits).map(k => [k, s[k] || '']));
    // Legacy invalid contacts must not become actionable links.
    result.turf_phone = phone(result.turf_phone.replace(/[\s()-]/g, '')) || '';
    result.turf_whatsapp = phone(result.turf_whatsapp.replace(/[\s()-]/g, '')) || '';
    result.turf_maps_url = mapsUrl(result.turf_maps_url) ? result.turf_maps_url : '';
    return { ...result, advance_payment_percentage: Number(s.advance_payment_percentage) > 0 && Number(s.advance_payment_percentage) <= 100 ? Number(s.advance_payment_percentage) : 25,
      turf_facilities: parse(s.turf_facilities, []), turf_logo_id: s.turf_logo_id || null, turf_logo: byId[s.turf_logo_id] || null,
      turf_share_image_id: s.turf_share_image_id || null, turf_share_image: byId[s.turf_share_image_id] || null,
      turf_photos: parse(s.turf_photos, []).filter(p => byId[p.id]).map(p => ({ ...byId[p.id], caption: p.caption })) };
  });
}
async function update(input) {
  const changes = validate(input);
  await transaction(async c => {
    await lock(c);
    const merged = { ...await raw(c), ...changes };
    const photos = parse(merged.turf_photos, []);
    for (const [id, kind] of [[merged.turf_logo_id, 'logo'], [merged.turf_share_image_id, 'share'], ...photos.map(p => [p.id,'photo'])].filter(x => x[0])) {
      const [[media]] = await c.query('SELECT kind FROM venue_media WHERE id=?', [id]);
      if (!media || media.kind !== kind) throw failure(`Selected ${kind} is unavailable; upload again`);
    }
    for (const [key,value] of Object.entries(changes)) await c.query('INSERT INTO app_settings (setting_key,setting_value) VALUES (?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)', [key,value]);
  });
}
module.exports = { read, update, validate, phone, mapsUrl, transaction, lock, raw, references, mediaView, failure };

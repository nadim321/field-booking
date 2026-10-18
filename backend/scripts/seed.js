const db = require('../database');
const bcrypt = require('bcryptjs');
const { database } = require('../config/env');
async function seed() {
  if (process.env.NODE_ENV === 'production') throw new Error('Demo seeding is disabled in production');
  await db.initialize();
  const c = await db.promiseConnection();
  try {
    await c.beginTransaction();
    const settings = { advance_payment_percentage: '25' };
    for (const [key,value] of Object.entries(settings)) await c.query('INSERT IGNORE INTO app_settings (setting_key,setting_value) VALUES (?,?)',[key,value]);
    const [[count]] = await c.query('SELECT COUNT(*) AS n FROM slots');
    const defaultSlots = [
        { start: '00:00', end: '01:00', price: 1000, category: 5 },
        { start: '01:00', end: '02:00', price: 1000, category: 5 },
        { start: '02:00', end: '03:00', price: 1000, category: 5 },
        { start: '03:00', end: '04:00', price: 1000, category: 5 },
        { start: '04:00', end: '05:00', price: 1000, category: 5 },
        { start: '05:00', end: '06:00', price: 1000, category: 5 },
        { start: '06:00', end: '07:00', price: 1000, category: 1 },
        { start: '07:00', end: '08:00', price: 1000, category: 1 },
        { start: '08:00', end: '09:00', price: 1000, category: 1 },
        { start: '09:00', end: '10:00', price: 1000, category: 1 },
        { start: '10:00', end: '11:00', price: 1000, category: 1 },
        { start: '11:00', end: '12:00', price: 1000, category: 1 },
        { start: '12:00', end: '13:00', price: 1200, category: 2 },
        { start: '13:00', end: '14:00', price: 1200, category: 2 },
        { start: '14:00', end: '15:00', price: 1200, category: 2 },
        { start: '15:00', end: '16:00', price: 1200, category: 2 },
        { start: '16:00', end: '17:00', price: 1500, category: 3 },
        { start: '17:00', end: '18:00', price: 1500, category: 3 },
        { start: '18:00', end: '19:00', price: 1800, category: 3 },
        { start: '19:00', end: '20:00', price: 1800, category: 4 },
        { start: '20:00', end: '21:00', price: 1800, category: 4 },
        { start: '21:00', end: '22:00', price: 1500, category: 4 },
        { start: '22:00', end: '23:00', price: 1200, category: 4 },
        { start: '23:00', end: '00:00', price: 1000, category: 4 }
      ];
    if (!count.n) for(const slot of defaultSlots) await c.query('INSERT INTO slots (start_time,end_time,price,is_active,category) VALUES (?,?,?,1,?)',[slot.start,slot.end,slot.price,slot.category]);
    const password = process.env.SEED_ADMIN_PASSWORD;
    if (password) await c.query("INSERT IGNORE INTO users (username,password,role) VALUES (?, ?, 'admin')", [process.env.SEED_ADMIN_USERNAME || 'admin', await bcrypt.hash(password, 12)]);
    await c.commit();
    console.log('Development seed completed');
  } catch (error) { await c.rollback(); throw error; } finally { c.release(); await db.close(); }
}
seed().catch(async error => { console.error('Seed failed:', error.code || error.message); await db.close(); process.exitCode = 1; });

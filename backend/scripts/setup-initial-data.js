// One-time setup for a fresh database: default settings, default slots, first admin.
// Safe to run again: slots are added only if the slots table is empty,
// and the admin is added only if that username does not exist yet.
//
// Env needed: DB_DRIVER=postgres, DATABASE_URL, DB_SSL=true (for Render external URL),
//             ADMIN_USERNAME, ADMIN_PASSWORD (12+ characters)
const bcrypt = require('bcryptjs');
const db = require('../database');

const SLOTS = [
  ['00:00', '01:00', 1000, 5], ['01:00', '02:00', 1000, 5], ['02:00', '03:00', 1000, 5],
  ['03:00', '04:00', 1000, 5], ['04:00', '05:00', 1000, 5], ['05:00', '06:00', 1000, 5],
  ['06:00', '07:00', 1000, 1], ['07:00', '08:00', 1000, 1], ['08:00', '09:00', 1000, 1],
  ['09:00', '10:00', 1000, 1], ['10:00', '11:00', 1000, 1], ['11:00', '12:00', 1000, 1],
  ['12:00', '13:00', 1200, 2], ['13:00', '14:00', 1200, 2], ['14:00', '15:00', 1200, 2],
  ['15:00', '16:00', 1200, 2], ['16:00', '17:00', 1500, 3], ['17:00', '18:00', 1500, 3],
  ['18:00', '19:00', 1800, 3], ['19:00', '20:00', 1800, 4], ['20:00', '21:00', 1800, 4],
  ['21:00', '22:00', 1500, 4], ['22:00', '23:00', 1200, 4], ['23:00', '00:00', 1000, 4]
];

(async () => {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password || password.length < 8) {
    throw new Error('Set ADMIN_USERNAME and ADMIN_PASSWORD (at least 8 characters)');
  }
  await db.initialize({ migrate: false });
  const c = await db.promiseConnection();
  try {
    await c.beginTransaction();
    await c.query("INSERT IGNORE INTO app_settings (setting_key,setting_value) VALUES ('advance_payment_percentage','25')");

    const [slotCount] = await c.query('SELECT COUNT(*) AS n FROM slots');
    if (Number(slotCount[0].n) === 0) {
      for (const [start, end, price, category] of SLOTS) {
        await c.query('INSERT INTO slots (start_time,end_time,price,is_active,category) VALUES (?,?,?,1,?)', [start, end, price, category]);
      }
      console.log(`Added ${SLOTS.length} slots`);
    } else {
      console.log('Slots already exist, skipped');
    }

    const [existing] = await c.query('SELECT id FROM users WHERE username = ?', [username]);
    if (existing.length === 0) {
      await c.query("INSERT INTO users (username,password,role) VALUES (?,?,'admin')", [username, await bcrypt.hash(password, 12)]);
      console.log(`Admin '${username}' created`);
    } else {
      console.log(`Admin '${username}' already exists, skipped`);
    }
    await c.commit();
    console.log('Setup complete');
  } catch (error) {
    await c.rollback();
    throw error;
  } finally {
    c.release();
    await db.close();
  }
})().catch(error => { console.error('Setup failed:', error.code || error.message); process.exitCode = 1; });

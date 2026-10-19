const bcrypt = require('bcryptjs');
const db = require('../database');
const { demoAdminLoginEnabled, DEMO_ADMIN_USERNAME, DEMO_ADMIN_PASSWORD } = require('../services/auth/demo-admin');

const slots = [
  ['07:00', '08:00', 1000, 1], ['08:00', '09:00', 1000, 1],
  ['17:00', '18:00', 1500, 3], ['18:00', '19:00', 1800, 3]
];

function dateOffset(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function seedDemo() {
  if (!demoAdminLoginEnabled()) throw new Error('Set DEMO_ADMIN_LOGIN_ENABLED=true only for the isolated demo service before seeding');
  await db.initialize();
  const c = await db.promiseConnection();
  try {
    await c.beginTransaction();
    const [[slotCount]] = await c.query('SELECT COUNT(*) AS total FROM slots');
    if (Number(slotCount.total) === 0) {
      for (const slot of slots) await c.query('INSERT INTO slots (start_time,end_time,price,is_active,category) VALUES (?,?,?,1,?)', slot);
    }

    const hash = await bcrypt.hash(DEMO_ADMIN_PASSWORD, 12);
    const [[existingAdmin]] = await c.query('SELECT id,role FROM users WHERE username=?', [DEMO_ADMIN_USERNAME]);
    if (existingAdmin) {
      if (existingAdmin.role !== 'demo_admin') throw new Error('The username admin already exists with a non-demo role; use a fresh isolated demo database');
      await c.query("UPDATE users SET password=?,role='demo_admin' WHERE id=?", [hash, existingAdmin.id]);
    } else {
      await c.query("INSERT INTO users (username,password,role) VALUES (?,?,'demo_admin')", [DEMO_ADMIN_USERNAME, hash]);
    }

    const [[bookingCount]] = await c.query('SELECT COUNT(*) AS total FROM bookings');
    if (Number(bookingCount.total) === 0) {
      const [availableSlots] = await c.query('SELECT id,price FROM slots WHERE is_active=1 ORDER BY id LIMIT 4');
      if (!availableSlots.length) throw new Error('Demo database needs at least one active slot');
      const examples = [
        { days: 1, name: 'Demo Player One', email: 'player1@example.invalid', status: 'pending' },
        { days: 2, name: 'Demo Player Two', email: 'player2@example.invalid', status: 'approved' },
        { days: 3, name: 'Demo Player Three', email: 'player3@example.invalid', status: 'approved' }
      ];
      for (const [index, example] of examples.entries()) {
        const slot = availableSlots[index % availableSlots.length];
        await c.query(`INSERT INTO bookings
          (slot_id,booking_date,customer_name,customer_phone,customer_email,team_name,status,payment_status,amount_paid,booking_price,price_source)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [slot.id, dateOffset(example.days), example.name, `demo-contact-${index + 1}`, example.email, `Demo Team ${index + 1}`, example.status, 'unpaid', 0, slot.price, 'captured']);
      }
    }

    await c.query("INSERT IGNORE INTO app_settings (setting_key,setting_value) VALUES ('advance_payment_percentage','25')");
    await c.commit();
    console.log('Demo account and synthetic booking data are ready');
  } catch (error) {
    await c.rollback();
    throw error;
  } finally {
    c.release();
    await db.close();
  }
}

seedDemo().catch(async error => {
  console.error('Demo seed failed:', error.code || error.message);
  await db.close();
  process.exitCode = 1;
});

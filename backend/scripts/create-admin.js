const db = require('../database');
const bcrypt = require('bcryptjs');
(async () => {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || username.length > 255 || !password || password.length < 12) throw new Error('Set ADMIN_USERNAME and ADMIN_PASSWORD (at least 12 characters) in the process environment');
  try {
    await db.initialize({ migrate: false });
    const c = await db.promiseConnection();
    try { await c.query("INSERT INTO users (username,password,role) VALUES (?,?,'admin')", [username, await bcrypt.hash(password, 12)]); }
    finally { c.release(); }
    console.log('Admin created');
  } finally { await db.close(); }
})().catch(error => { console.error('Admin creation failed:', error.code || error.message); process.exitCode = 1; });

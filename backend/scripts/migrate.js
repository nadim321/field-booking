const db = require('../database');
(async () => {
  try {
    await db.initialize({ migrate: !process.argv.includes('--check') });
    console.log(process.argv.includes('--check') ? 'Schema is current' : 'Migrations completed');
  } catch (error) {
    console.error('Migration failed:', error.code || error.message);
    process.exitCode = 1;
  } finally { await db.close(); }
})();

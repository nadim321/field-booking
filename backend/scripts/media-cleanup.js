const db = require('../database');
(async () => {
  await db.initialize({ migrate: false });
  console.log(`Unused images removed: ${await require('../services/media.service').cleanup()}`);
})().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => db.close());

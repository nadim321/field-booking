const { createApp } = require('../app');
const db = require('../database');

let app;
let initialization;

async function handler(req, res) {
  if (!initialization) {
    initialization = db.initialize({ migrate: false })
      .then(() => {
        app = createApp();
      })
      .catch(async error => {
        initialization = undefined;
        try { await db.close(); } catch {}
        throw error;
      });
  }

  await initialization;
  return app(req, res);
}

module.exports = handler;

const mysql = require('mysql2');
const { database } = require('./config/env');
let pool;
let initialization;
const db = {
  cancellationReady: false,
  initialize({ migrate = true } = {}) {
    if (initialization) return initialization;
    pool = mysql.createPool({ ...database, waitForConnections: true, connectionLimit: 10, queueLimit: 100, connectTimeout: 10000 });
    initialization = (async () => {
      const migrations = require('./migrations/runner');
      if (migrate) await migrations.run(pool);
      else await migrations.assertCurrent(pool);
      await db.ping();
      db.cancellationReady = true;
    })();
    return initialization;
  },
  getConnection(callback) {
    if (!pool || !db.cancellationReady) return callback(new Error('Database is not ready'));
    pool.getConnection(callback);
  },
  async promiseConnection() {
    if (!pool || !db.cancellationReady) throw new Error('Database is not ready');
    return pool.promise().getConnection();
  },
  all(sql, params, callback) {
    if (!pool || !db.cancellationReady) return callback(new Error('Database is not ready'));
    pool.query(sql, params, callback);
  },
  get(sql, params, callback) {
    db.all(sql, params, (error, rows) => callback(error, error ? null : rows[0] || null));
  },
  run(sql, params, callback) {
    db.all(sql, params, (error, result) => callback?.call({ lastID: result?.insertId, changes: result?.affectedRows }, error));
  },
  async ping() {
    if (!pool) throw new Error('Database is not initialized');
    await pool.promise().query('SELECT 1');
  },
  async close() {
    db.cancellationReady = false;
    if (pool) await pool.promise().end();
    pool = undefined;
    initialization = undefined;
  }
};
module.exports = db;
